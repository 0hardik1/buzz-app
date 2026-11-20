import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { DetailsSheet } from "./DetailsSheet";
import {
  InlineThreadIntro,
  type InlineThreadIntroStep,
  inlineThreadIntroSeen,
  markInlineThreadIntroSeen,
} from "./InlineThreadIntro";
import {
  type ComposerHandle,
  ComposerScope,
  type ComposerName,
  composerChannel,
  composerHost,
  createComposerHandle,
  overlayHost,
  threadComposer,
  useComposerForm,
} from "./composer-overlay";
import styles from "./Messages.module.css";

/** What a row opens: a thread, a panel such as a pull request, a details
 * message or a diff. It says what to read, never how to draw it: the
 * conversation that owns the composer draws it, so its links, edits and
 * message actions work. Media is a viewer of its own, not one of these. */
export type InlineTarget =
  | Readonly<{
      kind: "thread";
      channelId: string;
      rootId: string;
      /** The message to reveal, the root or a reply in it. */
      messageId: string;
      /** Opened to reply: its reply box takes focus. */
      reply?: boolean | undefined;
    }>
  | Readonly<{
      kind: "panel";
      channelId: string;
      rootId?: string | undefined;
      title: string;
      /** The workspace's own description of the panel, which it draws. */
      opening: unknown;
    }>
  | Readonly<{ kind: "details" | "diff"; messageId: string }>;

/** One request to open `target`, from the row whose composer it reads over. */
export type InlineRequest = Readonly<{
  target: InlineTarget;
  /** The composer of the scope it was opened from. */
  composer: ComposerHandle | undefined;
  /** Where focus returns when it closes. */
  trigger: HTMLElement | null;
  /** It already has a tab, which shows instead. */
  hasTab?: boolean | undefined;
  /** Shows it in a tab: without an inline place, and from its Open as tab. */
  openAsTab?: (() => void) | undefined;
}>;

/** Something open: inline over its composer, or in a dialog when there is
 * nowhere inline to read it and no tab to show it in. */
export type InlineEntry = InlineRequest & {
  placement: "inline" | "dialog";
};
/** One open entry. `key` is this opening; `open` false while it leaves. */
export type Placed = InlineEntry & {
  key: number;
  open: boolean;
  focus: { current: HTMLElement | null };
};

/** What it reads: opening the same thing again replaces it. */
export function entryId(target: InlineTarget) {
  switch (target.kind) {
    case "thread":
      return threadComposer(target.channelId, target.rootId);
    case "panel":
      return `panel:${target.channelId}:${target.rootId ?? ""}`;
    default:
      return `${target.kind}:${target.messageId}`;
  }
}
/** The composer its content holds, as a thread's reply box. What opens over
 * that composer opens on this entry, and closes with it. */
const provides = ({ target }: InlineEntry) =>
  target.kind === "thread"
    ? threadComposer(target.channelId, target.rootId)
    : undefined;
/** How each kind behaves over its composer. */
export const BEHAVIOR = {
  // Holds its own composer and places focus itself.
  thread: { closeLabel: "Close thread", containsComposer: true },
  // Owns its scrollport and shows no composer.
  panel: { closeLabel: "Close", readerOnly: true },
  // A send from its composer closes it.
  details: { closeLabel: "Close details", closesOnSend: true },
  diff: { closeLabel: "Close diff", readerOnly: true },
} as const satisfies Record<
  InlineTarget["kind"],
  {
    closeLabel: string;
    containsComposer?: boolean;
    readerOnly?: boolean;
    closesOnSend?: boolean;
  }
>;
const behavior = (
  entry: InlineEntry,
): (typeof BEHAVIOR)[keyof typeof BEHAVIOR] &
  Partial<{
    containsComposer: boolean;
    readerOnly: boolean;
    closesOnSend: boolean;
  }> => BEHAVIOR[entry.target.kind];

/** Everything open on the entries in `ids`, including them. */
function withStack(list: readonly Placed[], ids: ReadonlySet<string>) {
  const closing = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of list) {
      const id = entryId(item.target);
      if (closing.has(id) || !item.open) continue;
      const below = list.find(
        (other) =>
          other.open &&
          closing.has(entryId(other.target)) &&
          provides(other) === item.composer?.name,
      );
      if (below) {
        closing.add(id);
        grew = true;
      }
    }
  }
  return closing;
}
const closeAll = (list: readonly Placed[], ids: ReadonlySet<string>) => {
  if (!ids.size) return list as Placed[];
  const closing = withStack(list, ids);
  return list.map((item) =>
    closing.has(entryId(item.target)) && item.open
      ? { ...item, open: false }
      : item,
  );
};
const openIds = (list: readonly Placed[], test: (item: Placed) => boolean) =>
  new Set(
    list
      .filter((item) => item.open && test(item))
      .map((item) => entryId(item.target)),
  );

/** Where a request opens: over its composer when Inline is on, the composer is
 * on screen and it has no tab; otherwise in its tab; otherwise a dialog. */
export function placement(
  request: InlineRequest,
  inline: (composer: ComposerHandle | undefined) => boolean,
): "inline" | "dialog" | "tab" {
  if (!request.hasTab && inline(request.composer)) return "inline";
  return request.openAsTab ? "tab" : "dialog";
}

/** Opening replaces whatever is over the same composer, and anything open on
 * it. Entries over other composers stay. */
export function opened(
  list: readonly Placed[],
  entry: InlineEntry,
  key: number,
): Placed[] {
  const id = entryId(entry.target);
  const replaced = openIds(
    list,
    (item) =>
      entryId(item.target) === id ||
      (item.placement === entry.placement && item.composer === entry.composer),
  );
  return [
    ...closeAll(list, replaced),
    { ...entry, key, open: true, focus: { current: entry.trigger } },
  ];
}
/** Closing an entry closes everything open on it. */
export const closed = (list: readonly Placed[], id: string) =>
  closeAll(list, new Set([id]));
/** A send from `composer` closes the details over it. */
export const sent = (list: readonly Placed[], composer: ComposerHandle) =>
  closeAll(
    list,
    openIds(
      list,
      (item) => item.composer === composer && !!behavior(item).closesOnSend,
    ),
  );
/** A composer that is gone for good, as a closed tab's, closes what is over
 * it. */
export const composerGone = (
  list: readonly Placed[],
  composer: ComposerHandle,
) =>
  closeAll(
    list,
    openIds(
      list,
      (item) => item.placement === "inline" && item.composer === composer,
    ),
  );
/** Moving an entry to its tab takes it out of the list, and closes what is
 * open on it: its tab holds a composer of its own. */
export function movedToTab(list: readonly Placed[], id: string) {
  const moving = list.find((item) => item.open && entryId(item.target) === id);
  if (!moving) return list as Placed[];
  return closed(list, id).filter((item) => item.key !== moving.key);
}
/** Leaving a channel closes what is over its composers. */
export const left = (list: readonly Placed[], channelId: string | undefined) =>
  list.some((item) => channelOf(item) !== channelId)
    ? list.filter((item) => channelOf(item) === channelId)
    : (list as Placed[]);
const channelOf = (item: Placed) => composerChannel(item.composer?.name ?? "");
/** Navigating inside an open entry replaces what it reads, in place. */
export const updated = (
  list: readonly Placed[],
  id: string,
  target: InlineTarget,
) =>
  list.map((item) =>
    item.open && entryId(item.target) === id ? { ...item, target } : item,
  );
/** An entry that finished leaving. */
export const removed = (list: readonly Placed[], key: number) =>
  list.filter((item) => item.key !== key);

type Store = Readonly<{
  get(): Placed[];
  set(change: (list: Placed[]) => Placed[]): void;
  subscribe(listener: () => void): () => void;
}>;
function createStore(): Store {
  let list: Placed[] = [];
  const listeners = new Set<() => void>();
  return {
    get: () => list,
    set: (change) => {
      const next = change(list);
      if (next === list) return;
      list = next;
      for (const listener of listeners) listener();
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

/** Draws a panel entry; `navigate` replaces what it reads in place. */
export type PanelRenderer = (
  target: Extract<InlineTarget, { kind: "panel" }>,
  controls: Readonly<{ close(): void; navigate(next: InlineTarget): void }>,
) => ReactNode;

export type InlineOpener = Readonly<{
  /** The one place every row opens what it reads. */
  open(request: InlineRequest): void;
  /** Closes what reads `id`; see entryId. */
  close(id: string): void;
  sent(composer: ComposerHandle): void;
  composerGone(composer: ComposerHandle): void;
  store: Store;
  /** The workspace draws its panels. */
  renderPanel: PanelRenderer;
}>;
/** Stable: rows that open entries never re-render as the list changes. */
export const InlineContainers = createContext<InlineOpener | undefined>(
  undefined,
);

function createOpener(
  store: Store,
  renderPanel: { current: PanelRenderer | undefined },
  inline = true,
): InlineOpener {
  let sequence = 0;
  return {
    open: (request) => {
      const where = placement(
        request,
        (composer) => inline && !!overlayHost(composer),
      );
      if (where === "tab") {
        request.openAsTab?.();
        return;
      }
      store.set((items) =>
        opened(items, { ...request, placement: where }, ++sequence),
      );
    },
    close: (id) => store.set((items) => closed(items, id)),
    sent: (composer) => store.set((items) => sent(items, composer)),
    composerGone: (composer) =>
      store.set((items) => composerGone(items, composer)),
    store,
    renderPanel: (target, controls) => renderPanel.current?.(target, controls),
  };
}

/** The opener rows use: their workspace's, or one of their own that opens
 * readers in dialogs where there is no workspace, as in search previews. */
export function useInlineContainers() {
  const workspace = useContext(InlineContainers);
  const [own] = useState(() =>
    workspace
      ? undefined
      : createOpener(createStore(), { current: undefined }, false),
  );
  return {
    opener: (workspace ?? own) as InlineOpener,
    dialogs: own && <ReaderDialogs store={own.store} />,
  };
}

/** One conversation workspace's entries. Composers draw what is over them;
 * `dialogs` draws what opened without a composer. Leaving `channelId` closes
 * them. */
export function useInlineContainerList(
  channelId: string | undefined,
  renderPanel?: PanelRenderer,
) {
  const [store] = useState(createStore);
  const panels = useRef(renderPanel);
  useLayoutEffect(() => {
    panels.current = renderPanel;
  });
  const opener = useMemo(() => createOpener(store, panels), [store]);
  useEffect(() => {
    store.set((items) => left(items, channelId));
  }, [store, channelId]);
  // Closes them all, as when their conversation is hidden.
  const closeEverything = useCallback(
    () => store.set((items) => left(items, undefined)),
    [store],
  );
  return {
    opener,
    closeAll: closeEverything,
    dialogs: <ReaderDialogs store={store} />,
  };
}

// Readers draw their own message into the place their entry opened, through a
// portal, so the row's conversation renders them live.
type Slot = Readonly<{
  title: HTMLElement | null;
  leading: HTMLElement | null;
  description: HTMLElement | null;
  body: HTMLElement | null;
}>;
const slots = new Map<string, Slot>();
const slotListeners = new Set<() => void>();
const slotKey = (composer: ComposerHandle | undefined, id: string) =>
  `${composer?.id ?? ""}\n${id}`;
function setSlot(key: string, slot: Slot | undefined) {
  if (slot) slots.set(key, slot);
  else slots.delete(key);
  for (const listener of slotListeners) listener();
}
function subscribeSlots(listener: () => void) {
  slotListeners.add(listener);
  return () => {
    slotListeners.delete(listener);
  };
}
/** Where a reader opened from `composer` draws itself, while it is open. */
export function useReaderSlot(
  composer: ComposerHandle | undefined,
  target: InlineTarget,
) {
  const key = slotKey(composer, entryId(target));
  return useSyncExternalStore(
    subscribeSlots,
    () => slots.get(key),
    () => slots.get(key),
  );
}

/** Keeps a row mounted while something reads from it; see MessageRow. */
export const RowKeepAlive = createContext<(() => () => void) | undefined>(
  undefined,
);

/** Empty places a reader fills from its row. */
function useSlotElements(entry: Placed) {
  const [title, setTitle] = useState<HTMLElement | null>(null);
  const [leading, setLeading] = useState<HTMLElement | null>(null);
  const [description, setDescription] = useState<HTMLElement | null>(null);
  const [body, setBody] = useState<HTMLElement | null>(null);
  const key = slotKey(entry.composer, entryId(entry.target));
  useLayoutEffect(() => {
    if (!body) return;
    setSlot(key, { title, leading, description, body });
    return () => setSlot(key, undefined);
  }, [key, title, leading, description, body]);
  return {
    title: <span ref={setTitle} className={styles.readerSlot} />,
    leading: <span ref={setLeading} className={styles.readerSlot} />,
    description: <span ref={setDescription} className={styles.readerSlot} />,
    body: <div ref={setBody} className={styles.readerSlot} />,
  };
}

/** Readers opened where nothing inline can hold them. */
function ReaderDialogs({ store }: { store: Store }) {
  const list = useSyncExternalStore(store.subscribe, store.get, store.get);
  return list
    .filter((item) => item.placement === "dialog")
    .map((item) => <ReaderDialog key={item.key} store={store} entry={item} />);
}
function ReaderDialog({ store, entry }: { store: Store; entry: Placed }) {
  const slot = useSlotElements(entry);
  const id = entryId(entry.target);
  return (
    <Dialog
      open={entry.open}
      onOpenChange={(open) => {
        if (!open) store.set((items) => closed(items, id));
      }}
      onOpenChangeComplete={(open: boolean) => {
        if (!open) store.set((items) => removed(items, entry.key));
      }}
      title={slot.title}
      description={entry.target.kind === "details" && slot.description}
      size={entry.target.kind === "diff" ? "expanded" : "default"}
      closeLabel={behavior(entry).closeLabel}
      finalFocus={entry.focus}
    >
      {slot.body}
    </Dialog>
  );
}

type ThreadRenderer = (
  target: Extract<InlineTarget, { kind: "thread" }>,
) => ReactNode;

/** A scope's composer handle, one per name for the scope's lifetime. */
export function useComposerHandle(name: ComposerName | undefined) {
  return useMemo(() => (name ? createComposerHandle(name) : undefined), [name]);
}

/** Provides `handle`'s composer to the content below, and draws what opens
 * over it beside it, inside the conversation that owns it. Leaving closes
 * what is over it, as when its tab closes. Threads open only over a
 * channel's composer, whose owner supplies `renderThread`. */
export function ComposerScopeProvider({
  handle,
  renderThread,
  children,
}: {
  handle: ComposerHandle | undefined;
  renderThread?: ThreadRenderer | undefined;
  children: ReactNode;
}) {
  const opener = useContext(InlineContainers);
  useEffect(
    () => () => {
      if (handle) opener?.composerGone(handle);
    },
    [opener, handle],
  );
  return (
    <ComposerScope value={handle}>
      {children}
      {opener && handle && (
        <Outlet opener={opener} handle={handle} renderThread={renderThread} />
      )}
    </ComposerScope>
  );
}

function Outlet({
  opener,
  handle,
  renderThread,
}: {
  opener: InlineOpener;
  handle: ComposerHandle;
  renderThread?: ThreadRenderer | undefined;
}) {
  const { store } = opener;
  const list = useSyncExternalStore(store.subscribe, store.get, store.get);
  const form = useComposerForm(handle);
  const host = form ? composerHost(handle) : null;
  const mine = list.filter(
    (item) => item.placement === "inline" && item.composer === handle,
  );
  // The first inline thread on a device explains itself until it is done.
  const [intro, setIntro] = useState<number>();
  const [introStep, setIntroStep] = useState<InlineThreadIntroStep>(1);
  const [introAnchor, setIntroAnchor] = useState<HTMLElement | null>(null);
  const introducing = mine.some((item) => item.open && item.key === intro);
  const thread = host
    ? mine.find((item) => item.target.kind === "thread" && item.open)?.key
    : undefined;
  useEffect(() => {
    if (thread === undefined || introducing || inlineThreadIntroSeen()) return;
    setIntro(thread);
    setIntroStep(1);
  }, [thread, introducing]);
  const finishIntro = useCallback(() => {
    markInlineThreadIntroSeen();
    setIntro(undefined);
  }, []);
  // It waits, unshown, while its composer is away.
  if (!host) return null;
  return (
    <>
      {introducing && (
        <InlineThreadIntro
          step={introStep}
          anchor={introAnchor}
          onNext={() => setIntroStep(2)}
          onDone={() => setIntro(undefined)}
        />
      )}
      {mine.map((item) => (
        <OutletEntry
          key={item.key}
          opener={opener}
          entry={item}
          host={host}
          renderThread={renderThread}
          spotlight={item.key === intro ? introStep : undefined}
          onSpotlightAnchor={setIntroAnchor}
          finishIntro={finishIntro}
        />
      ))}
    </>
  );
}

function OutletEntry({
  opener,
  entry,
  host,
  renderThread,
  spotlight,
  onSpotlightAnchor,
  finishIntro,
}: {
  opener: InlineOpener;
  entry: Placed;
  host: NonNullable<ReturnType<typeof composerHost>>;
  renderThread?: ThreadRenderer | undefined;
  spotlight: InlineThreadIntroStep | undefined;
  onSpotlightAnchor(element: HTMLElement | null): void;
  finishIntro(): void;
}) {
  const { store } = opener;
  const { target } = entry;
  const id = entryId(target);
  const rules = behavior(entry);
  const slot = useSlotElements(entry);
  const close = () => store.set((items) => closed(items, id));
  const content =
    target.kind === "thread"
      ? renderThread?.(target)
      : target.kind === "panel"
        ? opener.renderPanel(target, {
            close,
            navigate: (next) => store.set((items) => updated(items, id, next)),
          })
        : slot.body;
  return (
    <DetailsSheet
      open={entry.open}
      onOpenChange={(open) => {
        if (!open) close();
      }}
      onClosed={() => store.set((items) => removed(items, entry.key))}
      host={host}
      title={
        target.kind === "thread"
          ? "Thread"
          : target.kind === "panel"
            ? target.title
            : slot.title
      }
      leading={target.kind === "details" ? slot.leading : undefined}
      description={target.kind === "details" ? slot.description : undefined}
      closeLabel={rules.closeLabel}
      containsComposer={!!rules.containsComposer}
      readerOnly={!!rules.readerOnly}
      focusContent={target.kind === "thread" && !!target.reply}
      finalFocus={entry.focus}
      spotlight={spotlight}
      onSpotlightAnchor={onSpotlightAnchor}
      // The first Escape finishes the intro; the next closes.
      onEscapeKey={() => {
        if (spotlight === undefined) return false;
        finishIntro();
        return true;
      }}
      onOpenAsTab={
        entry.openAsTab &&
        (() => {
          if (spotlight !== undefined) finishIntro();
          // Its tab places focus.
          entry.focus.current = null;
          store.set((items) => movedToTab(items, id));
          entry.openAsTab?.();
        })
      }
    >
      {content}
    </DetailsSheet>
  );
}
