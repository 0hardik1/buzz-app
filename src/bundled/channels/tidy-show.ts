/**
 * The tour's "Tidy it up", performed: the sidebar glides to each of the first
 * few cards that will trim and trims it slowly in view, then trims the rest
 * at once. A card qualifies while it shows everything only because the tour
 * is unanswered and it holds more than the default.
 */

/** Cards trimmed in view; the rest trim together afterwards. */
const SHOWN = 3;

const listeners = new Set<() => void>();
const emit = () => {
  for (const listener of listeners) listener();
};
// Cards that would trim, by key, with their rows.
const untidy = new Map<string, HTMLElement>();
// Cards kept full until the show reaches them, once the tour is answered.
let held: ReadonlySet<string> = new Set();

export const tidyShow = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
  /** Whether any card would trim, so the tour asks. */
  pending: () => untidy.size > 0,
  held: (key: string) => held.has(key),
  /** A card that would trim registers its rows while it would. */
  register(key: string, rows: HTMLElement) {
    untidy.set(key, rows);
    emit();
    return () => {
      if (untidy.get(key) !== rows) return;
      untidy.delete(key);
      emit();
    };
  },
};

const release = (keys: Iterable<string>) => {
  const next = new Set(held);
  for (const key of keys) next.delete(key);
  held = next;
  emit();
};

/** Wait for the target's own event (not a descendant's), or the fallback. */
const until = (target: EventTarget, event: string, fallback: number) =>
  new Promise<void>((resolve) => {
    const done = () => {
      clearTimeout(timer);
      target.removeEventListener(event, heard);
      resolve();
    };
    const heard = (event: Event) => {
      if (event.target === target || target === window) done();
    };
    const timer = setTimeout(done, fallback);
    target.addEventListener(event, heard);
  });

/**
 * Answer the tour with `answer`, then trim. Cards stay full until their turn,
 * so an answer saved mid-show still trims everything the next time.
 */
export async function runTidyShow(answer: () => void) {
  const cards = [...untidy].sort(([, a], [, b]) =>
    a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1,
  );
  held = new Set(cards.map(([key]) => key));
  answer();
  emit();
  const still = globalThis.matchMedia?.(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  if (still) return release(cards.map(([key]) => key));
  for (const [key, rows] of cards.slice(0, SHOWN)) {
    const card = rows.closest<HTMLElement>("[data-sidebar-section]") ?? rows;
    const scroller = scrollParent(card);
    const view = scroller?.getBoundingClientRect();
    const place = card.getBoundingClientRect();
    if (view && (place.top < view.top || place.top > view.bottom - 96)) {
      card.scrollIntoView({ behavior: "smooth", block: "start" });
      await until(scroller ?? window, "scrollend", 700);
    }
    rows.setAttribute("data-card-showcase", "");
    release([key]);
    await until(rows, "transitionend", 1200);
    rows.removeAttribute("data-card-showcase");
  }
  release(cards.slice(SHOWN).map(([key]) => key));
}

function scrollParent(element: HTMLElement) {
  for (let node = element.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (
      /(auto|scroll)/.test(overflowY) &&
      node.scrollHeight > node.clientHeight
    )
      return node;
  }
  return undefined;
}
