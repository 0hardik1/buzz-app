import { afterEach, expect, it, vi } from "vitest";
import { createOutbox, PublishRejected } from "../../features/relay/outbox";
import type {
  EventData,
  RelayEvent,
  ReadFilter,
} from "../../features/relay/events";
import { keypair, signed } from "../../features/relay/testing";
import { uuidv5 } from "../../features/agents/agent-config-artifacts";
import {
  overallReviewStatus,
  reviewTarget,
} from "../../features/agents/pr-review";
import { reviewAgentProfile, reviewTestAccess } from "./testing";
import { validateConfig, type SavedReviewConfig } from "./configuration";
import { reserveDailyReview } from "./daily-limit";
import {
  submitReview,
  deleteSubmission,
  writeSubmission,
  loadSubmissions,
  remindSubmission,
  submissionLane,
  type SavedSubmission,
} from "./submissions";
import { reportHumanReview } from "./human-review";
import {
  loadReviewLog,
  loadLogMessages,
  submissionLogScope,
} from "./review-log";
import { advanceReview } from "./automation";
import type { ReviewSession } from "./session";

const channel = "11111111-1111-4111-8111-111111111111";
const signal = () => AbortSignal.timeout(10000);
const tag = (event: EventData, name: string) =>
  event.tags.find(([key]) => key === name)?.[1];
const cleanups: (() => void)[] = [];
afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.restoreAllMocks();
});

async function fixture() {
  let now = Date.UTC(2026, 10, 16, 10);
  vi.spyOn(Date, "now").mockImplementation(() => now);
  const owner = keypair(),
    human = keypair(),
    backup = keypair(),
    agent = keypair(),
    second = keypair();
  const events: RelayEvent[] = [
    reviewAgentProfile(owner, agent),
    reviewAgentProfile(owner, second),
    ...[owner, human, backup].map((key) =>
      signed(key, {
        kind: 0,
        content: JSON.stringify({ name: "Reviewer" }),
        tags: [],
      }),
    ),
  ];
  const heads = new Map<string, RelayEvent>();
  let failMessage = false,
    uncertainCounter = false;
  const read = async (filters: readonly ReadFilter[]) =>
    filters.flatMap((filter) => {
      const source =
        filter.artifact === "current" ? [...heads.values()] : events;
      return source
        .filter(
          (event) =>
            (!filter.kinds || filter.kinds.includes(event.kind)) &&
            (!filter.ids || filter.ids.includes(event.id)) &&
            (!filter.authors || filter.authors.includes(event.pubkey)) &&
            (filter.until === undefined || event.created_at <= filter.until) &&
            (filter.before_id === undefined ||
              event.created_at < (filter.until ?? Infinity) ||
              event.id > filter.before_id) &&
            Object.entries(filter).every(
              ([name, values]) =>
                !name.startsWith("#") ||
                (values as readonly string[]).some((value) =>
                  event.tags.some(
                    ([key, item]) => key === name.slice(1) && item === value,
                  ),
                ),
            ),
        )
        .sort((a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id))
        .slice(filter.offset ?? 0, (filter.offset ?? 0) + filter.limit);
    });
  const publish = async (event: RelayEvent) => {
    if (event.kind === 9 && failMessage) {
      failMessage = false;
      throw new Error("offline");
    }
    if (events.some((item) => item.id === event.id)) return;
    if (event.kind === 45010) {
      const id = tag(event, "d") ?? "";
      if (tag(event, "prev") !== heads.get(id)?.id)
        throw new PublishRejected("conflict: stale revision");
      heads.set(id, event);
    }
    events.push(event);
    if (
      event.kind === 45010 &&
      tag(event, "type") === "buzz.review.daily-usage" &&
      uncertainCounter
    ) {
      uncertainCounter = false;
      throw new Error("response lost");
    }
  };
  function session(key = owner) {
    const access = reviewTestAccess(key.pubkey, channel, [
      owner.pubkey,
      human.pubkey,
      backup.pubkey,
      agent.pubkey,
      second.pubkey,
    ]);
    const writer = {
      sign: async (template: Parameters<typeof signed>[1]) =>
        signed(key, template),
      publish,
    };
    const box = createOutbox(key.pubkey, writer, {
      load: () => [],
      save: async () => {},
    });
    cleanups.push(box.dispose);
    let queue = Promise.resolve();
    const session: ReviewSession = {
      ...access,
      channelDetails: {
        load: async () => ({
          visibility: "private",
          channelId: channel,
          version: "fixture",
          canEdit: true,
          name: "Reviews",
          description: "",
        }),
      },
      scope: `https://example.org:${key.pubkey}`,
      snapshotRead: read,
      configArtifactWriter: writer,
      outbox: box.outbox,
      agentChoices: {
        refresh: async () => {},
        snapshot: () =>
          ({
            archives: { status: "ready", archived: [] },
            selectable: [],
          }) as never,
      },
      reviewRuntime: {
        device: crypto.randomUUID(),
        remember() {},
        forget() {},
        lock: async (_signal, run) => {
          const task = queue.then(run);
          queue = task.then(
            () => {},
            () => {},
          );
          return task;
        },
      },
    };
    return session;
  }
  const saved: SavedReviewConfig = {
    artifactId: await uuidv5(channel, "buzz.review.config:example-org/project"),
    revision: "c".repeat(64),
    config: {
      version: 1,
      repository: "example-org/project",
      reminderMinutes: 15,
      lanes: [
        {
          id: "ui",
          name: "UI",
          instructions: "Review carefully",
          reviewers: [agent.pubkey, second.pubkey, human.pubkey, backup.pubkey],
          humanReviewers: [human.pubkey, backup.pubkey],
          requireHuman: true,
          minimumReviewers: 3,
          autoApprove: true,
        },
      ],
    },
  };
  function configure(config = saved) {
    const head = signed(owner, {
      kind: 45010,
      content: JSON.stringify(config.config),
      tags: [
        ["h", channel],
        ["d", config.artifactId],
        ["type", "buzz.review.config"],
      ],
    });
    heads.set(config.artifactId, head);
    return { ...config, revision: head.id };
  }
  Object.assign(saved, configure());
  const own = session(),
    person = session(human);
  const submit = (pr = "42", config = saved) =>
    submitReview(
      own,
      channel,
      configure(config),
      pr,
      [agent.pubkey],
      signal(),
      () => {},
      true,
    );
  const fresh = async (row: SavedSubmission) => {
    const result = (
      await loadSubmissions(own, channel, signal(), {
        artifact: row.artifactId,
      })
    ).rows[0];
    if (!result) throw new Error("Missing submission");
    return result;
  };
  return {
    configure,
    owner,
    agent,
    second,
    human,
    backup,
    own,
    person,
    saved,
    session,
    submit,
    fresh,
    events,
    heads,
    advance: (ms: number) => {
      now += ms;
    },
    failMessage: () => {
      failMessage = true;
    },
    uncertainCounter: () => {
      uncertainCounter = true;
    },
  };
}

it("validates daily limits, reviewer counts, and required human membership in the lane pool", () => {
  const base = {
    version: 1,
    repository: "example-org/project",
    reminderMinutes: 15,
    lanes: [
      {
        id: "ui",
        name: "UI",
        instructions: "Review",
        reviewers: ["a".repeat(64), "b".repeat(64)],
      },
    ],
  };
  expect(validateConfig(base).maxPrsPerDay).toBeUndefined();
  for (const maxPrsPerDay of [0, -1, 1.5, NaN, 100001])
    expect(() => validateConfig({ ...base, maxPrsPerDay })).toThrow(
      "Daily PR limit",
    );
  for (const minimumReviewers of [0, 3, 1.5])
    expect(() =>
      validateConfig({
        ...base,
        lanes: [{ ...base.lanes[0], minimumReviewers }],
      }),
    ).toThrow("Minimum reviewers");
  expect(() =>
    validateConfig({
      ...base,
      lanes: [{ ...base.lanes[0], requireHuman: true }],
    }),
  ).toThrow("human");
});

it("serializes two submitters at the daily cap and retains uncertain reservations across retries and UTC reset", async () => {
  const f = await fixture();
  const limited = f.configure({
    ...f.saved,
    config: { ...f.saved.config, maxPrsPerDay: 1 },
  });
  const a = crypto.randomUUID(),
    b = crypto.randomUUID();
  const results = await Promise.allSettled([
    reserveDailyReview(f.own, channel, limited, a, undefined, signal()),
    reserveDailyReview(
      f.session(f.human),
      channel,
      limited,
      b,
      undefined,
      signal(),
    ),
  ]);
  expect(
    results.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  const winner = results[0]?.status === "fulfilled" ? a : b;
  await reserveDailyReview(
    f.own,
    channel,
    limited,
    winner,
    undefined,
    signal(),
  );
  expect(
    f.events.filter(
      (event) => tag(event, "type") === "buzz.review.daily-usage",
    ),
  ).toHaveLength(1);
  f.advance(86400000);
  f.uncertainCounter();
  await expect(
    reserveDailyReview(f.own, channel, limited, a, undefined, signal()),
  ).rejects.toThrow("response lost");
  await reserveDailyReview(f.own, channel, limited, a, undefined, signal());
  await expect(
    reserveDailyReview(f.own, channel, limited, b, undefined, signal()),
  ).rejects.toThrow("Daily PR limit");
});

it("creates a separate thread for each selected reviewer, requires human work, and reminds one row independently", async () => {
  const f = await fixture();
  let row = await f.submit();
  expect(row.value.threads).toHaveLength(3);
  expect(row.value.config.lanes[0]?.reviewers).toEqual([
    f.agent.pubkey,
    f.human.pubkey,
    f.second.pubkey,
  ]);
  expect(new Set(row.value.threads.map((thread) => thread.id)).size).toBe(3);
  for (const [index, key] of (
    row.value.config.lanes[0]?.reviewers ?? []
  ).entries()) {
    const root = row.value.threads[index]?.id ?? "";
    const head = f.heads.get(row.artifactId);
    if (!head) throw new Error("Missing head");
    expect((await reviewTarget(head, channel, root, key)).index).toBe(index);
    expect(f.events.find((event) => event.id === root)?.tags).toContainEqual([
      "p",
      key,
    ]);
  }
  await expect(
    reportHumanReview(f.own, channel, row, 1, "reviewing", "", signal()),
  ).rejects.toThrow("not assigned");
  await expect(
    reportHumanReview(
      f.person,
      channel,
      row,
      1,
      "lgtm_not_approved",
      "",
      signal(),
    ),
  ).rejects.toThrow("Start your review");
  await reportHumanReview(
    f.person,
    channel,
    row,
    1,
    "reviewing",
    "Reading commit",
    signal(),
  );
  await reportHumanReview(
    f.person,
    channel,
    row,
    1,
    "lgtm_not_approved",
    "Reviewed",
    signal(),
  );
  row = await f.fresh(row);
  expect(row.reviewStates).toEqual([
    "need_review",
    "lgtm_not_approved",
    "need_review",
  ]);
  expect(
    overallReviewStatus(["approved", "lgtm_not_approved", "approved"]),
  ).toBe("lgtm_not_approved");
  await expect(
    reportHumanReview(f.person, channel, row, 1, "approved", "", signal()),
  ).rejects.toThrow("Confirm");
  await reportHumanReview(
    f.person,
    channel,
    row,
    1,
    "approved",
    "Approved current commit on GitHub",
    signal(),
    true,
  );
  row = await f.fresh(row);
  expect(row.reviewStates?.[1]).toBe("approved");
  const before = row.value.threads.map((thread) => thread.request);
  const next = await remindSubmission(
    f.own,
    channel,
    row,
    signal(),
    async () => "Open",
    "",
    "ui:1",
    "Please recheck",
  );
  expect(next.value.threads[0]?.request).toBe(before[0]);
  expect(next.value.threads[1]?.request).not.toBe(before[1]);
  expect(next.value.threads[2]?.request).toBe(before[2]);
  expect((await f.fresh(next)).reviewStates?.[1]).toBe("need_review");
  await expect(
    reportHumanReview(
      f.person,
      channel,
      row,
      1,
      "approved",
      "Old review",
      signal(),
      true,
    ),
  ).rejects.toThrow("changed");
  expect(
    f.events.filter(
      (event) => tag(event, "type") === "buzz.review.daily-usage",
    ),
  ).toHaveLength(1);
});

it("never recovers a pending human outcome as a different selected result", async () => {
  const f = await fixture();
  const row = await f.submit();
  await reportHumanReview(f.person, channel, row, 1, "reviewing", "", signal());
  f.failMessage();
  await expect(
    reportHumanReview(
      f.person,
      channel,
      row,
      1,
      "request_changes",
      "Fix this",
      signal(),
    ),
  ).rejects.toThrow();
  await expect(
    reportHumanReview(
      f.person,
      channel,
      row,
      1,
      "lgtm_not_approved",
      "Looks fine",
      signal(),
    ),
  ).rejects.toThrow("different review report");
  await reportHumanReview(
    f.person,
    channel,
    row,
    1,
    "request_changes",
    "Fix this",
    signal(),
  );
  expect((await f.fresh(row)).reviewStates?.[1]).toBe("request_changes");
});

it("rotates a human assignment to an eligible human backup and preserves the other rows", async () => {
  const f = await fixture();
  let row = await f.submit();
  await reportHumanReview(f.person, channel, row, 1, "reviewing", "", signal());
  row = await f.fresh(row);
  // Keep the two agents complete so only the human slot is eligible for automation.
  for (const [index, key] of [
    [0, f.agent],
    [2, f.second],
  ] as const) {
    const thread = row.value.threads[index];
    f.events.push(
      signed(key, {
        kind: 9,
        content: "Looks good",
        tags: [
          ["h", channel],
          ["t", "buzz.review.status"],
          ["e", thread?.id ?? "", "", "reply"],
          ["r", thread?.request ?? ""],
          ["review", row.artifactId, String(index)],
          ["review-sequence", "1"],
          ["status", "approved"],
        ],
      }),
    );
  }
  const configHead = signed(f.owner, {
    kind: 45010,
    content: JSON.stringify(f.saved.config),
    tags: [
      ["h", channel],
      ["d", f.saved.artifactId],
      ["type", "buzz.review.config"],
    ],
  });
  f.heads.set(f.saved.artifactId, configHead);
  const config = { ...f.saved, revision: configHead.id };
  for (let i = 0; i < 4; i++) {
    f.advance(301000);
    row = await f.fresh(row);
    expect(
      await advanceReview(
        f.own,
        channel,
        row,
        config,
        async () => "Open",
        signal(),
      ),
    ).toBe(i < 3 ? "reminded" : "assigned");
  }
  row = await f.fresh(row);
  expect(row.value.config.lanes[0]?.reviewers).toEqual([
    f.agent.pubkey,
    f.backup.pubkey,
    f.second.pubkey,
  ]);
  expect(submissionLane(row.value, 1)?.humanReviewers).toContain(
    f.backup.pubkey,
  );
});

it("reads persisted transitions and thread messages and retains one repeated admission failure", async () => {
  const f = await fixture();
  await f.submit();
  const limited = f.configure({
    ...f.saved,
    config: { ...f.saved.config, maxPrsPerDay: 1 },
  });
  await expect(f.submit("43", limited)).rejects.toThrow("Daily PR limit");
  await expect(f.submit("43", limited)).rejects.toThrow("Daily PR limit");
  const failed = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    43,
    0,
    signal(),
  );
  expect(failed.entries).toHaveLength(1);
  expect(failed.entries[0]?.detail).toContain("Daily PR limit");
  const log = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
  );
  expect(log.roots).toHaveLength(3);
  expect(
    log.entries.some((entry) => entry.title === "Submission started"),
  ).toBe(true);
  expect(
    (await loadLogMessages(f.own, channel, log.roots, signal())).entries,
  ).toHaveLength(3);
});

it("includes assigned human reviews in their personal collection without exposing unrelated submissions", async () => {
  const f = await fixture();
  const row = await f.submit();
  expect(
    (await loadSubmissions(f.person, [channel], signal())).rows.map(
      (row) => row.artifactId,
    ),
  ).toEqual([row.artifactId]);
  expect(
    (await loadSubmissions(f.session(f.backup), [channel], signal())).rows,
  ).toEqual([]);
});

it("starts a fresh persisted log on resubmission, keeps reminders in it, and excludes earlier thread messages", async () => {
  const f = await fixture();
  const first = await f.submit();
  const oldIds = f.events
    .filter((event) => event.kind === 9)
    .map((event) => event.id);
  f.advance(125);
  const again = await submitReview(
    f.own,
    channel,
    f.saved,
    "42",
    [f.agent.pubkey],
    signal(),
    () => {},
    true,
    undefined,
    () => {},
  );
  expect(again.value.log?.id).not.toBe(first.value.log?.id);
  expect(again.value.threads.map((thread) => thread.id)).toEqual(
    first.value.threads.map((thread) => thread.id),
  );
  const restored = await f.fresh(again);
  expect(restored.value.log).toEqual(again.value.log);
  const log = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
    submissionLogScope(restored.value),
  );
  expect(log.entries.length).toBeGreaterThan(0);
  expect(
    log.entries.every(
      ({ event }) => JSON.parse(event.content).log.id === again.value.log?.id,
    ),
  ).toBe(true);
  const previousThread = first.value.threads[0];
  if (!previousThread?.id || !previousThread.request)
    throw new Error("Expected the original review request");
  const stale = signed(f.agent, {
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    content: "Old request finished late",
    tags: [
      ["h", channel],
      ["e", previousThread.id, "", "reply"],
      ["t", "buzz.review.status"],
      ["r", previousThread.request],
      ["ms", String(Date.now() % 1000)],
    ],
  });
  f.events.push(stale);
  const messages = await loadLogMessages(
    f.own,
    channel,
    log.roots,
    signal(),
    undefined,
    log.scope,
  );
  expect(messages.entries).toHaveLength(3);
  expect(messages.entries.some(({ event }) => oldIds.includes(event.id))).toBe(
    false,
  );
  f.advance(125);
  const reminded = await remindSubmission(
    f.own,
    channel,
    again,
    signal(),
    async () => "Open",
    "",
    submissionLane(again.value, 0)?.assignment,
    "Please recheck",
  );
  expect(reminded.value.log).toEqual(again.value.log);
  const oldLog = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
    submissionLogScope(first.value),
  );
  expect(oldLog.entries.length).toBeGreaterThan(0);
  expect(
    oldLog.entries.every(
      ({ event }) => JSON.parse(event.content).log.id === first.value.log?.id,
    ),
  ).toBe(true);
});

it("starts separate logs for delete/repost and each blocked submission, even for the same failure", async () => {
  const f = await fixture();
  const first = await f.submit();
  await deleteSubmission(f.own, channel, first, signal());
  f.advance(125);
  const next = await f.submit();
  expect(next.value.log?.id).not.toBe(first.value.log?.id);
  const log = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
  );
  expect(log.roots).toEqual(next.value.threads.map((thread) => thread.id));
  expect(log.entries.some(({ title }) => title === "Submission deleted")).toBe(
    false,
  );
  const limited = {
    ...f.saved,
    config: { ...f.saved.config, maxPrsPerDay: 1 },
  };
  f.advance(125);
  await expect(f.submit("43", limited)).rejects.toThrow("Daily PR limit");
  const blocked = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    43,
    0,
    signal(),
  );
  f.advance(125);
  await expect(f.submit("43", limited)).rejects.toThrow("Daily PR limit");
  const blockedAgain = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    43,
    0,
    signal(),
  );
  expect(blockedAgain.scope).not.toEqual(blocked.scope);
  expect(blockedAgain.entries).toHaveLength(1);
  expect(blockedAgain.roots).toEqual([]);
});

it("pins logs across history pages without inventing submission starts", async () => {
  const f = await fixture();
  let row = await f.submit();
  const firstLog = row.value.log;
  for (let i = 0; i < 105; i++) {
    f.advance(1000);
    row = await writeSubmission(
      f.own,
      channel,
      { ...row.value, device: crypto.randomUUID() },
      row,
      signal(),
    );
  }
  const page = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
    submissionLogScope(row.value),
  );
  expect(page.more).toBe(true);
  expect(page.entries).toHaveLength(100);
  expect(page.entries.some(({ title }) => title === "Submission started")).toBe(
    false,
  );
  // Another host starts a new attempt between page reads; the existing reader stays pinned.
  f.advance(1000);
  await submitReview(
    f.own,
    channel,
    f.saved,
    "42",
    [f.agent.pubkey],
    signal(),
    () => {},
    true,
    undefined,
    () => {},
  );
  const older = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    100,
    signal(),
    page.scope,
  );
  expect(older.entries.length).toBeGreaterThan(0);
  expect(
    older.entries.every(
      ({ event }) => JSON.parse(event.content).log.id === firstLog?.id,
    ),
  ).toBe(true);
});

it("keeps a failed new attempt separate when reviewer validation fails before resubmission is saved", async () => {
  const f = await fixture();
  const first = await f.submit();
  f.events.splice(
    f.events.findIndex(
      (event) => event.kind === 0 && event.pubkey === f.agent.pubkey,
    ),
    1,
  );
  f.advance(125);
  await expect(
    submitReview(
      f.own,
      channel,
      f.saved,
      "42",
      [f.agent.pubkey],
      signal(),
      () => {},
      true,
      undefined,
      () => {},
    ),
  ).rejects.toThrow();
  const failed = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
  );
  expect(failed.entries).toHaveLength(1);
  expect(failed.entries[0]?.title).toBe("Submission blocked");
  expect(
    failed.scope && "id" in failed.scope ? failed.scope.id : undefined,
  ).not.toBe(first.value.log?.id);
  expect((await f.fresh(first)).value.log).toEqual(first.value.log);
});

it("resumes uncertain delivery within its persisted log", async () => {
  const f = await fixture();
  f.failMessage();
  await expect(f.submit()).rejects.toThrow();
  const partial = (await loadSubmissions(f.own, channel, signal())).rows[0];
  expect(partial?.value.log).toBeDefined();
  f.advance(125);
  const resumed = await f.submit();
  expect(resumed.value.log).toEqual(partial?.value.log);
  const log = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
    submissionLogScope(resumed.value),
  );
  expect(log.entries.some(({ title }) => title === "Submission blocked")).toBe(
    true,
  );
});

it("does not carry a previous triage thread, decision, or late report into a fresh resubmission", async () => {
  const f = await fixture();
  const first = await f.submit();
  if (!first.value.log) throw new Error("Expected a submission log");
  const triageRoot = signed(f.agent, {
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    content: "Triage root",
    tags: [["h", channel]],
  });
  f.events.push(triageRoot);
  const triageRequest = crypto.randomUUID();
  const triaged = await writeSubmission(
    f.own,
    channel,
    {
      ...first.value,
      version: 4,
      generation: crypto.randomUUID(),
      log: { ...first.value.log, triage: true },
      triage: {
        state: "admitted",
        agent: f.agent.pubkey,
        instructions: "Triage",
        head: "a".repeat(40),
        base: "b".repeat(40),
        reviewers: [f.agent.pubkey],
        decision: "c".repeat(64),
        message: "Previous triage decision",
        thread: { id: triageRoot.id, request: triageRequest, delivered: true },
      },
    },
    first,
    signal(),
  );
  const initialLog = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
    submissionLogScope(triaged.value),
  );
  expect(initialLog.roots).toContain(triageRoot.id);
  f.advance(125);
  const again = await submitReview(
    f.own,
    channel,
    f.saved,
    "42",
    [f.agent.pubkey],
    signal(),
    () => {},
    true,
    undefined,
    () => {},
  );
  const late = signed(f.agent, {
    kind: 9,
    created_at: Math.floor(Date.now() / 1000),
    content: "Previous triage report",
    tags: [
      ["h", channel],
      ["e", triageRoot.id, "", "reply"],
      ["t", "buzz.review.triage"],
      ["r", triageRequest],
      ["ms", String(Date.now() % 1000)],
    ],
  });
  f.events.push(late);
  const log = await loadReviewLog(
    f.own,
    channel,
    f.saved.config.repository,
    42,
    0,
    signal(),
    submissionLogScope(again.value),
  );
  expect(log.roots).not.toContain(triageRoot.id);
  expect(log.scope?.requests).not.toContain(triageRequest);
  expect(
    log.entries.some(({ detail }) =>
      detail.includes("Previous triage decision"),
    ),
  ).toBe(false);
  expect(
    (
      await loadLogMessages(
        f.own,
        channel,
        log.roots,
        signal(),
        undefined,
        log.scope,
      )
    ).entries.some(({ event }) => event.id === late.id),
  ).toBe(false);
});
