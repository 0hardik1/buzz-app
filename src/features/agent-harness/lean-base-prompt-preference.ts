import type { DeviceSetting } from "../../shared/device-settings";

const preferenceKey = "buzz-agents-lean-base-prompt.v1";
let unsavedPreference: boolean | undefined;

/** Device-local choice to give agents the lean base prompt: the Buzz
 * required contract without the optional guidance. On by default.
 * Claude/Codex keep it until a new session; Goose/Pi refresh it on the next turn. */
export function leanBasePromptPreference(): boolean {
  if (unsavedPreference !== undefined) return unsavedPreference;
  try {
    return localStorage.getItem(preferenceKey) !== "off";
  } catch {
    return true;
  }
}

export function setLeanBasePromptPreference(enabled: boolean): void {
  unsavedPreference = enabled;
  try {
    localStorage.setItem(preferenceKey, enabled ? "on" : "off");
    unsavedPreference = undefined;
  } catch {
    // Retain the active choice for this app session.
  }
}

/** The lean base prompt as a device setting. */
export const leanBasePromptSetting: DeviceSetting = {
  key: "agents.lean_base_prompt",
  description:
    "Device-wide for all agents; any connected agent with settings access can change it. On (default) gives only the required Buzz contract; off appends full guidance. Claude/Codex need a new session; Goose/Pi apply it next turn.",
  schema: { type: "boolean" },
  read: () => ({
    value: leanBasePromptPreference(),
    unsaved:
      unsavedPreference === undefined
        ? null
        : "This choice is active, but could not be saved on this device.",
  }),
  write: (value) => setLeanBasePromptPreference(value as boolean),
};
