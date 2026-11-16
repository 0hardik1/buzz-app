import type { RelayEvent } from "../../../features/relay/events";
import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../../features/agents/agent-config-artifacts";
import { REVIEW_SUBMISSION } from "../../../features/agents/pr-review";
import { loadConfigurations, type SavedReviewConfig } from "../configuration";
import { laneMatches, type PullFacts } from "../routing";
import { advanceReview } from "../automation";
import {
  decodeSubmission,
  loadSubmissions,
  pullRepository,
  pullRequest,
  submitReview,
  type SavedSubmission,
} from "../submissions";
import { eligibleReviewers } from "../submissions";
import { reviewChannel } from "../access";
import type { ReadPull, ReadPullStatus } from "../pull-facts";
import type { ReadAdmission } from "../admission";
import type { ReviewSession } from "../session";

export function discoverPulls(content: string) {
  const result = new Map<
    string,
    { url: string; repository: string; pr: number }
  >();
  // A URL must end at the PR number (optional path/query/fragment is normalized).
  for (const match of content.matchAll(
    /https:\/\/github\.com\/([a-z\d-]+\/[a-z\d_.-]+)\/pull\/([1-9]\d*)(?=$|[\s/?#<>()[\]`.,;!:])/gi,
  )) {
    const url = `https://github.com/${match[1]}/pull/${match[2]}`;
    try {
      const repository = pullRepository(url),
        pr = pullRequest(url, repository);
      result.set(`${repository}:${pr}`, { url, repository, pr });
    } catch {
      /* Non-canonical or unsafe integers are not PR identities. */
    }
  }
  return [...result.values()];
}
export type ReviewWorker = {
  session: ReviewSession;
  channels: readonly string[];
  refresh(channel: string, signal: AbortSignal): Promise<unknown>;
  readPull: ReadPull;
  readStatus: ReadPullStatus;
  readAdmission: ReadAdmission;
  reviewDocumentation: string;
  triageDocumentation: string;
  state: {
    get<T>(key: string): T | undefined;
    set(key: string, value: unknown): void;
  };
  pickup?(message: RelayEvent, signal: AbortSignal): Promise<void>;
  report(event: {
    channel: string;
    pr?: number;
    action: string;
    error?: string;
  }): void;
};

type PollPosition = {
  channel: number;
  positions: Record<
    string,
    { offset: number; after: string; candidate: string }
  >;
  retries: Record<string, { count: number; until: number }>;
};
/** A serial finite tick. The process supervisor owns cadence/backoff and storage. */
export async function reviewTick(
  worker: ReviewWorker,
  signal: AbortSignal,
  now = Math.floor(Date.now() / 1000),
) {
  const { session } = worker;
  const viewer = session.viewer,
    runtime = session.reviewRuntime;
  if (!viewer || !runtime)
    throw new Error(
      "The review worker needs its provisioned identity and durable runtime.",
    );
  const read = session.snapshotRead;
  if (!read) throw new Error("Review reads are unavailable.");
  let failed = false;
  const position = worker.state.get<PollPosition>("poll-position") ?? {
    channel: 0,
    positions: {},
    retries: {},
  };
  const save = () => worker.state.set("poll-position", position);
  for (const [key, retry] of Object.entries(position.retries))
    if (retry.until < now - 3600) delete position.retries[key];
  const startChannel = position.channel % worker.channels.length;
  for (let step = 0; step < worker.channels.length; step++) {
    const at = (startChannel + step) % worker.channels.length;
    const channel = worker.channels[at] ?? "";
    if (!channel) continue;
    position.channel = (at + 1) % worker.channels.length;
    save(); // an interrupted busy channel cannot monopolize the next tick
    if ((position.retries[channel]?.until ?? 0) > now) continue;
    const cursor = position.positions[channel] ?? {
      offset: 0,
      after: "",
      candidate: "",
    };
    position.positions[channel] = cursor;
    try {
      await worker.refresh(channel, signal);
      reviewChannel(session, channel, true);
      const configs = await loadConfigurations(session, channel, signal);
      if (configs.truncated || configs.unreadable)
        throw new Error("Review configuration snapshot is incomplete.");
      if (!configs.rows.length) continue;
      const directory = new Map(
        configs.rows.map((row) => [row.config.repository, row]),
      );
      delete position.retries[channel];
      let processed = 0;
      activePages: for (let offset = cursor.offset; ; offset += 500) {
        const page = await loadSubmissions(session, [channel], signal, {
          offset,
        });
        for (const row of page.rows.sort((a, b) =>
          a.artifactId.localeCompare(b.artifactId),
        )) {
          if (row.artifactId <= cursor.after) continue;
          cursor.after = row.artifactId;
          save();
          const config = directory.get(row.value.config.repository);
          if (!config) continue;
          const job = `${channel}:${row.artifactId}`;
          if ((position.retries[job]?.until ?? 0) > now) continue;
          try {
            await session.outbox?.ready();
            for (const progress of Object.values(row.value.automation ?? {})) {
              const receipt = progress.receipt;
              const local = session.outbox
                ?.snapshot()
                .find((item) => item.event.id === receipt);
              if (!receipt || !local) continue;
              if (!["accepted", "seen"].includes(local.delivery))
                await read(
                  [
                    {
                      kinds: [9],
                      ids: [receipt],
                      "#h": [channel],
                      limit: 1,
                      consistency: "strong",
                    },
                  ],
                  { signal },
                );
              await session.outbox?.acknowledge(receipt);
            }
            if (
              (row.value.triage?.state === "pending" ||
                row.value.threads.some((thread) => !thread.delivered)) &&
              row.value.device === session.reviewRuntime?.device
            ) {
              processed++;
              await submit(config, String(row.value.pr), [], true);
            } else if (due(row, now)) {
              processed++;
              const action = await advanceReview(
                session,
                channel,
                row,
                config,
                worker.readStatus,
                signal,
                now,
              );
              if (action !== "idle")
                worker.report({ channel, pr: row.value.pr, action });
            }
            delete position.retries[job];
          } catch (error) {
            recordError(channel, error, row.value.pr, job);
          }
          if (processed >= 8) break activePages;
        }
        cursor.after = "";
        cursor.offset = offset + 500;
        save();
        if (!page.hasMore) {
          cursor.offset = 0;
          save();
          if (offset >= 10_000 && page.warning)
            throw new Error(
              "Submission history limit reached; older rows require attention.",
            );
          break;
        }
      }
      const candidates = new Map<
        string,
        ReturnType<typeof discoverPulls>[number] & { messages: RelayEvent[] }
      >();
      let before: { until: number; before_id: string } | undefined;
      for (let page = 0; page < 4; page++) {
        const messages = await read(
          [
            {
              kinds: [9],
              "#h": [channel],
              since: now - 3600,
              until: now,
              limit: 500,
              ...before,
            },
          ],
          { signal },
        );
        for (const message of messages) {
          if (
            message.kind !== 9 ||
            message.created_at < now - 3600 ||
            message.created_at > now ||
            !message.tags.some(
              ([name, value]) => name === "h" && value === channel,
            ) ||
            message.tags.some(
              ([name, value]) =>
                name === "t" && value?.startsWith("buzz.review."),
            )
          )
            continue;
          for (const pull of discoverPulls(message.content))
            if (directory.has(pull.repository)) {
              const key = `${pull.repository}:${pull.pr}`;
              const candidate = candidates.get(key) ?? {
                ...pull,
                messages: [],
              };
              candidate.messages.push(message);
              candidates.set(key, candidate);
            }
        }
        if (messages.length < 500) break;
        if (page === 3)
          throw new Error(
            "Channel history exceeds 2,000 messages per hour; discovery was not applied.",
          );
        const oldest = [...messages].sort(
          (a, b) => a.created_at - b.created_at || b.id.localeCompare(a.id),
        )[0];
        if (!oldest) throw new Error("Missing channel history cursor.");
        before = { until: oldest.created_at, before_id: oldest.id };
      }
      // Existing records, including tombstones and other submitters, are never
      // redispatched by discovery. Recovery is separately scoped to this signer/device.
      const discovered = [...candidates.entries()].sort(([a], [b]) =>
        a.localeCompare(b),
      );
      const ordered = [
        ...discovered.filter(([key]) => key > cursor.candidate),
        ...discovered.filter(([key]) => key <= cursor.candidate),
      ];
      for (const [candidate, pull] of ordered.slice(0, 8)) {
        cursor.candidate = candidate;
        save();
        const job = `${channel}:discover:${candidate}`;
        if ((position.retries[job]?.until ?? 0) > now) continue;
        try {
          const artifact = await uuidv5(
            channel,
            `${REVIEW_SUBMISSION}:${pull.repository}:${pull.pr}`,
          );
          const existing = await read(
            [
              {
                kinds: [ARTIFACT_KIND],
                "#h": [channel],
                "#d": [artifact],
                artifact: "current",
                limit: 1,
              },
            ],
            { signal },
          );
          if (existing[0]) {
            const row = await decodeSubmission(existing[0], channel);
            if (!row.value.deleted && row.value.submitter === viewer)
              await pickup(row);
            continue;
          }
          const status = await worker.readStatus(
            pull.repository,
            pull.pr,
            signal,
          );
          if (status !== "Open" && status !== "Draft") continue;
          await pickup();
          const config = directory.get(pull.repository);
          if (!config) continue;
          const facts = await worker.readPull(pull.repository, pull.pr, signal);
          const reviewers: string[] = [];
          for (const lane of config.config.lanes) {
            if (!laneMatches(lane.routing, facts)) {
              reviewers.push("");
              continue;
            }
            if (config.config.admission?.triage) {
              reviewers.push(lane.reviewers[0] ?? "");
              continue;
            }
            let chosen: string | undefined;
            for (const key of lane.reviewers) {
              try {
                await eligibleReviewers(
                  session,
                  channel,
                  {
                    version: 2,
                    pr: pull.pr,
                    config: {
                      ...config.config,
                      lanes: [{ ...lane, reviewers: [key] }],
                    },
                    configRevision: config.revision,
                    submitter: viewer,
                    device: runtime.device,
                    threads: [],
                  },
                  signal,
                );
                chosen = key;
                break;
              } catch {
                signal.throwIfAborted();
              }
            }
            if (!chosen)
              throw new Error(`No eligible reviewer for ${lane.name}.`);
            reviewers.push(chosen);
          }
          // Recheck config after external reads; mutation-time membership is shared.
          const current = await loadConfigurations(session, channel, signal);
          if (!current.rows.some((row) => row.revision === config.revision))
            continue;
          await submit(config, String(pull.pr), reviewers, false, facts);
          delete position.retries[job];
          worker.report({ channel, pr: pull.pr, action: "submitted" });
        } catch (error) {
          recordError(channel, error, pull.pr, job);
        }
        async function pickup(record?: SavedSubmission) {
          if (!worker.pickup) return;
          const roots = new Set(
            [
              ...(record?.value.threads.map((thread) => thread.id) ?? []),
              record?.value.triage?.thread.id,
            ].filter(Boolean),
          );
          for (const message of pull.messages) {
            if (
              roots.has(message.id) ||
              message.tags.some(
                ([name, value]) => name === "e" && roots.has(value),
              )
            )
              continue;
            try {
              await worker.pickup(message, signal);
            } catch (error) {
              signal.throwIfAborted();
              worker.report({
                channel,
                pr: pull.pr,
                action: "reaction-error",
                error:
                  error instanceof Error ? error.message : "Reaction failed.",
              });
            }
          }
        }
      }
      async function submit(
        config: SavedReviewConfig,
        pr: string,
        reviewers: string[],
        resume = false,
        facts?: PullFacts,
      ) {
        return submitReview(
          session,
          channel,
          config,
          pr,
          reviewers,
          signal,
          () => {},
          resume,
          facts ??
            (() =>
              worker.readPull(config.config.repository, Number(pr), signal)),
          undefined,
          worker.reviewDocumentation,
          {
            read: worker.readAdmission,
            documentation: worker.triageDocumentation,
            ...(resume ? { existingOnly: true } : {}),
          },
        );
      }
    } catch (error) {
      failed = true;
      recordError(channel, error, undefined, channel);
    }
  }
  signal.throwIfAborted();
  save();
  return !failed;
  function recordError(
    channel: string,
    error: unknown,
    pr: number | undefined,
    job: string,
  ) {
    signal.throwIfAborted();
    const count = Math.min(4, (position.retries[job]?.count ?? 0) + 1);
    // A blocked PR backs off independently; other channels retain their cadence.
    if (Object.keys(position.retries).length < 10000 || position.retries[job])
      position.retries[job] = {
        count,
        until: now + Math.min(300, 30 * 2 ** count),
      };
    save();
    worker.report({
      channel,
      ...(pr === undefined ? {} : { pr }),
      action: "error",
      error: error instanceof Error ? error.message : "Review polling failed.",
    });
  }
}
function due(row: SavedSubmission, now: number) {
  return row.value.threads.some((thread, index) => {
    if (!["need_review", "reviewing"].includes(row.reviewStates?.[index] ?? ""))
      return false;
    const lane =
      row.value.config.lanes[index - (row.value.version === 1 ? 1 : 0)];
    const progress = lane && row.value.automation?.[lane.id];
    const latest = Math.max(
      thread.requestedAt ?? row.updatedAt ?? row.value.submittedAt ?? now,
      progress && progress.request === thread.request
        ? progress.lastActionAt
        : 0,
      ...(row.reviewReports ?? [])
        .filter((report) =>
          report.tags.some(
            ([name, value]) => name === "r" && value === thread.request,
          ),
        )
        .map((report) => report.created_at),
    );
    return !!progress?.pending || now - latest >= 300;
  });
}
