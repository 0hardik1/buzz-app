import { describe, expect, it, vi } from "vitest";
import { createNavigationController } from "../navigation/controller";
import {
  type NavigationHistory,
  createMemoryHistory,
} from "../navigation/history";
import type { OpenTarget } from "../navigation/targets";
import { channelComposer, threadComposer } from "./composer-overlay";
import {
  type DetailsContent,
  type PanelContent,
  type ReadingHost,
  type ReadingOrigin,
  type ThreadContent,
  createReading,
  fold,
  pageTarget,
} from "./reading";

const conversation: OpenTarget = {
  version: 1,
  kind: "conversation",
  scope: { viewer: "a".repeat(64), communityOrigin: "https://example.org" },
  channelId: "C",
};
const root = (n: number) => n.toString(16).padStart(64, "0");
const T = root(1);
const T2 = root(2);
const D = root(3);
const D2 = root(4);

const thread = (rootId = T): ThreadContent => ({
  kind: "thread",
  channelId: "C",
  rootId,
  messageId: rootId,
});
const panel = (target: string, rootId?: string): PanelContent => ({
  kind: "panel",
  channelId: "C",
  rootId,
  title: "GitHub",
  target,
  opening: { target },
});
const details = (messageId = D): DetailsContent => ({
  kind: "details",
  channelId: "C",
  messageId,
});
const conversationOrigin: ReadingOrigin = {
  composer: channelComposer("C"),
  sheets: true,
  onScreen: true,
};
const inThread = (rootId = T): ReadingOrigin => ({
  composer: threadComposer("C", rootId),
  sheets: true,
  onScreen: true,
});
const sideThread = (rootId = T2): ReadingOrigin => ({
  composer: threadComposer("C", rootId),
  sheets: false,
  onScreen: true,
});

function setup(
  overrides: Partial<ReadingHost> = {},
  history: NavigationHistory = createMemoryHistory(conversation),
) {
  const { navigation } = createNavigationController(history);
  const host: ReadingHost = {
    inline: () => true,
    hasThreadTab: () => false,
    openThreadTab: vi.fn(),
    hasPanelTab: () => false,
    openPanelTab: vi.fn(),
    adoptVisits: vi.fn(),
    ...overrides,
  };
  const reading = createReading(() => host);
  reading.attach(navigation);
  /** What shows, bottom up: its kind and what it reads. */
  const shown = () =>
    [...reading.shown().values()].map(({ content }) =>
      content.kind === "thread"
        ? `thread ${content.rootId.slice(-1)}`
        : content.kind === "panel"
          ? `panel ${content.target}`
          : `details ${content.messageId.slice(-1)}`,
    );
  const itemOf = (kind: string) =>
    [...reading.shown().values()].find((item) => item.content.kind === kind)
      ?.item.id as string;
  return { navigation, host, reading, shown, itemOf };
}

describe("reading", () => {
  it("thread: Back, Forward, ✕, Forward", () => {
    const { navigation, reading, shown, itemOf } = setup();
    reading.openThread(thread(), conversationOrigin);
    expect(shown()).toEqual(["thread 1"]);
    navigation.back();
    expect(shown()).toEqual([]);
    navigation.forward();
    expect(shown()).toEqual(["thread 1"]);
    reading.close(itemOf("thread"));
    expect(shown()).toEqual([]);
    expect(navigation.snapshot().canGoForward).toBe(false);
    expect(navigation.snapshot().entry.target).toEqual(conversation);
  });

  it("opening from a layer replaces what was above it; Back brings it back", () => {
    const { navigation, reading, shown } = setup();
    reading.openThread(thread(), conversationOrigin);
    reading.openPanel(panel("A", T), inThread());
    expect(shown()).toEqual(["thread 1", "panel A"]);
    reading.openDetails(details(), inThread());
    expect(shown()).toEqual(["thread 1", "details 3"]);
    navigation.back();
    expect(shown()).toEqual(["thread 1", "panel A"]);
    // Another thread from the conversation replaces the whole stack.
    navigation.forward();
    reading.openThread(thread(T2), conversationOrigin);
    expect(shown()).toEqual(["thread 2"]);
    navigation.back();
    expect(shown()).toEqual(["thread 1", "details 3"]);
  });

  it("closing a layer closes everything above it, at every visit", () => {
    const { navigation, reading, shown, itemOf } = setup();
    reading.openThread(thread(), conversationOrigin);
    reading.openPanel(panel("A", T), inThread());
    reading.openDetails(details(), inThread());
    navigation.back();
    navigation.back();
    expect(shown()).toEqual(["thread 1"]);
    reading.close(itemOf("thread"));
    expect(shown()).toEqual([]);
    expect(navigation.snapshot().canGoForward).toBe(false);
    expect(navigation.snapshot().canGoBack).toBe(false);
  });

  // Bug 1 of #1666's review.
  it("Back from details over a thread, then ✕ the thread: Forward has no empty step", () => {
    const { navigation, reading, shown, itemOf } = setup();
    reading.openThread(thread(), conversationOrigin);
    reading.openDetails(details(), inThread());
    navigation.back();
    expect(shown()).toEqual(["thread 1"]);
    reading.close(itemOf("thread"));
    expect(navigation.snapshot().canGoForward).toBe(false);
    navigation.forward();
    expect(shown()).toEqual([]);
    expect(navigation.snapshot().entry.target).toEqual(conversation);
  });

  // Bug 2.
  it("Open as tab opens the page a panel moved to", () => {
    const { navigation, host, reading, shown, itemOf } = setup();
    reading.openPanel(panel("A"), conversationOrigin);
    reading.navigate(itemOf("panel"), panel("B"));
    expect(shown()).toEqual(["panel B"]);
    navigation.back();
    expect(shown()).toEqual(["panel A"]);
    navigation.forward();
    const visits = navigation.snapshot().retainedVisits?.slice(1);
    reading.moveToTab(itemOf("panel"));
    expect(host.openPanelTab).toHaveBeenCalledWith(panel("B"));
    // Its tab takes both visits, which its Close retires.
    expect(host.adoptVisits).toHaveBeenCalledWith(panel("B"), visits);
    expect(shown()).toEqual([]);
  });

  it("Open as tab hands a thread's visits to its tab and closes what is above it", () => {
    const { navigation, host, reading, shown, itemOf } = setup();
    reading.openThread(thread(), conversationOrigin);
    const threadVisit = navigation.snapshot().entry.id;
    reading.openDetails(details(), inThread());
    navigation.back();
    reading.moveToTab(itemOf("thread"), { anchor: D2 });
    expect(host.openThreadTab).toHaveBeenCalledWith(thread(), { anchor: D2 });
    expect(host.adoptVisits).toHaveBeenCalledWith(thread(), [threadVisit]);
    expect(shown()).toEqual([]);
    // The details closed: Forward reaches nothing they showed.
    expect(navigation.snapshot().canGoForward).toBe(false);
  });

  // Bug 4.
  it("Back and Forward never open a tab", () => {
    const { navigation, host, reading } = setup();
    reading.openThread(thread(), conversationOrigin);
    reading.openPanel(panel("A", T), inThread());
    reading.openDetails(details(), sideThread());
    for (let step = 0; step < 3; step++) navigation.back();
    for (let step = 0; step < 3; step++) navigation.forward();
    expect(host.openThreadTab).not.toHaveBeenCalled();
    expect(host.openPanelTab).not.toHaveBeenCalled();
    expect(host.adoptVisits).not.toHaveBeenCalled();
  });

  it("a send closes the details over its composer as ✕ does", () => {
    const { navigation, reading, shown } = setup();
    reading.openDetails(details(), conversationOrigin);
    expect(shown()).toEqual(["details 3"]);
    reading.sent(channelComposer("C"));
    expect(shown()).toEqual([]);
    expect(navigation.snapshot().canGoForward).toBe(false);
    expect(navigation.snapshot().canGoBack).toBe(false);
  });

  it("details over a side thread stay while a sheet opens over the conversation", () => {
    const { navigation, reading, shown, itemOf } = setup();
    reading.openDetails(details(), sideThread());
    reading.openThread(thread(), conversationOrigin);
    expect(shown()).toEqual(["details 3", "thread 1"]);
    // Closing the side details returns to what remains.
    reading.close(itemOf("details"));
    expect(shown()).toEqual(["thread 1"]);
    navigation.back();
    expect(shown()).toEqual([]);
  });

  it("closing a side thread's tab retires the details over it", () => {
    const { navigation, reading, shown } = setup();
    reading.openDetails(details(), sideThread());
    const visits = reading.retire(threadComposer("C", T2));
    expect(visits).toEqual([navigation.snapshot().entry.id]);
    expect(shown()).toEqual([]);
  });

  it("a visit it did not make shows only what its address names", () => {
    const { navigation, reading, shown } = setup();
    reading.openThread(thread(), conversationOrigin);
    reading.openDetails(details(), sideThread());
    void navigation.open({ ...conversation, messageId: T2 });
    expect(shown()).toEqual([]);
    navigation.back();
    expect(shown()).toEqual(["thread 1", "details 3"]);
    // A link to a whole thread reads it inline.
    void navigation.open({ ...conversation, messageId: T2, threadRootId: T2 });
    expect(shown()).toEqual(["thread 2"]);
    // A link to details in a thread reads them over it.
    void navigation.open({
      ...conversation,
      messageId: T,
      threadRootId: T,
      reader: { messageId: D2, rootId: T },
    });
    expect(shown()).toEqual(["thread 1", "details 4"]);
  });

  it("a link to a thread reads it inline, revealing its root beneath", () => {
    const { navigation, reading, shown } = setup();
    void navigation.open({ ...conversation, messageId: T, threadRootId: T });
    expect(shown()).toEqual(["thread 1"]);
    expect(reading.page(navigation.snapshot().entry.target)).toEqual({
      ...conversation,
      messageId: T,
    });
    // A thread it opened reveals nothing.
    reading.openThread(thread(T2), conversationOrigin);
    expect(reading.page(navigation.snapshot().entry.target)).toEqual(
      conversation,
    );
  });

  it("a thread with a tab shows there, and does not open inline", () => {
    const { host, reading, shown } = setup({ hasThreadTab: () => true });
    reading.openThread(thread(), conversationOrigin);
    expect(host.openThreadTab).toHaveBeenCalledWith(thread());
    expect(shown()).toEqual([]);
  });

  it("without a composer on screen, threads and panels open tabs and details a dialog", () => {
    const { host, reading } = setup();
    const away = { ...conversationOrigin, onScreen: false };
    reading.openThread(thread(), away);
    reading.openPanel(panel("A"), away);
    reading.openDetails(details(), away);
    expect(host.openThreadTab).toHaveBeenCalled();
    expect(host.openPanelTab).toHaveBeenCalled();
    expect([...reading.shown().keys()]).toEqual(["dialog"]);
  });

  it("the page sees the address without what the sheets show", () => {
    const { navigation, reading } = setup();
    reading.openThread(thread(), conversationOrigin);
    reading.openPanel(panel("A", T), inThread());
    expect(navigation.snapshot().entry.target).toMatchObject({
      threadRootId: T,
      detail: { target: "A", rootId: T },
    });
    expect(reading.page(navigation.snapshot().entry.target)).toEqual(
      conversation,
    );
    expect(reading.presents()).toBe(true);
  });

  it("until a close's return arrives, its visit reads as where it returns", () => {
    // A browser returns by traversal, which arrives after the close.
    const memory = createMemoryHistory(conversation);
    const returns: (() => void)[] = [];
    const { navigation, reading, shown, itemOf } = setup(
      {},
      {
        ...memory,
        dismiss: (visits, fallback) =>
          returns.push(() => memory.dismiss(visits, fallback)),
      },
    );
    reading.openThread(thread(), conversationOrigin);
    const closed = navigation.snapshot().entry;
    reading.close(itemOf("thread"));
    expect(navigation.snapshot().entry.id).toBe(closed.id);
    // Nothing shows, and the page is not sent to the closed thread.
    expect(shown()).toEqual([]);
    expect(reading.page(closed.target)).toEqual(conversation);
    for (const done of returns) done();
    expect(navigation.snapshot().entry.target).toEqual(conversation);
    expect(shown()).toEqual([]);
    expect(navigation.snapshot().canGoForward).toBe(false);
  });

  it("folds nothing for visits it never saw", () => {
    const { reading, navigation } = setup();
    reading.openThread(thread(), conversationOrigin);
    expect(fold(reading.state(), ["unknown"]).size).toBe(0);
    expect(
      pageTarget(navigation.snapshot().entry.target, new Map()),
    ).toMatchObject({ threadRootId: T });
  });
});
