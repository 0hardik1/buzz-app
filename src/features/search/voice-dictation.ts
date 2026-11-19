// Voice jump's speech-to-text, on device: native code records the
// microphone and transcribes it with Apple's speech recognition, biased
// toward names the caller expects (`voice_search.rs`). The transcript so far
// arrives each time it changes. A short pause in speech is reported while
// listening goes on; a long one, or a second press, ends the utterance, and
// native code then sends its final transcript.
import { Channel, invoke } from "@tauri-apps/api/core";
import { useCallback, useEffect, useRef, useState } from "react";

/** Speech that stops producing text this long has paused: reported, but
 * listening goes on. On-device recognition revises its words about every
 * 200–300 ms while someone speaks; across 20 fluent phrases its longest gap
 * mid-phrase was about 500 ms, and its words settle about 200 ms after speech
 * stops. So 600 ms waits out fluent speech and reports a pause about 0.8 s
 * after the last word. A hesitation of 400 ms or more mid-phrase can still
 * report one early. */
export const PAUSE_MS = 600;
/** Speech that stops producing text this long has ended. */
const END_MS = 3_000;
/** Nothing heard this long after starting ends the attempt. */
const SILENCE_MS = 8_000;
/** How long an ending waits for the final transcript before reporting what
 * was heard so far. Native code usually sends it within 100 ms. */
const FINAL_MS = 1_000;

/** Loads the speech model before it's needed; native code keeps it loaded,
 * so calling this often is cheap. */
export function prepareVoice() {
  void invoke("voice_search_prepare").catch(() => {});
}

let available: Promise<boolean> | undefined;
/** Whether this device can transcribe speech, asked of native code once. */
export function useVoiceSearchAvailable(enabled: boolean) {
  const [value, setValue] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let current = true;
    available ??= invoke<boolean>("voice_search_available").catch(() => false);
    void available.then((next) => {
      if (current) setValue(next);
    });
    return () => {
      current = false;
    };
  }, [enabled]);
  return enabled && value;
}

export type DictationState = "idle" | "starting" | "listening";

type VoiceEvent =
  | { kind: "listening" }
  | { kind: "text"; text: string }
  | { kind: "ended"; text: string }
  | { kind: "error"; message: string };

export function useVoiceDictation({
  onText,
  onPause,
  onEnd,
  onError,
}: {
  /** The transcript so far, each time it changes. */
  onText: (text: string) => void;
  /** The transcript so far, once speech pauses briefly; listening goes on. */
  onPause?: (text: string) => void;
  /** The finished transcript, once speech pauses or the person stops. */
  onEnd: (text: string) => void;
  onError?: (message: string) => void;
}) {
  const [state, setState] = useState<DictationState>("idle");
  const run = useRef<{ stop: () => void; cancel: () => void } | undefined>(
    undefined,
  );
  const callbacks = useRef({ onText, onPause, onEnd, onError });
  callbacks.current = { onText, onPause, onEnd, onError };

  /** Ends listening and reports what was heard. */
  const stop = useCallback(() => run.current?.stop(), []);
  /** Ends listening without reporting it. */
  const cancel = useCallback(() => run.current?.cancel(), []);
  useEffect(() => cancel, [cancel]);

  /** Starts listening; `hints` are names and words to expect. */
  const start = useCallback(async (hints: readonly string[] = []) => {
    if (run.current) return;
    let session: number | undefined;
    let text = "";
    let timer: ReturnType<typeof setTimeout> | undefined;
    let pause: ReturnType<typeof setTimeout> | undefined;
    let ending = false;
    let ended = false;
    const close = (report: boolean, heard = text) => {
      if (ended) return;
      ended = true;
      clearTimeout(timer);
      clearTimeout(pause);
      run.current = undefined;
      setState("idle");
      if (report && heard.trim()) callbacks.current.onEnd(heard.trim());
    };
    const finish = () => {
      if (ended || ending) return;
      ending = true;
      clearTimeout(pause);
      if (session !== undefined)
        void invoke("voice_search_finish", { session }).catch(() => {});
      // The final transcript ends it; this reports what was heard if it
      // doesn't come.
      clearTimeout(timer);
      timer = setTimeout(() => close(true), FINAL_MS);
    };
    const abandon = () => {
      if (ended) return;
      if (session !== undefined)
        void invoke("voice_search_cancel", { session }).catch(() => {});
      close(false);
    };
    const wait = (ms: number) => {
      clearTimeout(timer);
      timer = setTimeout(finish, ms);
    };
    const onEvent = new Channel<VoiceEvent>((event) => {
      if (ended) return;
      if (event.kind === "error") {
        callbacks.current.onError?.(event.message);
        return close(false);
      }
      if (event.kind === "ended") return close(true, event.text || text);
      if (event.kind === "listening") {
        setState("listening");
        if (!ending) wait(SILENCE_MS);
        return;
      }
      if (event.text === text) return;
      text = event.text;
      callbacks.current.onText(text.trim());
      if (ending) return;
      clearTimeout(pause);
      pause = setTimeout(
        () => callbacks.current.onPause?.(text.trim()),
        PAUSE_MS,
      );
      wait(END_MS);
    });
    run.current = { stop: finish, cancel: abandon };
    setState("starting");
    try {
      session = await invoke<number>("voice_search_start", {
        hints,
        onEvent,
      });
    } catch (error) {
      if (!ended)
        callbacks.current.onError?.(
          typeof error === "string" ? error : "Voice search failed",
        );
      return close(false);
    }
    // Stopped or cancelled before native code answered.
    if (ended) void invoke("voice_search_cancel", { session }).catch(() => {});
    else if (ending)
      void invoke("voice_search_finish", { session }).catch(() => {});
  }, []);

  return { state, start, stop, cancel };
}
