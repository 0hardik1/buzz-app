/*
 * Moving focus and scrolling for Vim keys. Lists, menus and messages keep
 * their own arrow-key behavior: a move is that arrow, pressed on the focus.
 * Only what nothing handles falls back to scrolling.
 */
import { currentCursor, cursorRow, messageRows } from "./cursor";
import { WHICH_KEY } from "./pending";
import {
  activeMessageList,
  focusTarget,
  messageListOf,
  selectedMessage,
  selectMessage,
  selectNewestMessage,
} from "../../features/messages/message-selection";
import {
  composerFocusTarget,
  composerIn,
  focusKeyboardTarget,
  workspaces,
} from "../../app/focus-navigation";
import {
  conversationRows,
  CONVERSATION_LIST_LABEL,
} from "../channels/conversation-rows";

const ROW = "[data-message-id]";
const MODAL = '[aria-modal="true"], dialog[open]';
const UNAVAILABLE = '[hidden], [inert], [aria-hidden="true"]';
const TYPING =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
const LINE = 64;

export const focused = () => {
  const element = document.activeElement;
  return element instanceof HTMLElement && element !== document.body
    ? element
    : undefined;
};
export const typing = () => !!focused()?.matches(TYPING);
/** The open modal on top; one that is closing no longer holds the keys. */
const topModal = () =>
  [...document.querySelectorAll<HTMLElement>(MODAL)]
    .filter(
      (modal) => !modal.closest(UNAVAILABLE) && !modal.matches("[data-closed]"),
    )
    .at(-1);

/** Press a key on the focus as if typed; true when something handled it. */
export function press(target: HTMLElement, key: string) {
  const event = new KeyboardEvent("keydown", {
    key,
    bubbles: true,
    cancelable: true,
    composed: true,
  });
  target.dispatchEvent(event);
  return event.defaultPrevented;
}

function inView(element: HTMLElement, frame?: DOMRect) {
  const box = element.getBoundingClientRect();
  const { top, bottom } = frame ?? { top: 0, bottom: innerHeight };
  return (
    box.height > 0 &&
    box.bottom > top &&
    box.top < bottom &&
    !element.closest(UNAVAILABLE)
  );
}

/** Messages showing in `root`, oldest first. */
export function visibleMessages(root: ParentNode | undefined) {
  if (!root) return [];
  return [...root.querySelectorAll<HTMLElement>(ROW)].filter(
    (row) => !!row.dataset.messageId && inView(row),
  );
}

function scrollable(element: Element | null | undefined) {
  for (
    let node = element instanceof HTMLElement ? element : null;
    node && node !== document.documentElement;
    node = node.parentElement
  ) {
    if (
      /auto|scroll|overlay/.test(getComputedStyle(node).overflowY) &&
      node.scrollHeight > node.clientHeight + 1
    )
      return node;
  }
}

/** What scrolls: the focus's container, else the active conversation. */
function scroller() {
  const modal = topModal();
  return (
    scrollable(focused()) ??
    scrollable(visibleMessages(modal ?? activeMessageList())[0]) ??
    (modal ? scrollable(modal.firstElementChild) : undefined) ??
    document.scrollingElement
  );
}

/**
 * The message a move starts from. A menu, dialog or the sidebar keeps its
 * own focus; a part of a message starts from its message (or stays, for
 * `go`); anywhere else starts from the conversation's cursor.
 */
function resume(parts = false) {
  const origin = focused();
  if (origin?.closest(`${MODAL}, [role="menu"]`) || (origin && inSidebar()))
    return origin;
  const row = origin?.closest<HTMLElement>(ROW) ?? currentCursor();
  if (!row) return origin;
  const box = focusTarget(row);
  if (parts && origin && row.contains(origin)) return origin;
  if (origin !== box) selectMessage(row);
  return box;
}

/** `j` / `k`: the next or previous item, or message from the cursor. */
export function step(down: boolean, settled = false) {
  const origin = resume();
  const selected = selectedMessage();
  // A selection scrolled away is rendered alone; bring it back and let its
  // neighbors render, so the move reaches the message beside it.
  if (selected && !settled && !besideNeighbor(selected.element, down)) {
    focusTarget(selected.element).scrollIntoView?.({ block: "nearest" });
    let frames = 30;
    const wait = () => {
      if (besideNeighbor(selected.element, down) || --frames <= 0)
        step(down, true);
      else requestAnimationFrame(wait);
    };
    requestAnimationFrame(wait);
    return;
  }
  if (origin && press(origin, down ? "ArrowDown" : "ArrowUp")) {
    // Down past the newest message stays on it rather than typing.
    if (selected && typing()) selectMessage(selected.element);
    return;
  }
  // Sidebar rows are Tab stops without arrow keys; step between them.
  if (origin && sidebar()?.contains(origin)) {
    const rows = sidebarRows();
    const after = (row: HTMLElement) =>
      !!(
        origin.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING
      );
    const next = down
      ? rows.find(after)
      : rows.filter((row) => row !== origin && !after(row)).at(-1);
    if (next) focusItem(next);
    return;
  }
  // Past what is rendered, scrolling loads more.
  scroller()?.scrollBy({ top: down ? LINE : -LINE });
}

/** The sidebar's conversations that are showing. */
const sidebarRows = () =>
  conversationRows().filter((row) => row.getClientRects().length);

/** Focus a sidebar conversation, bringing it into view. */
function focusItem(
  item: HTMLElement,
  block: ScrollLogicalPosition = "nearest",
) {
  item.scrollIntoView?.({ block });
  focusKeyboardTarget(item);
}

/** Of `items`, the first about `distance` px past `from`, or the last. */
function halfPageFrom(
  items: HTMLElement[],
  from: HTMLElement,
  distance: number,
  down: boolean,
) {
  const goal = from.getBoundingClientRect().top + (down ? distance : -distance);
  const top = (item: HTMLElement) => item.getBoundingClientRect().top;
  return down
    ? (items.find((item) => top(item) >= goal) ?? items.at(-1))
    : (items.filter((item) => top(item) <= goal).at(-1) ?? items[0]);
}

/** `h` / `l`: left or right in lists and trees; → on a message opens its thread. */
export function sideways(right: boolean) {
  const origin = focused();
  if (origin) press(origin, right ? "ArrowRight" : "ArrowLeft");
}

/** The list a message belongs to, with its rendered messages. */
function listRows(row: HTMLElement) {
  const list = messageListOf(row)?.element;
  return list ? messageRows(list) : [];
}

/** Whether the message's rendered neighbor that way is the one beside it. */
function besideNeighbor(row: HTMLElement, down: boolean) {
  const rows = listRows(row);
  const neighbor = rows[rows.indexOf(row) + (down ? 1 : -1)];
  // Below the last rendered message, a newer one may still be rendering.
  if (!neighbor)
    return !down || row.dataset.messageId === messageListOf(row)?.list.newest();
  const box = row.getBoundingClientRect();
  const near = neighbor.getBoundingClientRect();
  // ponytail: a fixed gap; rows sit flush or a margin apart.
  return (down ? near.top - box.bottom : box.top - near.bottom) < LINE;
}

/**
 * `gg` / `G`: the first or last sidebar conversation, menu or list item, or
 * the oldest loaded or newest message once scrolling there has rendered it.
 * Without any of those, just scroll.
 */
function edge(down: boolean) {
  const origin = resume();
  if (origin && inSidebar()) {
    const rows = sidebarRows();
    const next = down ? rows.at(-1) : rows[0];
    if (next) focusItem(next);
    return;
  }
  const menu = origin?.closest<HTMLElement>('[role="menu"]');
  if (menu) {
    const items = [
      ...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]'),
    ].filter(
      (item) =>
        item.closest('[role="menu"]') === menu &&
        item.getAttribute("aria-disabled") !== "true",
    );
    (down ? items.at(-1) : items[0])?.focus();
    return;
  }
  const row = origin?.closest<HTMLElement>(ROW);
  // A list moves its own selection to its first or last item.
  if (!row && origin && press(origin, down ? "End" : "Home")) return;
  const target = scroller();
  if (!target) return;
  const list = row && messageListOf(row)?.element;
  let frames = 60;
  let last = Number.NaN;
  const settle = () => {
    if (down && list && selectNewestMessage(list)) return;
    // The top can stop short of 0 at the history's edge; wait for rest.
    const oldest =
      !down && list && target.scrollTop === last && messageRows(list)[0];
    if (oldest) return selectMessage(oldest);
    last = target.scrollTop;
    target.scrollTo({ top: down ? target.scrollHeight : 0 });
    if (list && --frames > 0) requestAnimationFrame(settle);
  };
  target.scrollTo({ top: down ? target.scrollHeight : 0 });
  if (list) requestAnimationFrame(settle);
}
export const top = () => edge(false);
export const bottom = () => edge(true);

/**
 * `<C-d>` / `<C-u>`: the message or sidebar conversation half a page below
 * or above, centred (Neovim's `<C-d>zz`); a list's own page keys; else half
 * a page of scrolling.
 */
export function halfPage(down: boolean) {
  const origin = resume();
  const half = (element: Element | null | undefined) =>
    (scrollable(element)?.clientHeight ?? innerHeight) / 2;
  if (origin && inSidebar()) {
    const next = halfPageFrom(sidebarRows(), origin, half(origin), down);
    if (next) focusItem(next, "center");
    return;
  }
  const row = origin?.closest<HTMLElement>(ROW);
  if (!row) {
    if (origin && press(origin, down ? "PageDown" : "PageUp")) return;
    const target = scroller();
    return target?.scrollBy({ top: (down ? 1 : -1) * half(target) });
  }
  const next = halfPageFrom(listRows(row), row, half(row), down);
  if (!next) return;
  selectMessage(next);
  focusTarget(next).scrollIntoView?.({ block: "center" });
}

/** Parts of a message that take focus: its author, links, files, reactions. */
const PART =
  'a[href], button:not(:disabled), summary, [tabindex]:not([tabindex="-1"])';

/**
 * The focused message, then its parts in order; undefined when the focus is
 * not in a message or it has no parts. Its hover toolbar is left to `go`.
 */
export function messageStops() {
  const origin = focused();
  const row = origin?.closest<HTMLElement>(ROW);
  if (!origin || !row || origin.matches(TYPING)) return;
  const parts = [...row.querySelectorAll<HTMLElement>(PART)].filter(
    (part) =>
      part.closest(ROW) === row &&
      !part.closest('[role="group"]') &&
      part.getClientRects().length > 0 &&
      !part.closest(UNAVAILABLE),
  );
  return parts.length
    ? { row, stops: [focusTarget(row), ...parts] }
    : undefined;
}

/** Tab / Shift-Tab: the message's next or previous part, wrapping to itself. */
export function stepPart(forward: boolean) {
  const found = messageStops();
  if (!found) return;
  const { row, stops } = found;
  const index = Math.max(0, stops.indexOf(focused() as HTMLElement));
  const next =
    stops[(index + (forward ? 1 : -1) + stops.length) % stops.length];
  if (next === stops[0]) selectMessage(row);
  else focusKeyboardTarget(next);
}

/** Escape: back to the cursor's message, from a field, its parts or the sidebar. */
export function leave() {
  const origin = focused();
  const pane = currentPane();
  const row =
    origin?.closest<HTMLElement>(ROW) ??
    (pane && pane !== sidebar() ? cursorRow(pane) : undefined) ??
    currentCursor();
  if (row && !topModal()) return selectMessage(row);
  origin?.blur();
}

export const focusComposer = () => focusKeyboardTarget(composerFocusTarget());

function sidebar() {
  const list = document.querySelector<HTMLElement>(
    `nav[aria-label="${CONVERSATION_LIST_LABEL}"]`,
  );
  return list?.getClientRects().length && !list.closest(UNAVAILABLE)
    ? list
    : undefined;
}

/** The open conversation's sidebar row, focused and scrolled into view. */
export function revealConversation() {
  const rows = conversationRows();
  const row =
    rows.find(
      (candidate) => candidate.getAttribute("aria-current") === "page",
    ) ?? rows[0];
  if (!row || !sidebar()?.contains(row)) return false;
  row.scrollIntoView({ block: "nearest" });
  focusKeyboardTarget(row);
  return true;
}

/** Sidebar, conversation and side panel, left to right. */
function panes() {
  const list = sidebar();
  return [...(list ? [list] : []), ...workspaces()]
    .filter(
      (pane) => pane.getClientRects().length && !pane.closest(UNAVAILABLE),
    )
    .sort(
      (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
    );
}

const currentPane = () => {
  const origin = focused();
  return origin ? panes().find((pane) => pane.contains(origin)) : undefined;
};

/** Focus a pane without typing into it: its newest message, else its entry. */
function enter(pane: HTMLElement) {
  if (pane === sidebar()) return revealConversation();
  const newest = cursorRow(pane) ?? visibleMessages(pane).at(-1);
  if (newest) return selectMessage(newest);
  focusKeyboardTarget(
    composerIn(pane) ??
      pane.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]') ??
      undefined,
  );
}

/** `<C-h>` / `<C-l>`: the pane to the left or right. */
export function focusPane(right: boolean) {
  const all = panes();
  const current = currentPane();
  const index = current ? all.indexOf(current) : right ? -1 : all.length;
  const next = all[index + (right ? 1 : -1)];
  if (next) enter(next);
}

/** `<C-k>`: this pane's messages, or the conversation's from the sidebar. */
export function focusMessages() {
  const pane = currentPane();
  const workspace =
    pane && pane !== sidebar()
      ? pane
      : panes().find((candidate) => candidate !== sidebar());
  const newest = cursorRow(workspace) ?? visibleMessages(workspace).at(-1);
  if (newest) selectMessage(newest);
}

/** Where `<leader>/` searches: the sidebar's conversations, or a conversation. */
export const inSidebar = () => {
  const origin = focused();
  return !!origin && !!sidebar()?.contains(origin);
};

/**
 * `go`: open the focused item's own action menu, the one right-click, the
 * Menu key and Shift+F10 open. False when the focus has none.
 */
export function openActions() {
  const origin = resume(true);
  if (!origin || !press(origin, "ContextMenu")) return false;
  // WebKit can leave focus on the item; the menu's keys need it inside.
  let frames = 10;
  const settle = () => {
    const menu = [
      ...document.querySelectorAll<HTMLElement>('[role="menu"][data-open]'),
    ].find((popup) => !popup.closest(`[${WHICH_KEY}]`));
    if (menu?.contains(document.activeElement)) return;
    if (menu) menu.focus();
    else if (--frames > 0) requestAnimationFrame(settle);
  };
  settle();
  return true;
}
