import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { DetailsSheet } from "./DetailsSheet";
import {
  InlineThreadIntro,
  type InlineThreadIntroStep,
  inlineThreadIntroSeen,
  markInlineThreadIntroSeen,
} from "./InlineThreadIntro";
import {
  type ComposerName,
  composerHost,
  useComposerHosts,
} from "./composer-overlay";

/** Something read over a composer: a thread, a panel such as a pull request,
 * a details message or a diff. Media is a viewer of its own, not one of these. */
export type InlineContainer = {
  /** What it reads, such as `thread:C:R` or `details:M`. Opening the same
   * thing again replaces it. */
  id: string;
  kind: "thread" | "reader";
  channelId: string;
  /** The composer it opens over. */
  composer: ComposerName;
  /** The composer its content holds, as a thread's reply box. What opens over
   * that composer stacks on this container. */
  provides?: ComposerName | undefined;
  /** Sending from its composer closes it, as a details message does. */
  closesOnSend?: boolean | undefined;
  title: ReactNode;
  leading?: ReactNode;
  description?: ReactNode;
  closeLabel: string;
  /** Holds its own composer and places focus itself, as a thread does. */
  containsComposer?: boolean | undefined;
  focusContent?: boolean | undefined;
  /** Owns its scrollport and shows no composer, as a panel or diff does. */
  readerOnly?: boolean | undefined;
  content: ReactNode;
  /** Shows it in the sidebar instead. */
  openAsTab?: (() => void) | undefined;
  /** Where focus returns when it closes. */
  trigger: HTMLElement | null;
};
/** One open container. `key` is this opening; `open` false while it leaves. */
export type Placed = InlineContainer & {
  key: number;
  open: boolean;
  focus: { current: HTMLElement | null };
};

/** Everything stacked on the containers in `ids`, including them. */
function withStack(list: readonly Placed[], ids: ReadonlySet<string>) {
  const closing = new Set(ids);
  for (let grew = true; grew; ) {
    grew = false;
    for (const item of list) {
      if (closing.has(item.id) || !item.open) continue;
      const below = list.find(
        (other) =>
          other.open &&
          closing.has(other.id) &&
          other.provides === item.composer,
      );
      if (below) {
        closing.add(item.id);
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
    closing.has(item.id) && item.open ? { ...item, open: false } : item,
  );
};

/** Whether `item` sits on another open container. */
export const stacked = (list: readonly Placed[], item: Placed) =>
  list.some(
    (other) => other.open && other !== item && other.provides === item.composer,
  );

/** Opening replaces whatever is over the same composer, and anything stacked
 * on it. Containers over other composers stay. */
export function opened(
  list: readonly Placed[],
  container: InlineContainer,
  key: number,
): Placed[] {
  const replaced = new Set(
    list
      .filter(
        (item) =>
          item.open &&
          (item.composer === container.composer || item.id === container.id),
      )
      .map((item) => item.id),
  );
  return [
    ...closeAll(list, replaced),
    { ...container, key, open: true, focus: { current: container.trigger } },
  ];
}
/** Closing a container closes everything stacked on it. */
export const closed = (list: readonly Placed[], id: string) =>
  closeAll(list, new Set([id]));
/** A send from `composer` closes the details over it. */
export const sent = (list: readonly Placed[], composer: ComposerName) =>
  closeAll(
    list,
    new Set(
      list
        .filter(
          (item) =>
            item.open && item.composer === composer && item.closesOnSend,
        )
        .map((item) => item.id),
    ),
  );
/** Moving a container to the sidebar takes it out of the list. What is
 * stacked on it stays: it names the container's composer, which its tab
 * shows, so it follows it there. */
export const movedToTab = (list: readonly Placed[], id: string) =>
  list.filter((item) => item.id !== id || !item.open);
/** Leaving a channel closes what is over its composers. */
export const left = (list: readonly Placed[], channelId: string | undefined) =>
  list.some((item) => item.channelId !== channelId)
    ? list.filter((item) => item.channelId === channelId)
    : (list as Placed[]);
/** Navigating inside an open container replaces what it shows, in place. */
export const updated = (
  list: readonly Placed[],
  id: string,
  patch: Partial<InlineContainer>,
) =>
  list.map((item) =>
    item.open && item.id === id ? { ...item, ...patch, id } : item,
  );
/** A container that finished leaving. */
export const removed = (list: readonly Placed[], key: number) =>
  list.filter((item) => item.key !== key);

export type InlineContainerActions = Readonly<{
  open(container: InlineContainer): void;
  close(id: string): void;
  update(id: string, patch: Partial<InlineContainer>): void;
  sent(composer: ComposerName): void;
}>;
/** Stable: rows that open containers never re-render as the list changes. */
export const InlineContainers = createContext<
  InlineContainerActions | undefined
>(undefined);
export const useInlineContainers = () => useContext(InlineContainers);

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

/** One conversation workspace's containers, and the layer that draws them over
 * their composers. Only the layer renders as the list changes. Leaving
 * `channelId` closes them. */
export function useInlineContainerList(channelId: string | undefined) {
  const [store] = useState(createStore);
  const actions = useMemo<InlineContainerActions>(() => {
    let sequence = 0;
    return {
      open: (container) =>
        store.set((items) => opened(items, container, ++sequence)),
      close: (id) => store.set((items) => closed(items, id)),
      update: (id, patch) => store.set((items) => updated(items, id, patch)),
      sent: (composer) => store.set((items) => sent(items, composer)),
    };
  }, [store]);
  useEffect(() => {
    store.set((items) => left(items, channelId));
  }, [store, channelId]);
  // Closes them all, as when their conversation is hidden.
  const closeAll = useCallback(
    () => store.set((items) => left(items, undefined)),
    [store],
  );
  return { actions, closeAll, layer: <InlineContainerLayer store={store} /> };
}

function InlineContainerLayer({ store }: { store: Store }) {
  const list = useSyncExternalStore(store.subscribe, store.get, store.get);
  useComposerHosts();
  const close = (id: string) => store.set((items) => closed(items, id));
  // The first inline thread on a device explains itself until it is done.
  const [intro, setIntro] = useState<number>();
  const [introStep, setIntroStep] = useState<InlineThreadIntroStep>(1);
  const [introAnchor, setIntroAnchor] = useState<HTMLElement | null>(null);
  const introducing = list.some((item) => item.open && item.key === intro);
  const thread = list.find((item) => item.kind === "thread" && item.open)?.key;
  useEffect(() => {
    if (thread === undefined || introducing || inlineThreadIntroSeen()) return;
    setIntro(thread);
    setIntroStep(1);
  }, [thread, introducing]);
  const finishIntro = useCallback(() => {
    markInlineThreadIntroSeen();
    setIntro(undefined);
  }, []);
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
      {list.map((item) => {
        // It waits, unshown, while its composer is away, as in a hidden tab.
        const host = composerHost(item.composer);
        if (!host) return null;
        const introduced = item.key === intro;
        return (
          <DetailsSheet
            key={item.key}
            open={item.open}
            onOpenChange={(open) => {
              if (!open) close(item.id);
            }}
            onClosed={() => store.set((items) => removed(items, item.key))}
            host={host}
            stacked={stacked(list, item)}
            title={item.title}
            leading={item.leading}
            description={item.description}
            closeLabel={item.closeLabel}
            containsComposer={!!item.containsComposer}
            readerOnly={!!item.readerOnly}
            focusContent={!!item.focusContent}
            finalFocus={item.focus}
            spotlight={introduced ? introStep : undefined}
            onSpotlightAnchor={setIntroAnchor}
            // The first Escape finishes the intro; the next closes.
            onEscapeKey={() => {
              if (!introduced) return false;
              finishIntro();
              return true;
            }}
            onOpenAsTab={
              item.openAsTab &&
              (() => {
                if (introduced) finishIntro();
                // Its tab places focus.
                item.focus.current = null;
                store.set((items) => movedToTab(items, item.id));
                item.openAsTab?.();
              })
            }
          >
            {item.content}
          </DetailsSheet>
        );
      })}
    </>
  );
}
