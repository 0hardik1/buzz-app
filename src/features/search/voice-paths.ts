// Development-only switching between voice jump's recognizers, and timings
// for each listen so the paths can be compared by numbers, not only by feel.
import { invoke } from "@tauri-apps/api/core";

/** `key`: fetch a Realtime key ahead of time and answer the offer with
 * OpenAI. `offer`: send the offer to the kgoose route, which answers it.
 * `apple`: on-device Apple speech. */
export type VoicePath = "key" | "offer" | "apple";

export type VoicePaths = {
  selected: VoicePath;
  /** The model the offer path asks for; null uses the route's default. */
  model: string | null;
  available: VoicePath[];
};

export const VOICE_PATH_LABELS: Record<VoicePath, string> = {
  key: "Key route, then OpenAI",
  offer: "kgoose offer route",
  apple: "Apple on-device",
};

/** Models the offer route accepts. The key route always uses
 * gpt-realtime-whisper, so that is the offer path's default here too. */
export const OFFER_MODELS = ["gpt-realtime-whisper", "gpt-live-transcribe"];
export const KEY_ROUTE_MODEL = "gpt-realtime-whisper";

let paths: VoicePaths | null = null;
const pathListeners = new Set<() => void>();

export function voicePaths() {
  return paths;
}

export function subscribeVoicePaths(listener: () => void) {
  pathListeners.add(listener);
  return () => {
    pathListeners.delete(listener);
  };
}

function setPaths(next: VoicePaths | null) {
  paths = next;
  for (const listener of pathListeners) listener();
}

/** Reads the selected path and the paths this build can use. */
export async function loadVoicePaths() {
  const next = await invoke<VoicePaths>("voice_search_select", {}).catch(
    () => null,
  );
  setPaths(next);
  return next;
}

/** Selects a path for the next listen; it takes effect without a restart. */
export async function selectVoicePath(path: VoicePath, model?: string | null) {
  const next = await invoke<VoicePaths>("voice_search_select", {
    path,
    model: model ?? null,
  });
  setPaths(next);
  return next;
}

export type VoiceTiming = {
  path: VoicePath | "unknown";
  model: string;
  /** Press until listening: the offer, microphone and SDP answer. */
  connectMs: number;
  /** Listening until the first transcript text. */
  firstTextMs: number | null;
  /** Listening until the transcript last changed: the final transcript. */
  finalTextMs: number | null;
  /** Listening until the utterance was reported. */
  endMs: number | null;
  at: number;
};

const TIMINGS_KEPT = 20;
let timings: VoiceTiming[] = [];
const timingListeners = new Set<() => void>();

export function voiceTimings() {
  return timings;
}

export function subscribeVoiceTimings(listener: () => void) {
  timingListeners.add(listener);
  return () => {
    timingListeners.delete(listener);
  };
}

export function clearVoiceTimings() {
  timings = [];
  for (const listener of timingListeners) listener();
}

/** The label a listen is timed under: the selected path and its model. */
export function timedPath(): Pick<VoiceTiming, "path" | "model"> {
  const path = paths?.selected ?? "unknown";
  const model =
    path === "key"
      ? KEY_ROUTE_MODEL
      : path === "offer"
        ? (paths?.model ?? "route default")
        : path === "apple"
          ? "on-device"
          : "";
  return { path, model };
}

const ms = (value: number | null) =>
  value === null ? "–" : `${Math.round(value)} ms`;

export function recordVoiceTiming(timing: VoiceTiming) {
  timings = [timing, ...timings].slice(0, TIMINGS_KEPT);
  for (const listener of timingListeners) listener();
  console.info(
    `voice timing: path=${timing.path} model=${timing.model} ` +
      `press→listening=${ms(timing.connectMs)} ` +
      `listening→first text=${ms(timing.firstTextMs)} ` +
      `listening→final transcript=${ms(timing.finalTextMs)} ` +
      `listening→reported=${ms(timing.endMs)}`,
  );
}
