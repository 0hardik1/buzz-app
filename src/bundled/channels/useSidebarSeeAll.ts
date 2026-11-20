import { useSyncExternalStore } from "react";

/**
 * The card the sidebar has gone one level into with "See all", if any. The
 * sidebar shows only that card, at full length and unfiltered, until Back.
 * It lasts for this window's session, like an open menu.
 */
let card: string | undefined;
/** Just came Back, so the main level slides in once from the other side. */
let returning = false;
let settle: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

export function setSidebarSeeAll(next: string | undefined) {
  if (next === card) return;
  returning = card !== undefined && next === undefined;
  card = next;
  clearTimeout(settle);
  if (returning)
    settle = setTimeout(() => {
      returning = false;
      notify();
    }, 600);
  notify();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useSidebarSeeAllReturning() {
  return useSyncExternalStore(
    subscribe,
    () => returning,
    () => returning,
  );
}

export function useSidebarSeeAll() {
  return useSyncExternalStore(
    subscribe,
    () => card,
    () => card,
  );
}
