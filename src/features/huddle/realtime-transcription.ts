import { streamVoiceTranscript } from "../agents/voice-transcript";
import type { ChannelSummary } from "../relay/contracts";
import type { RelaySession } from "../relay/session";

type Destination = NonNullable<ChannelSummary["huddleTranscript"]>;

type TranscriptEvent = {
  type?: string;
  item_id?: string;
  delta?: string;
  transcript?: string;
};

/** Provider events can interleave. Each item owns one message until it settles. */
export function receiveHuddleTranscription(
  session: RelaySession,
  destination: Destination,
  signal: AbortSignal,
  canWrite: () => boolean,
  live: () => boolean,
  report: (error: unknown) => void,
) {
  const lines = new Map<string, ReturnType<typeof streamVoiceTranscript>>();
  const completed = new Set<string>();
  const outbox = session.outbox;
  return (event: TranscriptEvent) => {
    if (signal.aborted || !outbox || !canWrite()) return;
    const final =
      event.type === "conversation.item.input_audio_transcription.completed";
    const delta =
      event.type === "conversation.item.input_audio_transcription.delta";
    const item = event.item_id;
    if (
      typeof item !== "string" ||
      item.length > 128 ||
      completed.has(item) ||
      (!final && !delta)
    )
      return;
    if (final && typeof event.transcript !== "string") return;
    let line = lines.get(item);
    if (!line) {
      if (!final && (typeof event.delta !== "string" || lines.size >= 16))
        return;
      line = streamVoiceTranscript(destination, signal, live, async (event) => {
        signal.throwIfAborted();
        if (!canWrite())
          throw new Error("Huddle transcript destination unavailable");
        const id = outbox.send(
          { ...event, tags: event.tags?.map((tag) => [...tag]) ?? [] },
          undefined,
          canWrite,
        );
        const delivered = session.channelWrites.delivered(
          id,
          canWrite,
          false,
          false,
        );
        // The outbox already owns this event, even when its receipt is lost.
        // Keep its ID so a final correction cannot create a second message.
        if (event.kind === 9) await delivered.catch(report);
        else await delivered;
        return {
          id,
          created_at:
            outbox.snapshot().find((item) => item.event.id === id)?.event
              .created_at ?? Math.floor(Date.now() / 1000),
        };
      });
      lines.set(item, line);
    }
    if (final) {
      lines.delete(item);
      completed.add(item);
      if (completed.size > 256) {
        const oldest = completed.values().next().value;
        if (oldest !== undefined) completed.delete(oldest);
      }
      if (typeof event.transcript === "string")
        void line.finish(event.transcript).catch(report);
    } else if (typeof event.delta === "string") {
      line.append(event.delta);
    }
  };
}

/** The Huddle owns the track and keeps it stable across input device changes. */
export function openRealtimeHuddleTranscription(
  track: MediaStreamTrack,
  signal: AbortSignal,
  connect: (offer: string) => Promise<string>,
  receive: (event: TranscriptEvent) => void,
  failed: (error: unknown) => void,
) {
  const peer = new RTCPeerConnection();
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    signal.removeEventListener("abort", close);
    peer.close();
  };
  const fail = (error: unknown) => {
    if (closed) return;
    close();
    if (!signal.aborted) failed(error);
  };
  signal.addEventListener("abort", close, { once: true });
  peer.addEventListener("connectionstatechange", () => {
    if (peer.connectionState === "failed")
      fail(new Error("Huddle transcription disconnected."));
  });
  void (async () => {
    signal.throwIfAborted();
    const sender = peer.addTransceiver("audio", {
      direction: "sendonly",
    }).sender;
    const channel = peer.createDataChannel("oai-events");
    channel.addEventListener("close", () =>
      fail(new Error("Huddle transcription disconnected.")),
    );
    channel.addEventListener("message", ({ data }) => {
      if (closed || typeof data !== "string" || data.length > 65_536) return;
      let value: unknown;
      try {
        value = JSON.parse(data);
      } catch {
        return;
      }
      if (!value || typeof value !== "object") return;
      const event = value as TranscriptEvent;
      if (event.type === "error") {
        fail(new Error("The Huddle transcription service could not continue."));
      } else receive(event);
    });
    const offer = await peer.createOffer();
    await peer.setLocalDescription(offer);
    signal.throwIfAborted();
    const sdp = await connect(offer.sdp ?? "");
    if (closed) return;
    await sender.replaceTrack(track);
    if (!closed) await peer.setRemoteDescription({ type: "answer", sdp });
  })().catch(fail);
}
