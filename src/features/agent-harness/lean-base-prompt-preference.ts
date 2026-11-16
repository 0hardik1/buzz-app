import type { DeviceSetting } from "../../shared/device-settings";

const preferenceKey = "buzz-agents-lean-base-prompt.v1";
let unsavedPreference: boolean | undefined;

/** Device-local choice to give agents the lean base prompt: the turn
 * contract, Buzz tools and communication rules, without the memory,
 * engineering, repository and autonomy guidance. On by default.
 * Read when a session starts; running sessions keep their prompt. */
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
    "Agents started here get the lean base prompt: the turn contract, Buzz tools and communication rules only, without memory, engineering, repository and autonomy guidance; off gives the full base prompt. Applies to new agent sessions.",
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
