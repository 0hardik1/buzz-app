// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import type { ChannelMessage, ChannelSummary } from "../relay/contracts";
import type { RelaySession } from "../relay/session";
import { ChatNotStarted } from "../relay/channel-writes";
import type { MentionDraft } from "../messages/mention-draft";
import { askInSideChat, readSideChatSource, sideChatMarker } from "./side-chat";

afterEach(() => localStorage.clear());

const viewer = "a".repeat(64),
  agent = "b".repeat(64),
  person = "c".repeat(64),
  root = "d".repeat(64),
  reply = "e".repeat(64);
const scope = `https://relay.example.org:${viewer}`;
const message = (fields: Partial<ChannelMessage>): ChannelMessage => ({
  id: root,
  channelId: "design",
  authorId: person,
  content: "Why is the build red?",
  createdAt: 1,
  mentions: [],
  participants: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
  ...fields,
});
const draft = (pubkeys = [agent]): MentionDraft => ({
  text: "@Doo look",
  recipients: pubkeys.map((pubkey) => ({
    pubkey,
    name: "Doo",
    start: 0,
    end: 4,
  })),
});

function harness(chats: ChannelSummary[] = []) {
  const session = {
    viewer,
    scope,
    profiles: { ensure: vi.fn(async () => {}), event: () => undefined },
    agentChoices: {
      snapshot: () => ({
        complete: true,
        selectable: [{ pubkey: agent, name: "Doo" }],
      }),
      refresh: vi.fn(async () => {}),
    },
    channels: { list: () => ({ status: "ready", channels: chats }) },
    channelWrites: {
      start: vi.fn(() => ({ create: "create", ready: Promise.resolve() })),
    },
    messages: { send: vi.fn(() => "sent"), reply: vi.fn(() => "marker") },
  };
  const ask = (
    rows: readonly ChannelMessage[] = [message({})],
    tagged = draft(),
  ) =>
    askInSideChat(session as unknown as RelaySession, scope, {
      draft: tagged,
      content: "@Doo look",
      replyTo: message({ id: reply, threadRootId: root }),
      rootId: root,
      rows,
      asker: "Noah",
    });
  return { session, ask };
}
const link = `buzz://message?channel=design&id=${reply}&thread=${root}`;

it("asks your agent in a new side chat and leaves a marker that tags nobody", async () => {
  const h = harness();
  const chat = await h.ask();
  expect(h.session.channelWrites.start).toHaveBeenCalledWith(
    chat,
    "look",
    [agent],
    undefined,
    false,
    undefined,
    { admins: [] },
  );
  expect(h.session.messages.send).toHaveBeenCalledExactlyOnceWith(
    chat,
    `@Doo look\n\n${link}`,
    [agent],
  );
  // No mentions argument: the marker notifies nobody.
  expect(h.session.messages.reply).toHaveBeenCalledExactlyOnceWith(
    "design",
    root,
    `[Noah is asking Doo →](buzz://channel/${chat})`,
  );
  expect(readSideChatSource(scope, chat ?? "")).toEqual({
    channelId: "design",
    rootId: root,
  });
});

it("reuses the side chat your marker in the thread links, after a restart too", async () => {
  const chat: ChannelSummary = {
    id: "side",
    name: "look",
    channelType: "solo",
    members: [viewer, agent],
  };
  const h = harness([chat]);
  const marker = message({
    id: "f".repeat(64),
    authorId: viewer,
    content: sideChatMarker("Noah", "Doo", "side"),
  });
  expect(await h.ask([message({}), marker])).toBe("side");
  expect(h.session.channelWrites.start).not.toHaveBeenCalled();
  expect(h.session.messages.reply).not.toHaveBeenCalled();
  expect(h.session.messages.send).toHaveBeenCalledExactlyOnceWith(
    "side",
    `@Doo look\n\n${link}`,
    [agent],
  );
  // Someone else's marker, or one for an archived chat, starts a new chat.
  const others = harness([{ ...chat, archived: true }]);
  await others.ask([marker, { ...marker, authorId: person }]);
  expect(others.session.channelWrites.start).toHaveBeenCalledOnce();
});

it("leaves drafts that are not for one of your agents alone", async () => {
  for (const tagged of [draft([person]), draft([agent, person]), draft([])]) {
    const h = harness();
    expect(await h.ask(undefined, tagged)).toBeUndefined();
    expect(h.session.messages.send).not.toHaveBeenCalled();
    expect(h.session.messages.reply).not.toHaveBeenCalled();
  }
});

it("posts no marker when the relay refuses the chat", async () => {
  const h = harness();
  const ready = Promise.reject(new ChatNotStarted("refused"));
  h.session.channelWrites.start.mockImplementationOnce(() => ({
    create: "create",
    ready,
  }));
  await expect(h.ask()).rejects.toThrow("refused");
  expect(h.session.messages.reply).not.toHaveBeenCalled();
});

it("escapes names so the marker stays one link", () => {
  expect(sideChatMarker("[x]", "a\\b", "id 1")).toBe(
    "[\\[x\\] is asking a\\\\b →](buzz://channel/id%201)",
  );
});
