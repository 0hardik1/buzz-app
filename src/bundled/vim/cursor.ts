/*
 * Vim's cursor is where focus is, so there is only ever one. Each message
 * list remembers its selected message, so focus can return to it; only a move
 * or a click changes it, and scrolling never does. The message holding focus
 * in a focused window is marked with `data-message-cursor`, which the host
 * paints like a selected message; a remembered one elsewhere is not. Outside
 * a field, focus stays on a message: an opened conversation, a click in the
 * timeline or sidebar and focus falling to nothing all return focus to it,
 * without scrolling.
 */
import { CONVERSATION_LIST_LABEL } from "../channels/conversation-rows";
import {
  focusTarget,
  messageListElements,
  messageListOf,
  type MessageList,
} from "../../features/messages/message-selection";

export const CURSOR = "data-message-cursor";
const ROW = "[data-message-id]";
const WORKSPACE = "[data-channel-workspace]";
const TYPING =
  'input, textarea, select, [contenteditable]:not([contenteditable="false"]), [role="textbox"]';
/** Surfaces that own focus while open or closing, until they return it. */
const OVERLAY =
  '[aria-modal="true"]:not([data-closed]), [role="dialog"]:not([aria-modal="false"]), dialog[open], [role="menu"], [data-vim-which-key]';
/** Clicks in the sidebar's conversations leave focus on the cursor. */
const SIDEBAR = `nav[aria-label="${CONVERSATION_LIST_LABEL}"]`;

type Cursor = {
  id: string;
  owner: MessageList;
  /** Neighbors, for when the message is deleted. */
  before?: string | undefined;
  after?: string | undefined;
  release?: (() => void) | undefined;
};
/** A conversation's main list is keyed by conversation, so it survives a visit. */
const cursors = new Map<string | HTMLElement, Cursor>();
let lastList: HTMLElement | undefined;

/** The list's own message rows, not a nested list's or an unavailable one. */
export const messageRows = (list: HTMLElement) =>
  [...list.querySelectorAll<HTMLElement>(ROW)].filter(
    (row) =>
      !!row.dataset.messageId &&
      messageListOf(row)?.element === list &&
      !row.closest('[inert], [hidden], [aria-hidden="true"]'),
  );

function keyOf(list: HTMLElement) {
  const workspace = list.closest<HTMLElement>(WORKSPACE);
  // A side panel's thread has its own cursor, not the conversation's.
  const outermost =
    workspace &&
    !list.closest("[data-panel-workspace]") &&
    !messageListElements().some(
      (other) =>
        other !== list && other.contains(list) && workspace.contains(other),
    );
  return outermost
    ? `conversation:${workspace.dataset.channelWorkspace}`
    : list;
}

function place(list: HTMLElement, owner: MessageList, id: string) {
  const key = keyOf(list);
  const current = cursors.get(key);
  if (current?.id === id && current.owner === owner) return current;
  current?.release?.();
  const next: Cursor = { id, owner, release: owner.keepMounted?.(id) };
  cursors.set(key, next);
  return next;
}

/** The list's remembered message, when it is rendered. */
function remembered(list: HTMLElement) {
  const id = cursors.get(keyOf(list))?.id;
  return id
    ? messageRows(list).find((row) => row.dataset.messageId === id)
    : undefined;
}

/** The remembered message in a list or pane, preferring the last moved in. */
export function cursorRow(root: Node | null | undefined) {
  if (!root) return;
  const lists = messageListElements().filter((list) => root.contains(list));
  if (lastList && lists.includes(lastList)) lists.unshift(lastList);
  for (const list of lists) {
    const row = remembered(list);
    if (row) return row;
  }
}

/** The cursor of the list last moved in, else of the open conversation. */
export function currentCursor() {
  const main = document.querySelector<HTMLElement>(
    `#main-content ${WORKSPACE}`,
  );
  return (
    (lastList?.isConnected ? remembered(lastList) : undefined) ??
    cursorRow(main)
  );
}

/** The newest rendered message of the first list in `root`. */
export function newestRow(root: Node | null | undefined) {
  const list = messageListElements().find((list) => root?.contains(list));
  const id = list && messageListOf(list)?.list.newest();
  return id
    ? messageRows(list).find((row) => row.dataset.messageId === id)
    : undefined;
}

let claimFocus: ((find: () => HTMLElement | undefined) => void) | undefined;
/**
 * Give focus to what `find` returns once it renders, and keep it there until
 * the reader's next key or click: an opened thread's message, say, rather
 * than its message box.
 */
export const claim = (find: () => HTMLElement | undefined) =>
  claimFocus?.(find);

const overlayOpen = () => !!document.querySelector(OVERLAY);
const isNowhere = () =>
  !document.activeElement || document.activeElement === document.body;

/** Focus a message without scrolling: only a move scrolls. */
export function focusMessage(row: HTMLElement) {
  const box = focusTarget(row);
  if (!box.hasAttribute("tabindex")) box.tabIndex = -1;
  if (document.activeElement !== box) box.focus({ preventScroll: true });
}

/** Set each list's cursor, newest first and a neighbor after a deletion. */
function mark() {
  for (const [key, cursor] of cursors)
    if (key instanceof HTMLElement && !key.isConnected) {
      cursor.release?.();
      cursors.delete(key);
    }
  for (const list of messageListElements()) {
    const owner = messageListOf(list)?.list;
    if (!owner || !list.isConnected) continue;
    const previous = cursors.get(keyOf(list));
    const id =
      previous && owner.row(previous.id)
        ? previous.id
        : ([previous?.after, previous?.before].find(
            (near) => near && owner.row(near),
          ) ?? owner.newest());
    if (!id) continue;
    const cursor = place(list, owner, id);
    const rows = messageRows(list);
    const index = rows.findIndex((row) => row.dataset.messageId === cursor.id);
    const row = rows[index];
    if (row) {
      cursor.before = rows[index - 1]?.dataset.messageId;
      cursor.after = rows[index + 1]?.dataset.messageId;
    }
    // Only where focus is: not a nested list's row, a menu or another window.
    const box =
      row && document.hasFocus() && document.activeElement?.closest(ROW) === row
        ? focusTarget(row)
        : undefined;
    for (const stale of list.querySelectorAll(`[${CURSOR}]`))
      if (stale !== box && messageListOf(stale)?.element === list)
        stale.removeAttribute(CURSOR);
    box?.setAttribute(CURSOR, "");
  }
}

/** Track and mark cursors, and keep focus on them, until cleanup runs. */
export function trackCursor() {
  let frame = 0;
  /** What takes focus until the reader's own input, such as a just-opened
   * conversation's cursor rather than its composer. */
  let claimed: (() => HTMLElement | undefined) | undefined;
  let shown: string | undefined;
  let clicked = false;
  /** The reader's last input was the pointer, which may use the toolbar. */
  let pointing = false;
  const sync = () => {
    frame = 0;
    // Place each list's cursor, move focus, then mark where focus ended up.
    mark();
    settle();
    mark();
  };
  const settle = () => {
    const workspace = document.querySelector<HTMLElement>(
      `#main-content ${WORKSPACE}`,
    );
    const open = workspace?.dataset.channelWorkspace || undefined;
    if (open !== shown) {
      shown = open;
      claimed = open ? () => cursorRow(workspace) : undefined;
    }
    if (overlayOpen()) return;
    const active = document.activeElement;
    const nowhere = isNowhere();
    const typing = !!active?.matches(TYPING);
    const inMessage = !!active?.closest(ROW);
    if (claimed) {
      const row = claimed();
      if (row) {
        // Kept until the reader's own input, so a late handoff (a dialog's
        // return focus, the composer's) cannot take focus after it.
        focusMessage(row);
        return;
      }
    }
    // A message's hover toolbar is not a stop: focus a closing picker or
    // menu returns there by keyboard goes to the message instead.
    const toolbar = active?.closest(`${ROW} [role="group"]`);
    if (toolbar && !pointing) {
      const row = toolbar.closest<HTMLElement>(ROW);
      if (row) focusMessage(row);
      return;
    }
    const afterClick = clicked;
    clicked = false;
    if (afterClick && !typing && !inMessage && !nowhere) {
      const row = currentCursor();
      if (row) focusMessage(row);
    }
    // Focus can pass through nothing on its way back; restore only if it stays.
    if (nowhere)
      requestAnimationFrame(() => {
        const row = currentCursor();
        if (isNowhere() && !overlayOpen() && row) focusMessage(row);
      });
  };
  const schedule = () => {
    frame ||= requestAnimationFrame(sync);
  };
  const focusin = (event: Event) => {
    const row =
      event.target instanceof Element
        ? event.target.closest<HTMLElement>(ROW)
        : null;
    const owner = row && messageListOf(row);
    const id = row?.dataset.messageId;
    if (owner && id && owner.list.row(id)) {
      place(owner.element, owner.list, id);
      lastList = owner.element;
    }
    schedule();
  };
  /** Input outside a dialog chooses where focus goes; in one, it is the dialog's. */
  const choose = (event: Event) => {
    pointing = event.type === "pointerdown";
    if (!overlayOpen()) claimed = undefined;
  };
  claimFocus = (find) => {
    claimed = find;
    schedule();
  };
  const pointerdown = (event: PointerEvent) => {
    choose(event);
    focusin(event);
  };
  const click = (event: MouseEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target && (target.closest(SIDEBAR) || messageListOf(target)))
      clicked = true;
    schedule();
  };
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, {
    childList: true,
    subtree: true,
    attributeFilter: ["data-channel-workspace"],
  });
  document.addEventListener("focusin", focusin, true);
  document.addEventListener("focusout", schedule, true);
  document.addEventListener("pointerdown", pointerdown, true);
  document.addEventListener("click", click, true);
  addEventListener("keydown", choose, true);
  addEventListener("focus", schedule);
  addEventListener("blur", schedule);
  schedule();
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
    document.removeEventListener("focusin", focusin, true);
    document.removeEventListener("focusout", schedule, true);
    document.removeEventListener("pointerdown", pointerdown, true);
    document.removeEventListener("click", click, true);
    removeEventListener("keydown", choose, true);
    removeEventListener("focus", schedule);
    removeEventListener("blur", schedule);
    claimFocus = undefined;
    for (const cursor of cursors.values()) cursor.release?.();
    cursors.clear();
    lastList = undefined;
    for (const box of document.querySelectorAll(`[${CURSOR}]`))
      box.removeAttribute(CURSOR);
  };
}
