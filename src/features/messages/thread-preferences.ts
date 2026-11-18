import { useSyncExternalStore } from "react";
import type { DeviceSetting } from "../../shared/device-settings";

/** Inline expands conversation cards from the composer; side keeps direct split openings. */
export type ThreadPlacement = "inline" | "side";
const preferenceKey = "buzz-thread-placement.v1";
const changedEvent = "buzz-thread-placement-changed";
let unsavedPreference: ThreadPlacement | undefined;

/** Device-local default for new tabs, never an instruction to move existing ones. */
export function threadPlacementPreference(): ThreadPlacement {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    const saved = localStorage.getItem(preferenceKey);
    return saved === "main" || saved === "side" ? "side" : "inline";
  } catch {
    return "inline";
  }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key !== preferenceKey && event.key !== null) return;
    unsavedPreference = undefined;
    listener();
  };
  window.addEventListener(changedEvent, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changedEvent, listener);
    window.removeEventListener("storage", storage);
  };
}
export function useThreadPlacementPreference() {
  const placement = useSyncExternalStore(subscribe, threadPlacementPreference);
  // Saving the same active choice changes recovery state, not its placement.
  const unsaved = useSyncExternalStore(
    subscribe,
    () => unsavedPreference !== undefined,
  );
  return { placement, unsaved };
}
export function setThreadPlacementPreference(value: ThreadPlacement): void {
  unsavedPreference = value;
  try {
    localStorage.setItem(preferenceKey, value);
    unsavedPreference = undefined;
  } catch {
    // Retain the active choice and its recovery state across settings remounts.
  }
  window.dispatchEvent(new Event(changedEvent));
}

/** Thread placement as a device setting. */
export const threadPlacementSetting: DeviceSetting = {
  key: "conversations.thread_placement",
  description:
    "Where threads and link cards open: inline from the composer, or in the split panel.",
  schema: { type: "string", enum: ["inline", "side"] },
  applies:
    "New openings only; existing sheets and split panels stay where they are.",
  read: () => ({
    value: threadPlacementPreference(),
    unsaved:
      unsavedPreference === undefined
        ? null
        : "This placement is active, but could not be saved on this device.",
  }),
  write: (value) => setThreadPlacementPreference(value as ThreadPlacement),
};
