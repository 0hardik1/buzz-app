import { afterEach, expect, it, vi } from "vitest";
import { createServer } from "node:http";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bytesToHex } from "nostr-tools/utils";
import { keypair, signed } from "../../../features/relay/testing";
import {
  eventDto,
  type ReadFilter,
  type RelayEvent,
} from "../../../features/relay/events";
import { uuidv5 } from "../../../features/agents/agent-config-artifacts";
import { reviewAgentProfile } from "../testing";
import {
  decodeSubmission,
  deleteSubmission,
  loadSubmissions,
} from "../submissions";
import { reviewTransport } from "./transport";
import { reviewStorage } from "./storage";
import { serverReviewSession } from "./session";
import type { ReviewConfig } from "../configuration";
import { discoverPulls, reviewTick, type ReviewWorker } from "./worker";

function must<T>(value: T | undefined | null): T {
  if (value === undefined || value === null)
    throw new Error("Missing test fixture value");
  return value;
}
const channel = "11111111-1111-4111-8111-111111111111";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => {
  for (const run of cleanup.splice(0).reverse()) await run();
  vi.restoreAllMocks();
});
async function fixture() {
  let now = 1_800_000_000;
  vi.spyOn(Date, "now").mockImplementation(() => now * 1000);
  const owner = keypair(),
    relay = keypair(),
    first = keypair(),
    second = keypair();
  const events = new Map<string, RelayEvent>(),
    heads = new Map<string, RelayEvent>();
  const published: RelayEvent[] = [];
  let loseReply = false;
  let loseReaction = false;
  let revokeOnIntent = false;
  const tags = (event: RelayEvent, name: string) =>
    event.tags.find(([key]) => key === name)?.[1];
  function add(event: RelayEvent) {
    events.set(event.id, event);
    if (event.kind === 45010) heads.set(must(tags(event, "d")), event);
  }
  function metadata(
    members = [owner.pubkey, first.pubkey, second.pubkey],
    visibility = "private",
  ) {
    for (const [id, event] of events)
      if ([39000, 39001, 39002].includes(event.kind)) events.delete(id);
    add(
      signed(relay, {
        kind: 39000,
        created_at: now,
        content: "",
        tags: [
          ["d", channel],
          ["name", "Reviews"],
          ["t", "stream"],
          [visibility],
        ],
      }),
    );
    add(
      signed(relay, {
        kind: 39001,
        created_at: now,
        content: "",
        tags: [
          ["d", channel],
          ["p", owner.pubkey, "owner"],
        ],
      }),
    );
    add(
      signed(relay, {
        kind: 39002,
        created_at: now,
        content: "",
        tags: [
          ["d", channel],
          ...members.map((key) => [
            "p",
            key,
            "",
            key === owner.pubkey ? "owner" : "member",
          ]),
        ],
      }),
    );
  }
  metadata();
  add(reviewAgentProfile(owner, first));
  add(reviewAgentProfile(owner, second));
  const config: ReviewConfig = {
    version: 1,
    repository: "example-org/project",
    reminderMinutes: 15,
    lanes: [
      {
        id: "backend",
        name: "Backend",
        instructions: "Review the change.",
        reviewers: [first.pubkey, second.pubkey],
      },
    ],
  };
  const configId = await uuidv5(
    channel,
    "buzz.review.config:example-org/project",
  );
  function saveConfig(value = config) {
    add(
      signed(owner, {
        kind: 45010,
        created_at: now,
        content: JSON.stringify(value),
        tags: [
          ["h", channel],
          ["d", configId],
          ["type", "buzz.review.config"],
        ],
      }),
    );
  }
  saveConfig();
  function message(content: string, created_at = now) {
    add(
      signed(owner, { kind: 9, created_at, content, tags: [["h", channel]] }),
    );
  }
  message("Please review https://github.com/example-org/project/pull/42");
  const server = createServer(async (req, res) => {
    try {
      if (req.method === "GET") {
        res.end(JSON.stringify({ self: relay.pubkey }));
        return;
      }
      const auth = eventDto(
        JSON.parse(
          Buffer.from(
            must(req.headers.authorization).slice(6),
            "base64",
          ).toString(),
        ),
      );
      expect(auth.pubkey).toBe(owner.pubkey);
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.from(chunk));
      const body = JSON.parse(Buffer.concat(chunks).toString());
      if (req.url === "/query") {
        const found = new Map<string, RelayEvent>();
        for (const f of body as ReadFilter[]) {
          const all = f.artifact ? [...heads.values()] : [...events.values()];
          const rows = all
            .filter(
              (e) =>
                (!f.ids || f.ids.includes(e.id)) &&
                (!f.kinds || f.kinds.includes(e.kind)) &&
                (!f.authors || f.authors.includes(e.pubkey)) &&
                (f.since === undefined || e.created_at >= f.since) &&
                (f.until === undefined || e.created_at <= f.until) &&
                Object.entries(f).every(
                  ([key, values]) =>
                    !key.startsWith("#") ||
                    (values as string[]).some((value) =>
                      e.tags.some(
                        (tag) => tag[0] === key.slice(1) && tag[1] === value,
                      ),
                    ),
                ),
            )
            .sort(
              (a, b) => b.created_at - a.created_at || a.id.localeCompare(b.id),
            );
          for (const e of rows.slice(f.offset ?? 0, (f.offset ?? 0) + f.limit))
            found.set(e.id, e);
        }
        res.end(JSON.stringify([...found.values()]));
      } else {
        const event = eventDto(body);
        published.push(event);
        if (events.has(event.id)) {
          res.end(JSON.stringify({ message: "duplicate" }));
          return;
        }
        if (
          event.kind === 45010 &&
          tags(event, "prev") !== heads.get(must(tags(event, "d")))?.id
        ) {
          res.end(
            JSON.stringify({ accepted: false, message: "stale revision" }),
          );
          return;
        }
        add(event);
        if (
          revokeOnIntent &&
          event.kind === 45010 &&
          JSON.parse(event.content).threads?.some(
            (thread: { started?: boolean; id?: string }) =>
              thread.started && !thread.id,
          )
        ) {
          revokeOnIntent = false;
          metadata([owner.pubkey, second.pubkey]);
        }
        if (event.kind === 7 && loseReaction) {
          loseReaction = false;
          res.destroy();
          return;
        }
        if (event.kind === 9 && loseReply) {
          loseReply = false;
          res.destroy();
          return;
        }
        res.end(JSON.stringify({ accepted: true }));
      }
    } catch {
      res.statusCode = 500;
      res.end("{}");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("No HTTP port");
  const directory = await mkdtemp(join(tmpdir(), "review-worker-test-"));
  const lifetime = new AbortController();
  const transport = reviewTransport({
    relay: `http://127.0.0.1:${address.port}`,
    key: bytesToHex(owner.secret),
    signal: lifetime.signal,
  });
  let storage = reviewStorage(directory, `${transport.base}:${owner.pubkey}`);
  let host = await serverReviewSession(
    transport,
    storage,
    [channel],
    lifetime.signal,
  );
  let status: "Open" | "Closed" = "Open";
  const report = vi.fn();
  const worker = (): ReviewWorker => ({
    state: storage,
    session: host.session,
    refresh: host.refresh,
    pickup: host.pickup,
    channels: [channel],
    readStatus: async () => status,
    readPull: async (_repository, pr) => ({
      repository: config.repository,
      pr,
      title: "Fix",
      paths: ["file.ts"],
      labels: [],
      head: "a".repeat(40),
      base: "b".repeat(40),
      changedFiles: 1,
    }),
    readAdmission: async () => ({
      head: "a".repeat(40),
      open: true,
      draft: false,
      ci: "pass",
      mergeable: true,
    }),
    reviewDocumentation: "Report your review status.",
    triageDocumentation: "Report triage.",
    report,
  });
  cleanup.push(async () => {
    lifetime.abort();
    host.close();
    await storage.deliveryClosed;
    storage.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  });
  async function row() {
    const head = [...heads.values()].find(
      (event) => tags(event, "type") === "buzz.review.submission",
    );
    return head ? decodeSubmission(head, channel) : undefined;
  }
  function review(
    value: Awaited<ReturnType<typeof decodeSubmission>>,
    reviewer = first,
    outcome = "reviewing",
    sequence = 1,
  ) {
    const event = signed(reviewer, {
      kind: 9,
      created_at: now,
      content: "Progress",
      tags: [
        ["h", channel],
        ["t", "buzz.review.status"],
        ["r", must(must(value.value.threads[0]).request)],
        ["review", value.artifactId, "0"],
        ["status", outcome],
        ["review-sequence", String(sequence)],
        ["e", must(must(value.value.threads[0]).id), "", "reply"],
      ],
    });
    add(event);
    return event;
  }
  return {
    owner,
    first,
    second,
    config,
    events,
    heads,
    published,
    report,
    transport,
    worker,
    directory,
    metadata,
    message,
    saveConfig,
    row,
    review,
    advance(seconds: number) {
      now += seconds;
    },
    closePr() {
      status = "Closed";
    },
    seedPickupIntent(message: RelayEvent) {
      const event = signed(owner, {
        kind: 7,
        created_at: now,
        content: "👀",
        tags: [
          ["h", channel],
          ["e", message.id],
          ["p", owner.pubkey],
        ],
      });
      storage.set("outbox", [
        {
          event,
          signed: event,
          delivery: "sending",
          guarded: true,
          recovery: { key: `review-pickup:${message.id}`, value: message.id },
        },
      ]);
      return event;
    },
    loseReaction() {
      loseReaction = true;
    },
    pickup: (message: RelayEvent) => host.pickup(message, lifetime.signal),
    loseReply() {
      loseReply = true;
    },
    tick: () => reviewTick(worker(), lifetime.signal, now),
    failAcknowledgement() {
      const save = storage.outbox.save;
      storage.outbox.save = (operations, options) => {
        if (
          operations.some(
            (item) =>
              item.acknowledged &&
              item.recovery?.key.startsWith("review-auto:"),
          )
        ) {
          storage.outbox.save = save;
          throw new Error("Injected crash before durable acknowledgment");
        }
        return save(operations, options);
      };
    },
    pendingReceipts: () =>
      host.session.outbox
        ?.snapshot()
        .filter((item) => item.recovery?.key.startsWith("review-auto:")),
    revokeOnIntent() {
      revokeOnIntent = true;
    },
    async remove() {
      await deleteSubmission(
        host.session,
        channel,
        must(await row()),
        lifetime.signal,
      );
    },
    async reply(text: string) {
      const value = must(await row());
      add(
        signed(first, {
          kind: 9,
          created_at: now,
          content: text,
          tags: [
            ["h", channel],
            ["e", must(must(value.value.threads[0]).id), "", "reply"],
          ],
        }),
      );
    },
    async states() {
      return (await loadSubmissions(host.session, channel, lifetime.signal))
        .rows[0]?.reviewStates;
    },
    async restart() {
      host.close();
      await storage.deliveryClosed;
      storage.close();
      storage = reviewStorage(directory, `${transport.base}:${owner.pubkey}`);
      host = await serverReviewSession(
        transport,
        storage,
        [channel],
        lifetime.signal,
      );
    },
  };
}
it("discovers a PR with no browser, deduplicates repeated scans, nudges three times and rotates after restart", async () => {
  const h = await fixture();
  {
    const ok = await h.tick();
    expect(ok, JSON.stringify(h.report.mock.calls)).toBe(true);
  }
  const initial = must(await h.row());
  expect(initial.value.threads[0]?.delivered).toBe(true);
  const root = must(initial.value.threads[0]).id,
    token = must(initial.value.threads[0]).request;
  h.review(initial);
  expect(await h.states()).toEqual(["reviewing"]);
  await h.tick();
  expect(h.published.filter((e) => e.kind === 9)).toHaveLength(1);
  for (let count = 1; count <= 3; count++) {
    h.advance(299);
    await h.tick();
    expect(must(await h.row()).value.automation?.backend?.reminders ?? 0).toBe(
      count - 1,
    );
    h.advance(1);
    expect(await h.tick()).toBe(true);
    const current = must(await h.row());
    expect(current.value.automation?.backend?.reminders).toBe(count);
    expect(current.value.threads[0]?.request).toBe(token);
    expect(await h.states()).toEqual(["reviewing"]);
    await h.restart();
    await h.tick();
    expect(h.published.filter((e) => e.kind === 9)).toHaveLength(1 + count);
  }
  h.advance(300);
  expect(await h.tick()).toBe(true);
  const rotated = must(await h.row());
  expect(rotated.value.config.lanes[0]?.reviewers).toEqual([h.second.pubkey]);
  expect(rotated.value.threads[0]?.id).toBe(root);
  expect(rotated.value.threads[0]?.request).not.toBe(token);
  expect(await h.states()).toEqual(["need_review"]);
  h.review(initial, h.first, "lgtm_not_approved", 2);
  expect(await h.states()).toEqual(["need_review"]);
  h.advance(300);
  await h.tick();
  expect(h.report).toHaveBeenCalledWith({
    channel,
    pr: 42,
    action: "exhausted",
  });
  expect(must(await h.row()).value.config.lanes[0]?.reviewers).toEqual([
    h.second.pubkey,
  ]);
});
it("rotates unaccepted work at five minutes and stops after a final outcome", async () => {
  const h = await fixture();
  await h.tick();
  h.advance(299);
  await h.tick();
  expect(must(await h.row()).value.config.lanes[0]?.reviewers).toEqual([
    h.first.pubkey,
  ]);
  h.advance(1);
  await h.tick();
  const next = must(await h.row());
  expect(next.value.config.lanes[0]?.reviewers).toEqual([h.second.pubkey]);
  h.review(next, h.second);
  h.review(next, h.second, "request_changes", 2);
  const count = h.published.length;
  h.advance(3600);
  await h.tick();
  expect(h.published).toHaveLength(count);
});
it("retries identical signed bytes after an uncertain delivery and process restart", async () => {
  const h = await fixture();
  h.loseReply();
  // Recovery in the same tick may already settle it; either path must preserve ID.
  await h.tick();
  await h.restart();
  await h.tick();
  const sent = h.published.filter((event) => event.kind === 9);
  expect(sent.length).toBeGreaterThanOrEqual(2);
  expect(new Set(sent.map((event) => event.id)).size).toBe(1);
  expect(must(await h.row()).value.threads[0]?.delivered).toBe(true);
});
it("does not discover unmatched/old links or act on closed PRs", async () => {
  const h = await fixture();
  h.closePr();
  await h.tick();
  expect(await h.row()).toBeUndefined();
  h.message("https://github.com/other-org/project/pull/99");
  h.advance(3601);
  await h.tick();
  expect(await h.row()).toBeUndefined();
  expect(h.published).toHaveLength(0);
});
it("fails closed after roster revocation or public visibility", async () => {
  const h = await fixture();
  await h.tick();
  const count = h.published.length;
  h.advance(300);
  h.metadata([h.first.pubkey, h.second.pubkey]);
  expect(await h.tick()).toBe(false);
  expect(h.published).toHaveLength(count);
  h.advance(60);
  h.metadata(undefined, "public");
  expect(await h.tick()).toBe(false);
  expect(h.published).toHaveLength(count);
});
it("refuses concurrent ownership and storage from another identity", async () => {
  const h = await fixture();
  expect(() =>
    reviewStorage(h.directory, `${h.transport.base}:${h.owner.pubkey}`),
  ).toThrow("Another review worker");
});
it("recognizes canonical PR links and rejects spoofed hosts and unsafe numbers", () => {
  expect(
    discoverPulls(
      "[PR](https://github.com/Example-Org/project/pull/42/files) https://github.com/example-org/project/pull/42#review https://github.com.evil.test/a/b/pull/1 https://github.com/a/b/pull/9007199254740993",
    ),
  ).toEqual([
    {
      url: "https://github.com/example-org/project/pull/42",
      repository: "example-org/project",
      pr: 42,
    },
  ]);
});

it("does not recreate a deleted submission while its source message is still recent", async () => {
  const h = await fixture();
  await h.tick();
  await h.remove();
  const count = h.published.length;
  await h.tick();
  expect(must(await h.row()).value.deleted).toBe(true);
  expect(h.published).toHaveLength(count);
});
it("counts authenticated reviewer progress replies as activity, preserving acceptance", async () => {
  const h = await fixture();
  await h.tick();
  h.review(must(await h.row()));
  h.advance(300);
  await h.tick();
  expect(must(await h.row()).value.automation?.backend?.reminders).toBe(1);
  h.advance(299);
  await h.reply("Still testing; found a race to investigate.");
  h.advance(1);
  await h.tick();
  expect(h.published.filter((event) => event.kind === 9)).toHaveLength(2);
  h.advance(299);
  await h.tick();
  expect(must(await h.row()).value.automation?.backend?.reminders).toBe(1);
  expect(h.published.filter((event) => event.kind === 9)).toHaveLength(3);
  expect(await h.states()).toEqual(["reviewing"]);
});
it("gives a recovered reminder a full response interval after delayed delivery", async () => {
  const h = await fixture();
  await h.tick();
  h.review(must(await h.row()));
  h.advance(300);
  h.loseReply();
  await h.tick();
  expect(must(await h.row()).value.automation?.backend?.pending).toBeDefined();
  await h.restart();
  h.advance(600);
  await h.tick();
  const recovered = must(await h.row());
  expect(recovered.value.automation?.backend?.pending).toBeUndefined();
  expect(recovered.value.automation?.backend?.reminders).toBe(1);
  const count = h.published.length;
  await h.tick();
  expect(h.published).toHaveLength(count);
  h.advance(299);
  await h.tick();
  expect(h.published).toHaveLength(count);
  h.advance(1);
  await h.tick();
  expect(must(await h.row()).value.automation?.backend?.reminders).toBe(2);
});
it("refreshes reviewer membership after artifact intent and before actual message publication", async () => {
  const h = await fixture();
  h.revokeOnIntent();
  await h.tick();
  expect(h.published.filter((event) => event.kind === 9)).toHaveLength(0);
  expect(must(await h.row()).value.threads[0]?.delivered).toBeUndefined();
});
it("routes past an unavailable reviewer in an unmatched lane", async () => {
  const h = await fixture();
  h.saveConfig({
    ...h.config,
    lanes: [
      ...h.config.lanes,
      {
        id: "other",
        name: "Other",
        instructions: "Only docs",
        reviewers: [keypair().pubkey],
        routing: {
          mode: "all",
          rules: [
            {
              id: "docs",
              field: "title",
              operator: "contains",
              value: "documentation",
            },
          ],
        },
      },
    ],
  });
  await h.tick();
  expect(must(await h.row()).value.config.lanes.map((lane) => lane.id)).toEqual(
    ["backend"],
  );
});
it("continues later lanes after the first lane exhausts its reviewer pool", async () => {
  const h = await fixture();
  h.saveConfig({
    ...h.config,
    lanes: [
      { ...must(h.config.lanes[0]), reviewers: [h.first.pubkey] },
      { ...must(h.config.lanes[0]), id: "second", name: "Second" },
    ],
  });
  await h.tick();
  h.advance(300);
  await h.tick();
  expect(
    must(await h.row()).value.config.lanes.map((lane) => lane.reviewers),
  ).toEqual([[h.first.pubkey], [h.second.pubkey]]);
});

it("reconciles a completed receipt after a crash before acknowledgment without resending", async () => {
  const h = await fixture();
  await h.tick();
  h.review(must(await h.row()));
  h.advance(300);
  h.failAcknowledgement();
  await h.tick();
  const row = must(await h.row());
  expect(row.value.automation?.backend?.pending).toBeUndefined();
  expect(row.value.automation?.backend?.receipt).toBeDefined();
  const count = h.published.length;
  await h.restart();
  h.advance(60);
  await h.tick();
  expect(h.published).toHaveLength(count);
  expect(h.pendingReceipts()).toEqual([]);
});

it("continues with the next channel after interruption using a persisted checkpoint", async () => {
  const h = await fixture(),
    interrupted = new AbortController();
  const secondChannel = "22222222-2222-4222-8222-222222222222";
  const channels = [channel, secondChannel];
  await expect(
    reviewTick(
      {
        ...h.worker(),
        channels,
        refresh: async () => {
          interrupted.abort();
          interrupted.signal.throwIfAborted();
        },
      },
      interrupted.signal,
    ),
  ).rejects.toThrow();
  await h.restart();
  const visited: string[] = [];
  await reviewTick(
    {
      ...h.worker(),
      channels,
      refresh: async (id, signal) => {
        visited.push(id);
        return h.worker().refresh(id, signal);
      },
    },
    new AbortController().signal,
  );
  expect(visited).toEqual([secondChannel, channel]);
});
it("backs off a rejected PR without delaying another candidate", async () => {
  const h = await fixture();
  h.saveConfig({
    ...h.config,
    admission: {
      ready: true,
      ci: false,
      conflicts: false,
      triage: false,
      agent: "",
      instructions: "",
    },
  });
  h.message("https://github.com/example-org/project/pull/43");
  const worker = {
    ...h.worker(),
    readAdmission: async (_repository: string, pr: number) => ({
      head: "a".repeat(40),
      open: true,
      draft: pr === 42,
      ci: "pass" as const,
      mergeable: true,
    }),
  };
  expect(await reviewTick(worker, new AbortController().signal)).toBe(true);
  expect(must(await h.row()).value.pr).toBe(43);
  expect(
    h.report.mock.calls.some(
      ([event]) => event.pr === 42 && event.action === "error",
    ),
  ).toBe(true);
  expect(
    h.report.mock.calls.some(
      ([event]) => event.pr === 43 && event.action === "submitted",
    ),
  ).toBe(true);
});

it("reacts to original configured PR messages once across repeated scans and restarts", async () => {
  const h = await fixture();
  h.message("Another link https://github.com/example-org/project/pull/42");
  h.message("Unconfigured https://github.com/elsewhere/project/pull/42");
  await h.tick();
  const originals = [...h.events.values()].filter(
    (e) =>
      e.kind === 9 &&
      e.content.includes("https://github.com/example-org/project/pull/42") &&
      !e.tags.some((t) => t[0] === "subject"),
  );
  const reactions = h.published.filter((e) => e.kind === 7);
  expect(reactions).toHaveLength(2);
  expect(
    reactions.every(
      (e) =>
        e.content === "👀" &&
        e.tags.some((t) => t[0] === "p" && t[1] === h.owner.pubkey),
    ),
  ).toBe(true);
  expect(
    reactions.map((e) => e.tags.find((t) => t[0] === "e")?.[1]).sort(),
  ).toEqual(originals.map((e) => e.id).sort());
  await h.restart();
  h.advance(31);
  await h.tick();
  expect(h.published.filter((e) => e.kind === 7)).toHaveLength(2);
  expect(h.published.filter((e) => e.kind === 9)).toHaveLength(1);
});
it("retries an uncertain pickup reaction with the same signed event without blocking submission", async () => {
  const h = await fixture();
  h.loseReaction();
  await h.tick();
  expect(must(await h.row()).value.threads[0]?.delivered).toBe(true);
  const first = must(h.published.find((e) => e.kind === 7));
  await h.restart();
  h.advance(31);
  await h.tick();
  expect(
    h.published.filter((e) => e.kind === 7).every((e) => e.id === first.id),
  ).toBe(true);
  expect([...h.events.values()].filter((e) => e.kind === 7)).toHaveLength(1);
});
it("refuses pickup reactions after membership loss or for a target outside the channel", async () => {
  const h = await fixture();
  const original = must([...h.events.values()].find((e) => e.kind === 9));
  await expect(
    h.pickup({ ...original, tags: [["h", "other"]] }),
  ).rejects.toThrow();
  h.metadata([h.first.pubkey, h.second.pubkey]);
  await expect(h.pickup(original)).rejects.toThrow();
  expect(h.published.filter((e) => e.kind === 7)).toHaveLength(0);
});

it("publishes a pickup intent left sending by a crashed process", async () => {
  const h = await fixture();
  const original = must([...h.events.values()].find((e) => e.kind === 9));
  const pending = h.seedPickupIntent(original);
  await h.restart();
  await h.tick();
  expect(h.published.filter((e) => e.kind === 7).map((e) => e.id)).toEqual([
    pending.id,
  ]);
  await h.restart();
  await h.tick();
  expect(h.published.filter((e) => e.kind === 7)).toHaveLength(1);
});
