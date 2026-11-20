import { useSyncExternalStore } from "react";

/** What can alert about pull requests, each with its own switch. */
export const ALERT_KINDS = [
  { key: "review", label: "Your review is requested", on: true },
  { key: "teamReview", label: "Your team's review is requested", on: false },
  {
    key: "codeOwnerReview",
    label: "Your review is requested because you're a code owner",
    on: false,
  },
  {
    key: "reviewed",
    label: "Your pull request is approved or has changes requested",
    on: true,
  },
  { key: "assigned", label: "You're assigned to a pull request", on: true },
  { key: "comment", label: "Someone comments on your pull request", on: true },
  {
    key: "threadComment",
    label: "Someone comments on a pull request you're in",
    on: false,
  },
  { key: "mention", label: "You're mentioned on a pull request", on: true },
  { key: "merged", label: "Your pull request is merged", on: false },
  {
    key: "failedChecks",
    label: "Your pull request has failed checks",
    on: false,
  },
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
