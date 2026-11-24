import captureUrl from "../../features/huddle/capture.worklet.js?url&no-inline";
import { createPlayout } from "../../features/huddle/playout";
import type { AppServer } from "./rpc";

/** Codex owns voice; this graph only carries the seat's 48 kHz mono PCM. */
export async function openVoice(
  rpc: AppServer,
  threadId: string,
  signal: AbortSignal,
  output: (samples: number[]) => Promise<void>,
  ended: (error?: Error) => void,
  instructions: string,
  thinking?: (active: boolean) => void,
  voice?: string,
  client?: Readonly<{
    speaking?: ((active: boolean) => void) | undefined;
    initialContext: string;
  }>,
) {
  signal.throwIfAborted();
  const peer = new RTCPeerConnection();
  let context: AudioContext;
  try {
    context = new AudioContext({ sampleRate: 48000 });
  } catch (error) {
    peer.close();
    throw error;
  }
  const destination = context.createMediaStreamDestination();
  const playout = createPlayout(context, destination, 0.02);
  let capture: AudioWorkletNode | undefined;
  let remote: MediaStreamAudioSourceNode | undefined;
  let decoder: HTMLAudioElement | undefined;
  let closed = false;
  let closing: Promise<void> | undefined;
  let starting: Promise<unknown> | undefined;
  let providerSpeaking = false;
  let audibleUntil = 0;
  let quiet: ReturnType<typeof setTimeout> | undefined;
  let outputActive = false;
  const reportOutput = () => {
    const active = providerSpeaking || performance.now() < audibleUntil;
    if (active !== outputActive) {
      outputActive = active;
      client?.speaking?.(active);
    }
  };
  const checkQuiet = () => {
    const remaining = audibleUntil - performance.now();
    quiet = remaining > 0 ? setTimeout(checkQuiet, remaining) : undefined;
    reportOutput();
  };
  let cancel!: (error: Error) => void;
  const cancelled = new Promise<never>((_, reject) => {
    cancel = reject;
  });
  void cancelled.catch(() => {});
  const wait = <T>(operation: Promise<T>) =>
    Promise.race([operation, cancelled]);
  let off = () => {};
  let rejectConnected!: (error: Error) => void;
  const close = () => {
    if (closed) return closing;
    closed = true;
    clearTimeout(quiet);
    signal.removeEventListener("abort", close);
    off();
    cancel(new Error("Voice connection closed"));
    rejectConnected(new Error("Voice connection closed"));
    peer.close();
    decoder?.pause();
    if (decoder) decoder.srcObject = null;
    remote?.disconnect();
    if (capture) {
      capture.port.onmessage = null;
      capture.port.close();
      capture.disconnect();
    }
    playout.close();
    for (const track of destination.stream.getTracks()) track.stop();
    destination.disconnect();
    closing = Promise.all([
      context.close().catch(() => {}),
      starting
        ?.catch(() => {})
        .then(() =>
          rpc.request("thread/realtime/stop", { threadId }).catch(() => {}),
        ),
    ]).then(() => {});
    return closing;
  };
  const fail = (error: Error) => {
    if (closed) return;
    close();
    ended(error);
  };
  const connected = new Promise<void>((resolve, reject) => {
    rejectConnected = reject;
    peer.onconnectionstatechange = () => {
      if (peer.connectionState === "connected") resolve();
      if (["failed", "disconnected"].includes(peer.connectionState))
        fail(new Error("Codex voice disconnected"));
    };
  });
  void connected.catch(() => {});
  signal.addEventListener("abort", close, { once: true });
  const timeout = setTimeout(
    () => fail(new Error("Codex voice connection timed out")),
    30_000,
  );
  try {
    await wait(context.resume());
    await wait(context.audioWorklet.addModule(captureUrl));
    signal.throwIfAborted();
    if (closed) throw new Error("Voice connection closed");
    if (context.sampleRate !== 48000)
      throw new Error("Agent voice requires 48 kHz audio");
    capture = new AudioWorkletNode(context, "buzz-huddle-capture");
    capture.port.onmessage = ({ data }: MessageEvent<Float32Array>) => {
      if (closed) return;
      // Some V3 backends send turn events without WebRTC output-buffer
      // events. Use decoded signal energy in that case; the track also
      // delivers silent frames while the channel is open.
      if (client?.speaking) {
        const energy = data.reduce((sum, sample) => sum + sample * sample, 0);
        if (energy > data.length * 0.000004) {
          audibleUntil = performance.now() + 140;
          quiet ??= setTimeout(checkQuiet, 140);
        }
        reportOutput();
      }
      // The seat owns bounded buffering and serial native sends.
      void output(Array.from(data)).catch(fail);
    };
    capture.connect(context.destination); // Existing capture worklet emits silence.
    peer.ontrack = ({ track }) => {
      if (closed || track.kind !== "audio" || !capture) return;
      remote?.disconnect();
      const stream = new MediaStream([track]);
      // Keep WebRTC decoding active even though the worklet, rather than a
      // media element, consumes the sound. The element itself stays muted.
      decoder ??= new Audio();
      decoder.muted = true;
      decoder.srcObject = stream;
      void decoder.play().catch(fail);
      remote = context.createMediaStreamSource(stream);
      remote.connect(capture);
    };
    for (const track of destination.stream.getTracks())
      peer.addTrack(track, destination.stream);
    const events = peer.createDataChannel("oai-events");
    events.onmessage = ({ data }) => {
      if (closed || typeof data !== "string") return;
      try {
        const event = JSON.parse(data);
        if (event.type === "response.created") thinking?.(true);
        if (event.type === "output_audio_buffer.started")
          providerSpeaking = true;
        if (
          event.type === "output_audio_buffer.stopped" ||
          event.type === "output_audio_buffer.cleared"
        )
          providerSpeaking = false;
        if (event.type === "output_audio_buffer.cleared") audibleUntil = 0;
        reportOutput();
        if (
          event.type === "response.done" ||
          event.type === "output_audio_buffer.started" ||
          event.type === "input_audio_buffer.speech_started"
        )
          thinking?.(false);
      } catch {
        /* Ignore non-protocol data. */
      }
    };
    off = rpc.onMessage(({ method, params }) => {
      const p = params as
        | { threadId?: string; sdp?: string; message?: string }
        | undefined;
      if (method === "connection/closed")
        return fail(new Error(p?.message ?? "Codex closed"));
      if (p?.threadId !== threadId || closed) return;
      if (method === "thread/realtime/sdp" && p.sdp)
        void peer
          .setRemoteDescription({ type: "answer", sdp: p.sdp })
          .catch(fail);
      if (
        method === "thread/realtime/error" ||
        method === "thread/realtime/closed"
      )
        fail(new Error(p.message ?? "Codex voice ended"));
    });
    await wait(peer.setLocalDescription(await wait(peer.createOffer())));
    signal.throwIfAborted();
    const sdp = peer.localDescription?.sdp;
    if (!sdp) throw new Error("Codex voice offer is missing");
    starting = rpc.request("thread/realtime/start", {
      threadId,
      transport: { type: "webrtc", sdp },
      version: "v3",
      outputModality: "audio",
      clientManagedHandoffs: false,
      realtimeStartInstructions: instructions,
      ...(client
        ? { initialItems: [{ role: "developer", text: client.initialContext }] }
        : {}),
      ...(voice ? { voice } : {}),
    });
    await wait(starting);
    await connected;
    signal.throwIfAborted();
    return {
      close,
      input(samples: number[]) {
        if (!closed) playout.play(samples);
      },
    };
  } catch (error) {
    await close();
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}
