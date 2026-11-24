import { useSyncExternalStore } from "react";
import type { DeviceSetting } from "../../shared/device-settings";

const preferenceKey = "buzz-sideline.v1";
const changedEvent = "buzz-sideline-changed";

/** Device-local opt-in to the experimental conversation sideline. */
export function sidelinePreference(): boolean {
  try {
    return localStorage.getItem(preferenceKey) === "on";
  } catch {
    return false;
  }
}
function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === preferenceKey || event.key === null) listener();
  };
  window.addEventListener(changedEvent, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changedEvent, listener);
    window.removeEventListener("storage", storage);
  };
}
export function useSidelinePreference(): boolean {
  return useSyncExternalStore(subscribe, sidelinePreference, () => false);
}
export function setSidelinePreference(enabled: boolean): void {
  try {
    localStorage.setItem(preferenceKey, enabled ? "on" : "off");
  } catch {
    // Unsaved: the change still applies to this window.
  }
  window.dispatchEvent(new Event(changedEvent));
}

export const sidelineSetting: DeviceSetting = {
  key: "conversations.sideline",
  description:
    "Experimental: a timeline of media, GitHub links and pins in a wide conversation's right margin.",
  schema: { type: "boolean" },
  applies: "When the right-hand panel is closed and the window leaves margin.",
  read: () => ({ value: sidelinePreference() }),
  write: (value) => setSidelinePreference(value as boolean),
};
