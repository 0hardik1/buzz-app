import { expect, it } from "vitest";
import { type InboxItem, inboxMentioners, inboxUnreadChannels } from "./inbox";

const item = (fields: Partial<InboxItem>): InboxItem => ({
  id: "room:root",
  channelId: "room",
  target: { kind: "thread", channelId: "room", rootId: "root" },
  messageId: "root",
  latestMessageId: "root",
  messageIds: ["root"],
  authorId: "alice",
  preview: "",
  previewMentions: { content: "", mentions: [] },
  createdAt: 10,
  mentioned: false,
  messages: [],
  thread: true,
  unreadCount: 0,
  manual: false,
  readThrough: [],
  ...fields,
});
const mentioners = (items: InboxItem[]) =>
  inboxMentioners({ status: "ready", items, freshness: "observed" });

it("shows who mentioned you only while that mention is unread", () => {
  // Alice's root mentioned you and is read; Bob's later reply doesn't mention you.
  const readMention = item({ mentioned: true, createdAt: 10 });
  const plainReply = item({
    authorId: "bob",
    mentioned: true,
    unreadCount: 1,
    createdAt: 20,
    mention: readMention,
  });
  expect(mentioners([plainReply])).toEqual(new Map());

  const unreadMention = item({ mentioned: true, unreadCount: 1 });
  expect(
    mentioners([{ ...plainReply, mention: unreadMention }]).get("room"),
  ).toEqual(["alice"]);
});

it("leaves workflow mentions faceless and orders people newest first", () => {
  const mention = (authorId: string, createdAt: number, extra = {}) =>
    item({
      id: `room:${authorId}`,
      authorId,
      createdAt,
      unreadCount: 1,
      mention: item({ authorId, createdAt, unreadCount: 1, ...extra }),
    });
  expect(
    mentioners([
      mention("alice", 10),
      mention("bot", 30, { workflowOwnerId: "owner" }),
      mention("bob", 20),
    ]).get("room"),
  ).toEqual(["bob", "alice"]);
});

it("counts a channel as waiting only while one of its conversations is unread", () => {
  const unread = (items: InboxItem[]) =>
    inboxUnreadChannels({ status: "ready", items, freshness: "observed" });
  // A read conversation lingers in Activity but leaves its channel's backlog alone.
  expect(unread([item({ unreadCount: 0, manual: false })])).toEqual(new Set());
  expect(unread([item({ unreadCount: 2 })])).toEqual(new Set(["room"]));
  expect(unread([item({ manual: true })])).toEqual(new Set(["room"]));
});
