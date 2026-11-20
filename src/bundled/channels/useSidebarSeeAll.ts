import { useSyncExternalStore } from "react";

/**
 * The card the sidebar has gone one level into with "See all", if any. The
 * sidebar shows only that card, at full length and unfiltered, until Back.
 * It lasts for this window's session, like an open menu.
 */
let card: string | undefined;
/** Just came Back, so the main level slides in once from the other side. */
let returning = false;
/** Where the main level was scrolled when See all opened, for Back. */
let leftAt: number | undefined;
let settle: ReturnType<typeof setTimeout> | undefined;
const listeners = new Set<() => void>();
const notify = () => {
  for (const listener of listeners) listener();
};

/**
 * Go into a card (`scrollTop` is where the main level was scrolled) or back
 * out of it. Back keeps that position for the card to restore.
 */
export function setSidebarSeeAll(next: string | undefined, scrollTop?: number) {
  if (next === card) return;
  if (next !== undefined) leftAt = scrollTop;
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

/** The main level's scroll position from before See all, read once on Back. */
export function takeSidebarSeeAllScroll() {
  const top = leftAt;
  leftAt = undefined;
  return top;
}
