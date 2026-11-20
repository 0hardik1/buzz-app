import { useMemo, useSyncExternalStore } from "react";
import {
  readView,
  subscribeView,
  viewRevision,
  writeView,
} from "../../shared/view-state";

const allKey = "sidebar:filter-all";

/** Cards whose person chose All, which saved preferences record as no entry. */
function chosenAll(scope: string): Record<string, true> {
  const saved = readView<unknown>(scope, allKey, {});
  return saved && typeof saved === "object" && !Array.isArray(saved)
    ? Object.fromEntries(
        Object.entries(saved).filter(
          (entry): entry is [string, true] => entry[1] === true,
        ),
      )
    : {};
}

/**
 * Whether each card's person chose All on this device. A card without a saved
 * filter defaults to the last 30 days, and preferences can't save All, so the
 * choice is kept here like the card's height and display.
 */
export function useSidebarFilterAll(scope: string) {
  const revision = useSyncExternalStore(
    (change) => subscribeView(scope, change),
    () => viewRevision(scope, allKey),
  );
  return useMemo(() => {
    const all = revision ? chosenAll(scope) : {};
    return (card: string) => all[card] === true;
  }, [scope, revision]);
}

export function setSidebarFilterAll(scope: string, card: string, all: boolean) {
  const { [card]: _, ...rest } = chosenAll(scope);
  writeView(scope, allKey, all ? { ...rest, [card]: true } : rest);
}
