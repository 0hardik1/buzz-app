import { useSyncExternalStore } from "react";

/** What GitHub notifies about that can alert, each with its own switch. */
export const ALERT_KINDS = [
  { key: "review", label: "Reviews requested from you", on: true },
  { key: "teamReview", label: "Reviews requested from your teams", on: false },
  {
    key: "codeOwnerReview",
    label: "Reviews requested because you're a code owner",
    on: false,
  },
  { key: "mention", label: "Mentions of you", on: true },
  { key: "teamMention", label: "Mentions of your teams", on: false },
] as const;

export type AlertKind = (typeof ALERT_KINDS)[number]["key"];
export type AlertChoices = Readonly<Record<AlertKind, boolean>>;

const key = "buzz.github.alerts.v1";
const changed = "buzz-github-alert-preferences-changed";

function saved(raw: string | null): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(raw ?? "");
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function stored(): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

let last: { raw: string | null; choices: AlertChoices } | undefined;

/** Device-local choices, read again for each GitHub notification. */
export function alertChoices(): AlertChoices {
  const raw = stored();
  if (last?.raw === raw) return last.choices;
  const choices = saved(raw);
  last = {
    raw,
    choices: Object.fromEntries(
      ALERT_KINDS.map((kind) => {
        const choice = choices[kind.key];
        return [kind.key, typeof choice === "boolean" ? choice : kind.on];
      }),
    ) as AlertChoices,
  };
  return last.choices;
}

export function setAlertChoice(kind: AlertKind, on: boolean): void {
  // Do not show the choice as changed if it could not be saved.
  localStorage.setItem(key, JSON.stringify({ ...saved(stored()), [kind]: on }));
  if (typeof window !== "undefined") window.dispatchEvent(new Event(changed));
}

function subscribe(listener: () => void) {
  const storage = (event: StorageEvent) => {
    if (event.key === key || event.key === null) listener();
  };
  window.addEventListener(changed, listener);
  window.addEventListener("storage", storage);
  return () => {
    window.removeEventListener(changed, listener);
    window.removeEventListener("storage", storage);
  };
}

export function useAlertChoices() {
  return useSyncExternalStore(subscribe, alertChoices);
}
