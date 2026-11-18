import { describe, expect, it, vi } from "vitest";
import type { DecisionResult, Decisions } from "../decisions/service";
import type {
  ChannelMessage,
  ChannelSummary,
  ChannelWindow,
} from "../relay/contracts";
import type { InboxItem } from "../relay/inbox";
import { mergeTranscript } from "./voice-dictation";
import {
  type JumpPlace,
  jumpPlaces,
  pickPlace,
  placeOptions,
} from "./voice-jump";

const message = (
  id: string,
  content: string,
  createdAt: number,
  extra: Partial<ChannelMessage> = {},
) =>
  ({
    id,
    channelId: "c",
    authorId: "alice",
    createdAt,
    content,
    mentions: [],
    attachments: [],
    reactions: [],
    replyCount: 0,
    participants: [],
    ...extra,
  }) as ChannelMessage;

const history = (
  rows: readonly ChannelMessage[],
  hasMore = true,
): ChannelWindow => ({
  channelId: "c",
  status: "ready",
  rows,
  hasMore,
  loadingOlder: false,
  error: undefined,
});

const empty = history([]);

describe("jumpPlaces", () => {
  const channels: ChannelSummary[] = [
    {
      id: "design",
      name: "design",
      channelType: "stream",
      lastActivityAt: 100,
      description: "Design reviews",
    },
    // The relay marks every DM `hidden`.
    {
      id: "dm",
      name: "",
      channelType: "dm",
      hidden: true,
      lastActivityAt: 300,
    },
    { id: "secret", name: "secret", channelType: "stream", hidden: true },
    { id: "huddle", name: "huddle", channelType: "stream", huddle: true },
    {
      id: "chat",
      name: "Plan the offsite",
      channelType: "solo",
      lastActivityAt: 200,
      preview: "Drafting the agenda",
    },
    { id: "old", name: "old", channelType: "stream", archived: true },
    { id: "sys", name: "sys", channelType: "system" },
  ];
  const windows: Record<string, ChannelWindow> = {
    design: history([
      message("m1", "Kickoff", 10),
      message("m2", "Logo options", 20, { replyCount: 3 }),
      message("m3", "a reply", 25, { threadRootId: "m2" }),
      message("m4", "Ship it", 30),
    ]),
    chat: history([message("c1", "Help me plan the offsite", 50)], false),
  };
  const activity = [
    {
      channelId: "dm",
      rootId: "t1",
      thread: true,
      preview: "Sounds good",
      authorId: "bob",
      createdAt: 400,
    },
    // Already in memory as a root, so not repeated.
    {
      channelId: "design",
      rootId: "m2",
      thread: true,
      preview: "latest",
      authorId: "bob",
      createdAt: 500,
    },
  ] as unknown as InboxItem[];
  const places = jumpPlaces({
    channels,
    name: (channel) => (channel.channelType === "dm" ? "Bob" : channel.name),
    window: (id) => windows[id] ?? empty,
    activity,
    author: (pubkey) => (pubkey === "alice" ? "Alice" : "Bob"),
  });

  it("lists the conversations in memory, most recent first, then threads", () => {
    expect(places.map(({ key }) => key)).toEqual([
      "dm:dm",
      "chat:chat",
      "channel:design",
      "thread:t1",
      "thread:m2",
    ]);
  });

  it("describes each place from what is already loaded", () => {
    const byKey = new Map(places.map((place) => [place.key, place]));
    expect(byKey.get("channel:design")).toMatchObject({
      name: "design",
      about: "Design reviews",
      recent: ["Alice: Kickoff", "Alice: Logo options", "Alice: Ship it"],
    });
    // Its whole history is loaded, so the first message is known.
    expect(byKey.get("chat:chat")).toMatchObject({
      kind: "chat",
      recent: ["Alice: Help me plan the offsite"],
    });
    expect(byKey.get("dm:dm")).toMatchObject({ kind: "dm", name: "Bob" });
    expect(byKey.get("thread:m2")).toMatchObject({
      channelId: "design",
      rootId: "m2",
      name: "Alice: Logo options",
      in: "design",
    });
    expect(byKey.get("thread:t1")).toMatchObject({
      channelId: "dm",
      rootId: "t1",
      in: "Bob",
    });
  });

  it("uses a conversation's preview when none of its messages are loaded", () => {
    const [place] = jumpPlaces({
      channels: channels.filter(({ id }) => id === "chat"),
      name: (channel) => channel.name,
      window: () => empty,
      activity: [],
      author: () => "Alice",
    });
    expect(place?.recent).toEqual(["Drafting the agenda"]);
  });
});

const places: JumpPlace[] = [
  { key: "channel:a", kind: "channel", channelId: "a", name: "design", at: 2 },
  { key: "dm:b", kind: "dm", channelId: "b", name: "Dana Lee", at: 1 },
];

const deciding = (result: DecisionResult) => {
  const decide = vi.fn(async (_request: unknown) => result);
  return { decisions: { decide } as unknown as Decisions, decide };
};

const choice = (pick: string, probabilities: Record<string, number>) =>
  ({
    outcome: "answered",
    backend: "test",
    model: "jev",
    answers: {
      place: {
        type: "choice",
        choice: pick,
        confidence: probabilities[pick] ?? 0,
        probabilities,
      },
    },
  }) as const;

describe("pickPlace", () => {
  it("goes to the place Jev picks at 0.5 or more", async () => {
    const { decisions, decide } = deciding(
      choice("DM with Dana Lee", {
        "#design": 0.3,
        "DM with Dana Lee": 0.6,
        none: 0.1,
      }),
    );
    await expect(
      pickPlace(decisions, "dana", places, "wss://relay.example.org"),
    ).resolves.toEqual({
      outcome: "found",
      place: places[1],
      probability: 0.6,
    });
    const request = decide.mock.calls[0]?.[0] as unknown as {
      state: string;
      community: string;
      questions: { place: { options: Record<string, string> } };
    };
    expect(JSON.parse(request.state)).toEqual({
      spoken_request: "dana",
      places: [
        { option: "#design", kind: "channel" },
        { option: "DM with Dana Lee", kind: "dm" },
      ],
    });
    expect(Object.keys(request.questions.place.options)).toEqual([
      "#design",
      "DM with Dana Lee",
      "none",
    ]);
    expect(request.community).toBe("wss://relay.example.org");
  });

  it("finds nothing below 0.5 or for none, and reports a failure", async () => {
    for (const result of [
      choice("#design", {
        "#design": 0.49,
        "DM with Dana Lee": 0.3,
        none: 0.21,
      }),
      choice("none", { "#design": 0.04, "DM with Dana Lee": 0.01, none: 0.95 }),
    ]) {
      const { decisions } = deciding(result);
      await expect(
        pickPlace(decisions, "design", places, undefined),
      ).resolves.toEqual({ outcome: "none" });
    }
    const { decisions } = deciding({
      outcome: "failed",
      backend: "test",
      reason: "timeout",
    });
    await expect(
      pickPlace(decisions, "design", places, undefined),
    ).resolves.toEqual({ outcome: "failed", reason: "timeout" });
  });

  it("asks nothing without a request or places", async () => {
    const { decisions, decide } = deciding(choice("#design", { "#design": 1 }));
    await expect(pickPlace(decisions, " ", places, undefined)).resolves.toEqual(
      { outcome: "none" },
    );
    await expect(
      pickPlace(decisions, "design", [], undefined),
    ).resolves.toEqual({ outcome: "none" });
    expect(decide).not.toHaveBeenCalled();
  });
});

describe("placeOptions", () => {
  it("names each place readably and keeps the names unique", () => {
    const thread: JumpPlace = {
      key: "thread:t",
      kind: "thread",
      channelId: "a",
      rootId: "t",
      name: "Alice: Logo options",
      in: "design",
      at: 0,
    };
    expect(
      placeOptions([
        ...places,
        {
          key: "channel:c",
          kind: "channel",
          channelId: "c",
          name: "design",
          at: 0,
        },
        { key: "chat:d", kind: "chat", channelId: "d", name: "Fizz", at: 0 },
        thread,
        { ...thread, key: "thread:u", rootId: "u", name: "x".repeat(200) },
      ]),
    ).toEqual([
      "#design",
      "DM with Dana Lee",
      "#design (2)",
      "Chat with Fizz",
      "Thread in design: Alice: Logo options",
      `Thread in design: ${"x".repeat(71)}…`,
    ]);
  });
});

describe("mergeTranscript", () => {
  const delta = "conversation.item.input_audio_transcription.delta";
  const completed = "conversation.item.input_audio_transcription.completed";
  it("appends deltas and skips a completed segment already heard", () => {
    let text = mergeTranscript("", { type: delta, delta: "Open" });
    text = mergeTranscript(text, { type: delta, delta: " design" });
    expect(text).toBe("Open design");
    expect(
      mergeTranscript(text, { type: completed, transcript: "Open design" }),
    ).toBe("Open design");
    expect(mergeTranscript("", { type: completed, transcript: "hi" })).toBe(
      "hi",
    );
    expect(mergeTranscript(text, { type: "session.created" })).toBe(text);
  });
});
