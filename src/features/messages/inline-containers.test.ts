import { expect, it } from "vitest";
import {
  type ComposerHandle,
  channelComposer,
  createComposerHandle,
  threadComposer,
} from "./composer-overlay";
import {
  closed,
  composerGone,
  entryId,
  type InlineEntry,
  type InlineRequest,
  left,
  movedToTab,
  opened,
  type Placed,
  placement,
  sent,
} from "./inline-containers";

const channel = createComposerHandle(channelComposer("C"));
const replyBox = (rootId: string) =>
  createComposerHandle(threadComposer("C", rootId));
const thread = (rootId: string): InlineEntry => ({
  target: { kind: "thread", channelId: "C", rootId, messageId: rootId },
  composer: channel,
  trigger: null,
  placement: "inline",
});
const details = (messageId: string, composer: ComposerHandle): InlineEntry => ({
  target: { kind: "details", messageId },
  composer,
  trigger: null,
  placement: "inline",
});

let key = 0;
const open = (list: Placed[], ...items: InlineEntry[]) =>
  items.reduce((next, item) => opened(next, item, ++key), list);
const shown = (list: readonly Placed[]) =>
  list.filter((item) => item.open).map((item) => entryId(item.target));

it("opens inline over a shown composer, else in its tab, else a dialog", () => {
  const request: InlineRequest = {
    target: { kind: "details", messageId: "M" },
    composer: channel,
    trigger: null,
  };
  const shownComposer = () => true;
  const away = () => false;
  expect(placement(request, shownComposer)).toBe("inline");
  expect(placement(request, away)).toBe("dialog");
  const tabbed = { ...request, openAsTab: () => {} };
  expect(placement(tabbed, away)).toBe("tab");
  // Something with a tab shows its tab, even with a composer to open over.
  expect(placement({ ...tabbed, hasTab: true }, shownComposer)).toBe("tab");
});

it("replaces what is over the same composer and keeps the rest", () => {
  const box = replyBox("R");
  const list = open([], thread("R"), details("M", box));
  // Another thread replaces the first over the channel composer, and takes
  // the details open on it along.
  expect(shown(open(list, thread("S")))).toEqual(["thread:C:S"]);
  // New details over the thread replace only the details there.
  expect(shown(open(list, details("N", box)))).toEqual([
    "thread:C:R",
    "details:N",
  ]);
  // Opening the same thing again replaces it, wherever it was.
  expect(shown(open(list, details("M", channel)))).toEqual(["details:M"]);
});

it("closes everything open on an entry with it", () => {
  const list = open([], thread("R"), details("M", replyBox("R")));
  expect(shown(closed(list, "thread:C:R"))).toEqual([]);
  // Closing the top leaves the thread.
  expect(shown(closed(list, "details:M"))).toEqual(["thread:C:R"]);
});

it("closes the details over a composer that sends, only there", () => {
  const box = replyBox("R");
  const other = createComposerHandle(channelComposer("D"));
  const list = open([], thread("R"), details("M", box), details("N", other));
  expect(shown(sent(list, box))).toEqual(["thread:C:R", "details:N"]);
  // A thread is not closed by a send from the composer under it.
  expect(shown(sent(list, channel))).toEqual(shown(list));
});

it("closes what is over a composer that is gone, as a closed tab's", () => {
  const tab = replyBox("R");
  const list = open([], details("M", tab), details("N", channel));
  expect(shown(composerGone(list, tab))).toEqual(["details:N"]);
  // Another scope with the same name keeps its own.
  expect(shown(composerGone(list, replyBox("R")))).toEqual(shown(list));
});

it("moves a thread to its tab and closes what was open on it", () => {
  const list = open([], thread("R"), details("M", replyBox("R")));
  const moved = movedToTab(list, "thread:C:R");
  expect(shown(moved)).toEqual([]);
  // The thread leaves at once; its tab shows it.
  expect(moved.some((item) => entryId(item.target) === "thread:C:R")).toBe(
    false,
  );
});

it("closes a channel's entries when the workspace leaves it", () => {
  const other = createComposerHandle(channelComposer("D"));
  const list = open([], thread("R"), details("N", other));
  expect(shown(left(list, "D"))).toEqual(["details:N"]);
  expect(shown(left(list, undefined))).toEqual([]);
  // Staying in the channel changes nothing.
  const same = open([], thread("R"));
  expect(left(same, "C")).toBe(same);
});
