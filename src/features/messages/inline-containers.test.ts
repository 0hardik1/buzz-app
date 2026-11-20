import { expect, it } from "vitest";
import { channelComposer, threadComposer } from "./composer-overlay";
import {
  closed,
  type InlineContainer,
  left,
  movedToTab,
  opened,
  type Placed,
  sent,
  stacked,
} from "./inline-containers";

const channel = channelComposer("C");
const thread = (rootId: string): InlineContainer => ({
  id: threadComposer("C", rootId),
  kind: "thread",
  channelId: "C",
  composer: channel,
  provides: threadComposer("C", rootId),
  title: "Thread",
  closeLabel: "Close thread",
  content: null,
  trigger: null,
});
const details = (
  messageId: string,
  composer: string,
  channelId = "C",
): InlineContainer => ({
  id: `details:${messageId}`,
  kind: "reader",
  channelId,
  composer,
  closesOnSend: true,
  title: "Details",
  closeLabel: "Close details",
  content: null,
  trigger: null,
});

let key = 0;
const open = (list: Placed[], ...items: InlineContainer[]) =>
  items.reduce((next, item) => opened(next, item, ++key), list);
const shown = (list: readonly Placed[]) =>
  list.filter((item) => item.open).map((item) => item.id);

it("replaces what is over the same composer and keeps the rest", () => {
  const list = open([], thread("R"), details("M", threadComposer("C", "R")));
  // Another thread replaces the first over the channel composer, and takes
  // the details stacked on it along.
  expect(shown(open(list, thread("S")))).toEqual(["thread:C:S"]);
  // New details over the thread replace only the details there.
  expect(shown(open(list, details("N", threadComposer("C", "R"))))).toEqual([
    "thread:C:R",
    "details:N",
  ]);
  // Opening the same thing again replaces it, wherever it was.
  expect(shown(open(list, details("M", channel)))).toEqual(["details:M"]);
});

it("stacks what opens from an inline thread on that thread", () => {
  const list = open([], thread("R"), details("M", threadComposer("C", "R")));
  const [below, above] = list;
  expect(below && stacked(list, below)).toBe(false);
  expect(above && stacked(list, above)).toBe(true);
  // Over the channel composer, details sit on nothing.
  const flat = open([], details("M", channel));
  expect(flat[0] && stacked(flat, flat[0])).toBe(false);
});

it("closes everything stacked on a container with it", () => {
  const list = open([], thread("R"), details("M", threadComposer("C", "R")));
  expect(shown(closed(list, "thread:C:R"))).toEqual([]);
  // Closing the top leaves the thread.
  expect(shown(closed(list, "details:M"))).toEqual(["thread:C:R"]);
});

it("closes the details over a composer that sends, only there", () => {
  const list = open(
    [],
    thread("R"),
    details("M", threadComposer("C", "R")),
    details("N", channelComposer("D"), "D"),
  );
  expect(shown(sent(list, threadComposer("C", "R")))).toEqual([
    "thread:C:R",
    "details:N",
  ]);
  // A thread is not closed by a send from the composer under it.
  expect(shown(sent(list, channel))).toEqual(shown(list));
});

it("leaves the stack of a thread moved to a tab over its composer", () => {
  const list = open([], thread("R"), details("M", threadComposer("C", "R")));
  const moved = movedToTab(list, "thread:C:R");
  expect(shown(moved)).toEqual(["details:M"]);
  // It names the thread's composer, which the tab now shows.
  expect(moved[0]?.composer).toBe(threadComposer("C", "R"));
  expect(moved[0] && stacked(moved, moved[0])).toBe(false);
});

it("closes a channel's containers when the workspace leaves it", () => {
  const list = open([], thread("R"), details("N", channelComposer("D"), "D"));
  expect(shown(left(list, "D"))).toEqual(["details:N"]);
  expect(shown(left(list, undefined))).toEqual([]);
  // Staying in the channel changes nothing.
  const same = open([], thread("R"));
  expect(left(same, "C")).toBe(same);
});
