import type { Navigation } from "../navigation/controller";
import { type OpenTarget, targetKey } from "../navigation/targets";
import {
  type ComposerName,
  channelComposer,
  composerChannel,
  composerThread,
  threadComposer,
} from "./composer-overlay";

/**
 * What a conversation workspace reads over its composers, and how that takes
 * part in Back/Forward. One owner holds it all:
 *
 * - An **item** is a thread, a panel or a details message, read in a
 *   **slot**: the composer it sits over (its conversation's, or a thread's
 *   reply box), or a dialog where no composer can hold it. A slot holds one
 *   item; a thread item is itself the slot of its reply box, so what opens
 *   from an inline thread stacks on it.
 * - Each history visit has one **event**: an item opened in its slot (or a
 *   panel moved to another page), or an arrival the sheets did not make, such
 *   as a link or a reload, which shows exactly what its address names.
 * - What is on screen is those events folded over the retained visits up to
 *   the current one. Close deletes items and retires their visits, so the
 *   fold never shows them again.
 *
 * Where an item opens is decided once, when it opens; where it is drawn
 * follows from its slot, so nothing waits for a composer to mount.
 */

export type ThreadContent = Readonly<{
  kind: "thread";
  channelId: string;
  rootId: string;
  /** The message to reveal, the root or a reply in it. */
  messageId: string;
  /** Opened to reply: its reply box takes focus. */
  reply?: boolean | undefined;
}>;
export type PanelContent = Readonly<{
  kind: "panel";
  channelId: string;
  /** The thread the link was in. */
  rootId?: string | undefined;
  title: string;
  /** Its sheet's close button, when not plain "Close". */
  closeLabel?: string | undefined;
  /** As a tab, it joins the open ones rather than replacing a passing one. */
  append?: boolean | undefined;
  /** The page's address: opening it again in a slot replaces it. */
  target: string;
  /** The workspace's own description of the panel, which it draws. */
  opening: unknown;
}>;
export type DetailsContent = Readonly<{
  kind: "details";
  channelId: string;
  messageId: string;
}>;
export type ReadingContent = ThreadContent | PanelContent | DetailsContent;

/** A composer, or a dialog where no composer can hold what opens. */
export type Slot = ComposerName | "dialog";

export type Item = Readonly<{
  id: string;
  slot: Slot;
  /** Sheets read over the conversation and inline threads; elsewhere only
   * details read over a reply box. Only a scope of the same kind draws it. */
  sheets: boolean;
  /** What it was opened to read; events say what it shows at each visit. */
  content: ReadingContent;
  /** Where focus returns when it closes. Live only, never history. */
  trigger?: HTMLElement | null | undefined;
}>;
export type Shown = Readonly<{ item: Item; content: ReadingContent }>;

type ReadingEvent =
  | Readonly<{ kind: "open"; item: string; content: ReadingContent }>
  | Readonly<{
      kind: "arrive";
      shown: readonly Readonly<{ item: string; content: ReadingContent }>[];
    }>;

type ReadingState = Readonly<{
  items: ReadonlyMap<string, Item>;
  /** By visit id. */
  events: ReadonlyMap<string, ReadingEvent>;
}>;

/** The reply box a thread item holds, where what opens from it stacks. */
export const provides = (item: Pick<Item, "content" | "slot">) =>
  item.content.kind === "thread" && item.slot !== "dialog"
    ? threadComposer(item.content.channelId, item.content.rootId)
    : undefined;

/** Two contents read the same thing, so one replaces the other in place. */
function sameContent(a: ReadingContent, b: ReadingContent) {
  if (a.kind !== b.kind || a.channelId !== b.channelId) return false;
  switch (a.kind) {
    case "thread":
      return a.rootId === (b as ThreadContent).rootId;
    case "panel":
      return a.target === (b as PanelContent).target;
    default:
      return a.messageId === (b as DetailsContent).messageId;
  }
}

/** Removes what is in `slot`, and what stacks on it. */
function clear(slots: Map<Slot, Shown>, slot: Slot) {
  const shown = slots.get(slot);
  if (!shown) return;
  slots.delete(slot);
  const above = provides(shown.item);
  if (above) clear(slots, above);
}

/**
 * What is shown at the last of `visits`, oldest first. A visit with no event
 * shows nothing: it is one the sheets never saw, such as before a reload.
 */
export function fold(
  state: ReadingState,
  visits: readonly string[],
): ReadonlyMap<Slot, Shown> {
  let slots = new Map<Slot, Shown>();
  for (const visit of visits) {
    const event = state.events.get(visit);
    if (!event) {
      slots = new Map();
      continue;
    }
    if (event.kind === "open") {
      const item = state.items.get(event.item);
      if (!item) continue;
      clear(slots, item.slot);
      slots.set(item.slot, { item, content: event.content });
      continue;
    }
    slots = new Map();
    for (const shown of event.shown) {
      const item = state.items.get(shown.item);
      if (item) slots.set(item.slot, { item, content: shown.content });
    }
  }
  // What stacks on an inline thread shows only while that thread does.
  for (const [slot, shown] of [...slots]) {
    const thread = composerThread(slot);
    if (!shown.item.sheets || !thread || !slots.has(slot)) continue;
    const held = [...slots.values()].some(
      (other) => provides(other.item) === slot,
    );
    if (!held) clear(slots, slot);
  }
  return slots;
}

/** Every item stacked on `ids`, including them, whether shown or not. */
export function stacked(state: ReadingState, ids: Iterable<string>) {
  const closing = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of state.items.values()) {
      if (closing.has(item.id) || !item.sheets) continue;
      const below = [...closing].some((id) => {
        const other = state.items.get(id);
        return !!other && provides(other) === item.slot;
      });
      if (below) {
        closing.add(item.id);
        grew = true;
      }
    }
  }
  return closing;
}

/** The visits that showed only what `ids` closes: their opens, and the
 * arrivals that showed nothing else. Close retires these. */
function visitsOf(state: ReadingState, ids: ReadonlySet<string>) {
  const visits: string[] = [];
  for (const [visit, event] of state.events) {
    if (
      event.kind === "open"
        ? ids.has(event.item)
        : event.shown.length > 0 &&
          event.shown.every((shown) => ids.has(shown.item))
    )
      visits.push(visit);
  }
  return visits;
}

/** The state without `ids` and the visits that only showed them. */
export function without(
  state: ReadingState,
  ids: ReadonlySet<string>,
): ReadingState {
  if (!ids.size) return state;
  const items = new Map(state.items);
  for (const id of ids) items.delete(id);
  const retired = new Set(visitsOf(state, ids));
  const events = new Map(
    [...state.events].filter(([visit]) => !retired.has(visit)),
  );
  return { items, events };
}

/** Keeps only events of `retained` visits, and items some event names. */
export function pruned(
  state: ReadingState,
  retained: readonly string[] | undefined,
  keep: ReadonlySet<string> = new Set(),
): ReadingState {
  const known = retained && new Set(retained);
  const events = known
    ? new Map([...state.events].filter(([visit]) => known.has(visit)))
    : state.events;
  const named = new Set(keep);
  for (const event of events.values())
    if (event.kind === "open") named.add(event.item);
    else for (const shown of event.shown) named.add(shown.item);
  const items = new Map([...state.items].filter(([id]) => named.has(id)));
  return events.size === state.events.size && items.size === state.items.size
    ? state
    : { items, events };
}

type ConversationTarget = Extract<OpenTarget, { kind: "conversation" }>;
/** The conversation an address is in, without what reads over it. */
export const conversationOf = (
  target: ConversationTarget,
): ConversationTarget => ({
  version: 1,
  kind: "conversation",
  scope: target.scope,
  channelId: target.channelId,
});

/** The address of a thread, read from its root. */
const threadAt = (
  base: ConversationTarget,
  rootId: string,
): ConversationTarget => ({ ...base, messageId: rootId, threadRootId: rootId });

/**
 * The address of `content` opened in `slot`, from the current one, so opening
 * it is a visit: a thread by its root, a panel by its target, and details as
 * a `reader` over the address of the conversation or thread it reads over.
 * Undefined where it has none, as outside a conversation.
 */
function addressOf(
  content: ReadingContent,
  slot: Slot,
  current: OpenTarget,
): OpenTarget | undefined {
  if (current.kind !== "conversation") return undefined;
  const base = conversationOf(current);
  const thread = slot === "dialog" ? undefined : composerThread(slot);
  const beneath =
    slot === "dialog"
      ? omit(current, "reader")
      : thread && composerChannel(slot) === current.channelId
        ? threadAt(base, thread)
        : base;
  switch (content.kind) {
    case "thread":
      return threadAt(base, content.rootId);
    case "panel":
      return {
        ...beneath,
        detail: {
          target: content.target,
          ...(content.rootId && content.channelId === current.channelId
            ? { rootId: content.rootId }
            : {}),
        },
      };
    default: {
      const rootId = slot === "dialog" ? current.threadRootId : thread;
      return {
        ...beneath,
        reader: {
          messageId: content.messageId,
          ...(rootId ? { rootId } : {}),
        },
      };
    }
  }
}
/** `target` without the parts named by `keys`. */
const omit = (
  target: ConversationTarget,
  ...keys: ("reader" | "detail" | "messageId" | "threadRootId")[]
): ConversationTarget => {
  const next: Record<string, unknown> = { ...target };
  for (const key of keys) delete next[key];
  return next as ConversationTarget;
};

/** What the workspace does that the sheets cannot: its tabs. */
export type ReadingHost = Readonly<{
  /** The Inline setting. */
  inline(): boolean;
  hasThreadTab(channelId: string, rootId: string): boolean;
  /** Shows a thread in its tab, from Open as tab with where it was read. */
  openThreadTab(content: ThreadContent, handoff?: ThreadHandoff): void;
  hasPanelTab(content: PanelContent): boolean;
  openPanelTab(content: PanelContent): void;
  /** A tab takes over these visits, which its Close retires. */
  adoptVisits(content: ThreadContent | PanelContent, visits: string[]): void;
}>;

/** What a thread read inline hands its tab: the reply it reads at, unless it
 * follows the latest, and the reply it is answering. */
export type ThreadHandoff = Readonly<{
  anchor?: string | undefined;
  replyParent?: string | undefined;
}>;

/** Where a row asks to open something: the composer of its scope, and
 * whether that scope reads sheets (the conversation, or an inline thread). */
export type ReadingOrigin = Readonly<{
  composer: ComposerName | undefined;
  sheets: boolean;
  /** Its composer is on screen and Inline is on. */
  onScreen: boolean;
}>;

export type Reading = Readonly<{
  /** What is shown now, by slot. */
  shown(): ReadonlyMap<Slot, Shown>;
  subscribe(listener: () => void): () => void;
  openThread(
    content: ThreadContent,
    origin: ReadingOrigin,
    trigger?: HTMLElement | null,
  ): void;
  openPanel(
    content: PanelContent,
    origin: ReadingOrigin,
    trigger?: HTMLElement | null,
  ): void;
  openDetails(
    content: DetailsContent,
    origin: ReadingOrigin,
    trigger?: HTMLElement | null,
  ): void;
  /** A panel moved to another page in place: a visit of its own. */
  navigate(item: string, content: PanelContent): void;
  /** ✕, Escape, the scrim: closes it and what stacks on it, retiring their
   * visits, so neither Back nor Forward shows them again. */
  close(item: string): void;
  /** Open as tab: its tab shows it from now on, with its visits. What stacks
   * on it closes. Its address stays, so this adds no visit. */
  moveToTab(item: string, handoff?: ThreadHandoff): void;
  /** A send from `composer` closes the details over it. */
  sent(composer: ComposerName): void;
  /** A tab closing for good closes what reads over its composer: returns
   * their visits, for the tab's dismissal to retire with its own. */
  retire(composer: ComposerName): string[];
  /** A thread now shows in its tab: its sheet closes, its visits go to the
   * tab, and what stacks on it closes. */
  handOver(channelId: string, rootId: string): void;
  /** The address the page presents: without what the sheets show. */
  page(target: OpenTarget): OpenTarget;
  /** The current visit shows something the page does not. */
  presents(): boolean;
  /** Ties it to navigation; returns the release. */
  attach(navigator: Navigation): () => void;
  state(): ReadingState;
}>;

/** The page's address for `target`, without what `shown` reads over it. */
export function pageTarget(
  target: OpenTarget,
  shown: ReadonlyMap<Slot, Shown>,
): OpenTarget {
  if (target.kind !== "conversation") return target;
  const sheets = [...shown.values()].filter((item) => item.item.sheets);
  const thread = sheets.find(
    (item) =>
      item.content.kind === "thread" &&
      item.content.channelId === target.channelId &&
      item.content.rootId === target.threadRootId,
  );
  const panel = sheets.find(
    (item) =>
      item.content.kind === "panel" &&
      item.content.target === target.detail?.target,
  );
  if (!thread && !panel && !target.reader) return target;
  return omit(
    target,
    "reader",
    ...(panel ? (["detail"] as const) : []),
    ...(thread ? (["messageId", "threadRootId"] as const) : []),
  );
}

/** `target` without the parts that name `closing`: what it returns to when
 * they close. */
function withoutNamed(
  target: OpenTarget,
  closing: readonly ReadingContent[],
): OpenTarget | undefined {
  if (target.kind !== "conversation") return undefined;
  let next: ConversationTarget = target;
  for (const content of closing) {
    if (content.kind === "details") next = omit(next, "reader");
    else if (content.kind === "panel") next = omit(next, "detail");
    else if (next.threadRootId === content.rootId)
      next = omit(next, "messageId", "threadRootId");
  }
  return next;
}

let sequence = 0;
const nextId = () => `reading-${++sequence}`;

export function createReading(host: () => ReadingHost): Reading {
  let state: ReadingState = { items: new Map(), events: new Map() };
  let navigator: Navigation | undefined;
  let shown: ReadonlyMap<Slot, Shown> = new Map();
  let pushing = false;
  /**
   * A close returning from the visit it retired. The return can arrive after
   * the close (a browser traversal), so until then that visit reads as its
   * fallback, showing what remains, and its arrival keeps that.
   */
  let leaving:
    | Readonly<{
        visit: string;
        fallback: OpenTarget;
        remaining: ReadonlyMap<Slot, Shown>;
      }>
    | undefined;
  const departing = () =>
    leaving && leaving.visit === current()?.id ? leaving : undefined;
  const listeners = new Set<() => void>();
  const visitsUpTo = () => {
    if (!navigator) return [];
    const snapshot = navigator.snapshot();
    const id = snapshot.entry.id;
    const retained = snapshot.retainedVisits;
    const at = retained?.indexOf(id) ?? -1;
    return at === -1 ? [id] : (retained as readonly string[]).slice(0, at + 1);
  };
  const publish = (next: ReadingState) => {
    state = next;
    const gone = departing();
    const folded = gone
      ? new Map(
          [...gone.remaining].filter(([, item]) =>
            state.items.has(item.item.id),
          ),
        )
      : fold(state, visitsUpTo());
    const changed =
      folded.size !== shown.size ||
      [...folded].some(([slot, item]) => {
        const before = shown.get(slot);
        return before?.item !== item.item || before.content !== item.content;
      });
    if (changed) shown = folded;
    for (const listener of listeners) listener();
  };
  // A navigator stub may name visits without addresses.
  const current = () => {
    const entry = navigator?.snapshot().entry;
    return entry?.target ? entry : undefined;
  };
  /** An item for `content` in `slot`: the one already reading it there, so
   * its earlier visits stay its own, or a new one. */
  const itemFor = (
    content: ReadingContent,
    slot: Slot,
    sheets: boolean,
    trigger?: HTMLElement | null,
  ): Item => {
    const existing = [...state.items.values()].find(
      (item) =>
        item.slot === slot &&
        item.sheets === sheets &&
        sameContent(item.content, content),
    );
    return {
      id: existing?.id ?? nextId(),
      slot,
      sheets,
      content,
      trigger: trigger ?? existing?.trigger,
    };
  };
  /** Opens `item` showing `content`: a visit to its address, or the current
   * visit when that already is its address. */
  const open = (item: Item, content: ReadingContent) => {
    const items = new Map(state.items).set(item.id, item);
    const entry = current();
    const address = entry && addressOf(content, item.slot, entry.target);
    if (!navigator || !entry || !address) {
      publish({ items, events: state.events });
      return;
    }
    let visit = entry.id;
    if (targetKey(address) !== targetKey(entry.target)) {
      pushing = true;
      try {
        void navigator.open(address, {
          focus: "preserve",
          sidebar: "preserve",
        });
      } finally {
        pushing = false;
      }
      visit = navigator.snapshot().entry.id;
    }
    const events = new Map(state.events).set(visit, {
      kind: "open",
      item: item.id,
      content,
    });
    publish(pruned({ items, events }, navigator.snapshot().retainedVisits));
  };
  /** The current visit's address names these, which it shows. */
  const named = (target: OpenTarget | undefined): Shown[] => {
    if (target?.kind !== "conversation") return [];
    const { inline, hasThreadTab } = host();
    const result: Shown[] = [];
    const channel = channelComposer(target.channelId);
    const root = target.threadRootId;
    let thread: Item | undefined;
    if (
      root &&
      target.messageId === root &&
      !hasThreadTab(target.channelId, root)
    ) {
      const content: ThreadContent = {
        kind: "thread",
        channelId: target.channelId,
        rootId: root,
        messageId: root,
      };
      const existing = itemFor(content, channel, true);
      if (state.items.has(existing.id) || inline()) {
        thread = existing;
        result.push({ item: existing, content });
      }
    }
    const detail = target.detail;
    if (detail) {
      const slot = thread ? (provides(thread) as Slot) : channel;
      const panel = [...state.items.values()].find(
        (item) =>
          item.sheets &&
          item.slot === slot &&
          item.content.kind === "panel" &&
          item.content.target === detail.target,
      );
      if (panel) result.push({ item: panel, content: panel.content });
    }
    const reader = target.reader;
    if (reader) {
      const content: DetailsContent = {
        kind: "details",
        channelId: target.channelId,
        messageId: reader.messageId,
      };
      const slot = reader.rootId
        ? threadComposer(target.channelId, reader.rootId)
        : channel;
      const sheets = !reader.rootId || !!thread;
      result.push({ item: itemFor(content, slot, sheets), content });
    }
    return result;
  };
  const arrive = () => {
    if (!navigator || pushing || departing()) return;
    const kept = leaving?.remaining;
    leaving = undefined;
    const snapshot = navigator.snapshot();
    const visit = snapshot.entry.id;
    if (state.events.has(visit)) {
      publish(pruned(state, snapshot.retainedVisits));
      return;
    }
    const arrived = kept
      ? [...kept.values()].filter((item) => state.items.has(item.item.id))
      : named(snapshot.entry.target);
    const items = new Map(state.items);
    for (const { item } of arrived) items.set(item.id, item);
    const events = new Map(state.events).set(visit, {
      kind: "arrive",
      shown: arrived.map(({ item, content }) => ({ item: item.id, content })),
    });
    publish(pruned({ items, events }, snapshot.retainedVisits));
  };
  /** Deletes `ids`, retiring their visits, and returns to what remains. */
  const dismiss = (ids: ReadonlySet<string>, below?: Item) => {
    if (!ids.size) return;
    const visits = visitsOf(state, ids);
    const next = without(state, ids);
    const entry = current();
    const remaining = new Map(
      [...shown].filter(([, item]) => !ids.has(item.item.id)),
    );
    const closing = [...shown.values()]
      .filter((item) => ids.has(item.item.id))
      .map((item) => item.content);
    const top = below && remaining.get(below.slot);
    const fallback =
      entry &&
      ((top && addressOf(top.content, top.item.slot, entry.target)) ??
        withoutNamed(entry.target, closing));
    const nav = navigator;
    const returning = !!nav && !!entry && !!fallback && visits.length > 0;
    if (returning && visits.includes(entry.id))
      leaving = { visit: entry.id, fallback, remaining };
    publish(next);
    if (!returning) return;
    nav.dismiss(visits, fallback);
    publish(state);
  };
  const below = (item: Item) =>
    [...state.items.values()].find((other) => provides(other) === item.slot);
  const reading: Reading = {
    shown: () => shown,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    openThread: (content, origin, trigger) => {
      const { hasThreadTab, openThreadTab } = host();
      // A thread opens only over its conversation's composer.
      const slot = channelComposer(content.channelId);
      if (
        hasThreadTab(content.channelId, content.rootId) ||
        !origin.sheets ||
        origin.composer !== slot ||
        !origin.onScreen
      ) {
        openThreadTab(content);
        return;
      }
      open(itemFor(content, slot, true, trigger), content);
    },
    openPanel: (content, origin, trigger) => {
      const { hasPanelTab, openPanelTab } = host();
      if (
        hasPanelTab(content) ||
        !origin.sheets ||
        !origin.composer ||
        !origin.onScreen
      ) {
        openPanelTab(content);
        return;
      }
      open(itemFor(content, origin.composer, true, trigger), content);
    },
    openDetails: (content, origin, trigger) => {
      // Details read over a reply box of this channel; another channel's tab
      // reads them in a dialog.
      const target = current()?.target;
      const inline =
        !!origin.composer &&
        origin.onScreen &&
        target?.kind === "conversation" &&
        composerChannel(origin.composer) === target.channelId;
      const slot = inline ? (origin.composer as Slot) : "dialog";
      open(itemFor(content, slot, inline && origin.sheets, trigger), content);
    },
    navigate: (id, content) => {
      const item = state.items.get(id);
      if (item) open({ ...item, content }, content);
    },
    close: (id) => {
      const item = state.items.get(id);
      if (item) dismiss(stacked(state, [id]), below(item));
    },
    moveToTab: (id, handoff) => {
      const item = state.items.get(id);
      if (!item || item.content.kind === "details") return;
      const showing =
        [...shown.values()].find((shown) => shown.item.id === id)?.content ??
        item.content;
      // What stacks on it closes: its tab holds a composer of its own.
      const above = stacked(state, [id]);
      above.delete(id);
      dismiss(above);
      const visits = visitsOf(state, new Set([id]));
      const items = new Map(state.items);
      items.delete(id);
      publish({
        items,
        events: new Map(
          [...state.events].filter(([visit]) => !visits.includes(visit)),
        ),
      });
      const tabs = host();
      if (showing.kind === "thread") {
        tabs.adoptVisits(showing, visits);
        tabs.openThreadTab(showing, handoff);
      } else if (showing.kind === "panel") {
        tabs.adoptVisits(showing, visits);
        tabs.openPanelTab(showing);
      }
    },
    sent: (composer) => {
      const details = [...shown.values()].find(
        (item) =>
          item.item.slot === composer && item.item.content.kind === "details",
      );
      if (details) reading.close(details.item.id);
    },
    retire: (composer) => {
      const ids = stacked(
        state,
        [...state.items.values()]
          .filter((item) => item.slot === composer)
          .map((item) => item.id),
      );
      const visits = visitsOf(state, ids);
      publish(without(state, ids));
      return visits;
    },
    handOver: (channelId, rootId) => {
      const item = [...state.items.values()].find(
        (item) =>
          item.sheets &&
          item.content.kind === "thread" &&
          item.content.channelId === channelId &&
          item.content.rootId === rootId,
      );
      if (item?.content.kind !== "thread") return;
      const above = stacked(state, [item.id]);
      above.delete(item.id);
      dismiss(above);
      const visits = visitsOf(state, new Set([item.id]));
      host().adoptVisits(item.content, visits);
      const items = new Map(state.items);
      items.delete(item.id);
      publish({ items, events: state.events });
    },
    page: (target) => {
      const entry = current();
      const gone = departing();
      if (gone && entry && targetKey(entry.target) === targetKey(target))
        return pageTarget(gone.fallback, shown);
      const masked = pageTarget(target, shown);
      // An address it did not open, as after a reload or from a link, reads
      // as its message's too: the page reveals that beneath, so focus returns
      // to it and a missing message fails as a missing message link does. A
      // reader's message shows in its thread's tab unless an inline thread
      // shows it; an inline thread reveals its root.
      if (
        target.kind !== "conversation" ||
        masked.kind !== "conversation" ||
        state.events.get(entry?.id ?? "")?.kind !== "arrive"
      )
        return masked;
      const inlineThread =
        target.threadRootId !== undefined && masked.threadRootId === undefined;
      const { reader } = target;
      if (reader && !(inlineThread && target.threadRootId === reader.rootId))
        return {
          ...omit(masked, "messageId", "threadRootId"),
          messageId: reader.messageId,
          ...(reader.rootId ? { threadRootId: reader.rootId } : {}),
        };
      return inlineThread && target.threadRootId
        ? { ...masked, messageId: target.threadRootId }
        : masked;
    },
    presents: () => {
      const entry = current();
      return (
        !!entry &&
        targetKey(reading.page(entry.target)) !== targetKey(entry.target)
      );
    },
    attach: (next) => {
      navigator = next;
      arrive();
      const stop = next.subscribe(arrive);
      return () => {
        stop();
        if (navigator === next) navigator = undefined;
      };
    },
    state: () => state,
  };
  return reading;
}
