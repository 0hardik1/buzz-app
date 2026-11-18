import { expect, test, vi } from "vitest";
import type {
  Decisions,
  DecisionAnswer,
  DecisionResult,
} from "../decisions/service";
import {
  describeSection,
  localSectionRule,
  matchesLiveConversation,
  liveSectionMatches,
  parseLiveSection,
} from "./live-section";

const avery = { name: "Avery Reed", pubkey: "a".repeat(64) };
const unrelated = { name: "Unrelated Person", pubkey: "b".repeat(64) };

test.each([
  "DMs with Avery and Unknown",
  "DMs with Avery,",
  "DMs with Ave",
  "DMs with Avery from yesterday",
])(
  "local previews do not silently drop unfinished or unsupported conditions: %s",
  (description) => {
    expect(localSectionRule(description, [avery])).toBeUndefined();
  },
);

test("local name matching preserves accents, Unicode and namesake ambiguity using Search’s rules", () => {
  const people = [
    avery,
    { pubkey: "c".repeat(64), name: "Avery Chen" },
    { pubkey: "d".repeat(64), name: "José Luis" },
    { pubkey: "e".repeat(64), name: "张伟" },
  ];
  expect(localSectionRule("DMs with Avery", people)).toBeUndefined();
  expect(localSectionRule("DMs with Jose and 张伟", people)).toMatchObject({
    people: ["d".repeat(64), "e".repeat(64)],
  });
});
const pick = (choice: string): DecisionAnswer => ({
  type: "choice",
  choice,
  confidence: 1,
  probabilities: {},
});
function service(answers: Record<string, DecisionAnswer>) {
  const decide = vi.fn(
    async (): Promise<DecisionResult> => ({
      outcome: "answered",
      backend: "fixture",
      model: "fixture",
      answers: {
        allDms: { type: "yes_no", probability: 0 },
        allPeople: { type: "yes_no", probability: 1 },
        state: pick("open"),
        topic_start: pick("none"),
        topic_end: pick("none"),
        author_start: pick("none"),
        author_end: pick("none"),
        repo_start: pick("none"),
        repo_end: pick("none"),
        ...answers,
      },
    }),
  );
  return { decide, decisions: { decide } as unknown as Decisions };
}

test("DM intent saves actual identity predicates and follows newly matching DMs without another decision", async () => {
  const { decisions, decide } = service({
    kind: pick("dms"),
    person1: pick("p0"),
    person2: pick("none"),
    person3: pick("none"),
  });
  const rule = await describeSection(
    decisions,
    "DMs with Avery",
    [avery, unrelated],
    "https://relay.example",
  );
  expect(rule).toEqual({ version: 1, dms: true, people: [avery.pubkey] });
  expect(
    matchesLiveConversation(rule, {
      id: "new-dm",
      name: "New DM",
      channelType: "dm",
      hidden: true,
      participants: [avery.pubkey],
    }),
  ).toBe(true);
  for (const channel of [
    { channelType: "stream" as const, participants: [avery.pubkey] },
    { channelType: "dm" as const, participants: [unrelated.pubkey] },
    {
      channelType: "dm" as const,
      participants: [avery.pubkey],
      archived: true as const,
    },
    {
      channelType: "dm" as const,
      participants: [avery.pubkey],
      metadataPending: true,
    },
  ])
    expect(
      matchesLiveConversation(rule, { id: "other", name: "Other", ...channel }),
    ).toBe(false);
  const request = JSON.stringify(decide.mock.calls);
  expect(request).toContain(avery.name);
  expect(request).not.toContain(avery.pubkey);
  expect(request).not.toContain(unrelated.name);
  expect(request).not.toContain(unrelated.pubkey);
  expect(decide).toHaveBeenCalledTimes(2);
});

test.each([
  ["open PRs about search by @octocat", 'is:open author:octocat "search"'],
  ["open PRs about chat by @avery", 'is:open author:avery "chat"'],
])(
  "PR intent extracts topic and author without sending the community directory: %s",
  async (description, query) => {
    const { decisions, decide } = service({
      kind: pick("github"),
      topic_start: pick("4"),
      topic_end: pick("4"),
      author_start: pick("6"),
      author_end: pick("6"),
    });
    const rule = await describeSection(
      decisions,
      description,
      [avery, unrelated],
      "https://relay.example",
    );
    expect(rule).toEqual({
      version: 1,
      dms: false,
      people: [],
      github: query,
    });
    expect(JSON.stringify(decide.mock.calls)).not.toContain(avery.name);
    expect(JSON.stringify(decide.mock.calls)).not.toContain(unrelated.pubkey);
  },
);

test("literal Unicode participant names resolve to actual identities", async () => {
  const person = { name: "张伟", pubkey: "c".repeat(64) };
  const { decisions } = service({ kind: pick("dms"), person1: pick("p0") });
  await expect(
    describeSection(
      decisions,
      "DMs with 张伟",
      [person],
      "https://relay.example",
    ),
  ).resolves.toMatchObject({ people: [person.pubkey] });
});

test("canceling classification prevents a follow-up request containing participant names", async () => {
  let release!: (value: DecisionResult) => void;
  const classification = new Promise<DecisionResult>((resolve) => {
    release = resolve;
  });
  const decide = vi.fn(() => classification);
  const controller = new AbortController();
  const pending = describeSection(
    { decide } as unknown as Decisions,
    "DMs with Avery",
    [avery],
    "https://relay.example",
    controller.signal,
  );
  controller.abort();
  release({
    outcome: "answered",
    backend: "fixture",
    model: "fixture",
    answers: { kind: pick("dms"), allDms: { type: "yes_no", probability: 0 } },
  });
  await expect(pending).rejects.toThrow();
  expect(decide).toHaveBeenCalledTimes(1);
  expect(JSON.stringify(decide.mock.calls)).not.toContain(avery.name);
});

test.each([
  { kind: pick("none") },
  { kind: pick("dms"), person1: pick("none") },
  {
    kind: pick("dms"),
    person1: pick("p0"),
    allPeople: { type: "yes_no", probability: 0 } as DecisionAnswer,
  },
  { kind: pick("github"), topic_start: pick("4"), topic_end: pick("2") },
])(
  "ambiguous or incomplete intent never becomes a broader saved collection (%#)",
  async (answers) => {
    const { decisions } = service(answers);
    await expect(
      describeSection(
        decisions,
        "DMs with Avery",
        [avery],
        "https://relay.example",
      ),
    ).rejects.toThrow();
  },
);

test("provider failure leaves manual filter creation available to the caller", async () => {
  const decisions = {
    decide: async () => ({ outcome: "failed", reason: "unavailable" }),
  } as unknown as Decisions;
  await expect(
    describeSection(decisions, "all DMs", [], "https://relay.example"),
  ).rejects.toThrow(/choose filters/);
  expect(parseLiveSection({ version: 1, dms: true, people: [] })).toEqual({
    version: 1,
    dms: true,
    people: [],
  });
});

test.each([
  null,
  { version: 2, dms: true, people: [] },
  { version: 1, dms: true, people: ["not-a-key"] },
  { version: 1, dms: false, people: [] },
  { version: 1, dms: false, people: [], github: " " },
])("invalid stored filters are ignored (%#)", (raw) => {
  expect(parseLiveSection(raw)).toBeUndefined();
});

test("saved text searches keep finding matching DMs and channels as the list changes", () => {
  const rule = parseLiveSection({
    version: 1,
    dms: false,
    people: [avery.pubkey],
    search: "  navigation  ",
  });
  expect(rule).toEqual({
    version: 1,
    dms: false,
    people: [avery.pubkey],
    search: "navigation",
  });
  if (!rule) throw new Error("Missing search rule");
  expect(
    matchesLiveConversation(
      rule,
      {
        id: "future-dm",
        name: "Opaque label",
        channelType: "dm",
        participants: [unrelated.pubkey],
      },
      "Opaque label",
      new Map([
        [unrelated.pubkey, { name: "opaque", username: "navigation-owner" }],
      ]),
    ),
  ).toBe(true);

  expect(
    liveSectionMatches(
      rule,
      [
        { id: "fuzzy", name: "navigational", channelType: "stream" },
        { id: "exact", name: "navigation", channelType: "stream" },
      ],
      (channel) => channel.name,
    ).map((channel) => channel.id),
  ).toEqual(["exact", "fuzzy"]);
  expect(
    matchesLiveConversation(rule, {
      id: "new",
      name: "team-navigation",
      channelType: "stream",
    }),
  ).toBe(true);
  expect(
    matchesLiveConversation(rule, {
      id: "dm",
      name: "Private",
      channelType: "dm",
      hidden: true,
      participants: [avery.pubkey],
    }),
  ).toBe(true);
  expect(
    matchesLiveConversation(rule, {
      id: "other",
      name: "Random",
      channelType: "dm",
      participants: [unrelated.pubkey],
    }),
  ).toBe(false);
  expect(
    matchesLiveConversation(rule, {
      id: "hidden",
      name: "navigation",
      channelType: "stream",
      hidden: true,
    }),
  ).toBe(false);
});

test("an all-DMs inference cannot broaden a request for a specific person", async () => {
  const { decisions } = service({
    kind: pick("dms"),
    allDms: { type: "yes_no", probability: 1 },
    person1: pick("none"),
  });
  await expect(
    describeSection(
      decisions,
      "DMs with Avery",
      [avery],
      "https://relay.example",
    ),
  ).rejects.toThrow(/every DM participant/);
});
