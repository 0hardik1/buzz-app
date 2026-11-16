import type { ReviewSession } from "./session";
import { reviewDevice, reviewLocks } from "./session";
import { confirmReviewChannel } from "./access";
import { loadConfigurations, type SavedReviewConfig } from "./configuration";
import { REVIEW_WAIT_SECONDS, type AutomationLane } from "./automation-state";
import {
  delivered,
  eligibleReviewers,
  loadSubmissions,
  submissionLane,
  threadMessage,
  writeSubmission,
  type SavedSubmission,
} from "./submissions";
import type { ReadPullStatus } from "./pull-facts";
import { latestReport } from "../../features/agents/pr-review";

/** Five-minute inactivity intervals; three nudges, then a full response interval.
 * Rotation never reuses a reviewer in this submission, fencing old running turns. */
export async function advanceReview(
  session: ReviewSession,
  channel: string,
  previous: SavedSubmission,
  configured: SavedReviewConfig,
  readStatus: ReadPullStatus,
  signal: AbortSignal,
  now = Math.floor(Date.now() / 1000),
): Promise<"idle" | "reminded" | "assigned" | "exhausted"> {
  return reviewLocks(session).request(
    `buzz.review.submit:${session.scope}`,
    { signal },
    async () => {
      await confirmReviewChannel(session, channel, signal);
      const { rows } = await loadSubmissions(session, channel, signal, {
        artifact: previous.artifactId,
      });
      let record = rows[0];
      const outbox = session.outbox;
      if (
        !record ||
        record.revision !== previous.revision ||
        record.value.submitter !== session.viewer ||
        record.value.deleted ||
        record.value.notifying ||
        (record.value.triage && record.value.triage.state !== "admitted") ||
        !record.value.threads.every((thread) => thread.delivered) ||
        !outbox
      )
        return "idle";
      const configs = await loadConfigurations(session, channel, signal);
      if (!configs.rows.some((row) => row.revision === configured.revision))
        return "idle";
      const status = await readStatus(
        record.value.config.repository,
        record.value.pr,
        signal,
      );
      if (status !== "Open" && status !== "Draft") return "idle";
      await outbox.ready();
      let exhausted = false;
      for (const [index, thread] of record.value.threads.entries()) {
        const lane = submissionLane(record.value, index);
        if (!lane || !thread.id || !thread.request) continue;
        const state = record.reviewStates?.[index];
        if (state !== "need_review" && state !== "reviewing") continue;
        const human =
          lane.humanReviewers?.includes(lane.reviewers[0] ?? "") === true;
        const assignment = lane.assignment;
        const old = record.value.automation?.[assignment];
        const reviewer = lane.reviewers[0];
        if (!reviewer) throw new Error("Review lane has no assigned reviewer.");
        const report = latestReport(record.reviewReports ?? [], {
          channel,
          artifact: record.artifactId,
          root: thread.id,
          request: thread.request,
          reviewer,
          autoApprove: lane.autoApprove === true || human,
          index,
        });
        let progress: AutomationLane =
          old?.request === thread.request
            ? { ...old }
            : {
                request: thread.request,
                tried: [...new Set([...(old?.tried ?? []), reviewer])],
                reminders: 0,
                lastActionAt:
                  thread.requestedAt ??
                  record.updatedAt ??
                  record.value.submittedAt ??
                  now,
              };
        let activity = report;
        if (state === "reviewing" && report && session.snapshotRead) {
          const replies = await session.snapshotRead(
            [
              {
                kinds: [9],
                authors: [reviewer],
                "#h": [channel],
                "#e": [thread.id],
                since: report.created_at,
                limit: 1,
                consistency: "strong",
              },
            ],
            { signal },
          );
          const latest = replies[0];
          if (
            latest &&
            latest.kind === 9 &&
            latest.pubkey === reviewer &&
            latest.created_at <= now &&
            latest.created_at >= report.created_at &&
            latest.tags.some(
              ([name, id, , marker]) =>
                name === "e" && id === thread.id && marker === "reply",
            )
          )
            activity = latest;
        }
        // A newly accepted report starts its own inactivity period. A reminder is
        // not progress; only an authenticated reviewer report resets the counter.
        if (!progress.pending && activity && progress.report !== activity.id) {
          progress = {
            ...progress,
            report: activity.id,
            reminders: 0,
            lastActionAt: activity.created_at,
          };
        }
        if (
          !progress.pending &&
          now - progress.lastActionAt < REVIEW_WAIT_SECONDS
        )
          continue;
        let value = record.value;
        if (!progress.pending) {
          const kind =
            state === "reviewing" && progress.reminders < 3
              ? "remind"
              : "assign";
          if (kind === "assign") {
            const pool =
              configured.config.lanes
                .find((item) => item.id === lane.id)
                ?.reviewers.filter((key) => {
                  const poolLane = configured.config.lanes.find(
                    (item) => item.id === lane.id,
                  );
                  return !!poolLane?.humanReviewers?.includes(key) === human;
                }) ?? [];
            let replacement: string | undefined;
            for (const key of pool.filter(
              (key) =>
                !value.config.lanes
                  .find((item) => item.id === lane.id)
                  ?.reviewers.includes(key) &&
                !Object.values(value.automation ?? {}).some((item) =>
                  item.tried.includes(key),
                ) &&
                !progress.tried.includes(key),
            )) {
              try {
                await eligibleReviewers(
                  session,
                  channel,
                  {
                    ...value,
                    config: {
                      ...value.config,
                      lanes: [
                        {
                          ...lane,
                          reviewers: [key],
                          humanReviewers: human ? [key] : [],
                        },
                      ],
                    },
                  },
                  signal,
                );
                replacement = key;
                break;
              } catch {
                signal.throwIfAborted();
              }
            }
            if (!replacement || progress.tried.length >= 100) {
              exhausted = true;
              continue;
            }
            const request = crypto.randomUUID();
            value = {
              ...value,
              config: {
                ...value.config,
                lanes: value.config.lanes.map((item) =>
                  item.id === lane.id
                    ? {
                        ...item,
                        reviewers: item.reviewers.map((key) =>
                          key === reviewer ? replacement : key,
                        ),
                        humanReviewers:
                          item.humanReviewers?.map((key) =>
                            key === reviewer ? replacement : key,
                          ) ?? [],
                      }
                    : item,
                ),
              },
              threads: value.threads.map((item, i) =>
                i === index ? { ...item, request, requestedAt: now } : item,
              ),
            };
            progress = {
              request,
              tried: [...progress.tried, replacement],
              reminders: 0,
              lastActionAt: now,
            };
          } else
            progress = {
              ...progress,
              reminders: progress.reminders + 1,
              lastActionAt: now,
            };
          progress.pending = {
            key: crypto.randomUUID(),
            device: reviewDevice(session),
            kind,
          };
          record = await writeSubmission(
            session,
            channel,
            {
              ...value,
              automation: { ...value.automation, [assignment]: progress },
            },
            record,
            signal,
          );
        }
        const pending = progress.pending;
        if (!pending) throw new Error("Review notification intent is missing.");
        if (pending.device !== reviewDevice(session))
          throw new Error(
            "Resume review automation with its original server storage.",
          );
        const currentLane = submissionLane(record.value, index);
        if (!currentLane) throw new Error("Review lane is unavailable.");
        const assertAgents = await eligibleReviewers(
          session,
          channel,
          {
            ...record.value,
            config: { ...record.value.config, lanes: [currentLane] },
          },
          signal,
        );
        const active = () => {
          try {
            signal.throwIfAborted();
            assertAgents();
            return true;
          } catch {
            return false;
          }
        };
        const key = `review-auto:${record.artifactId}:${pending.key}`;
        const recovery = await outbox.recovery(key);
        let id: string;
        if (recovery) {
          id = recovery.event.id;
          if (!["accepted", "seen", "sending"].includes(recovery.delivery))
            outbox.retry(id, active);
        } else {
          const request = threadMessage(record.value, channel, index);
          id = outbox.send(
            {
              ...request,
              tags: [
                ...request.tags.filter(([name]) => name !== "subject"),
                ["e", thread.id, "", "reply"],
              ],
              content:
                pending.kind === "assign"
                  ? request.content.replace(
                      "**Review request:**",
                      "**Review reassigned:**",
                    )
                  : `**Review progress reminder ${progress.reminders}/3.** Continue your accepted review; report progress or its outcome in this thread. Your review request is unchanged.`,
            },
            { key, value: record.artifactId },
            active,
          );
        }
        await delivered(outbox, id, signal);
        const { pending: _pending, ...complete } = progress;
        complete.lastActionAt = Math.floor(Date.now() / 1000);
        complete.receipt = id;
        await writeSubmission(
          session,
          channel,
          {
            ...record.value,
            threads:
              pending.kind === "assign"
                ? record.value.threads.map((item, i) =>
                    i === index
                      ? { ...item, requestedAt: complete.lastActionAt }
                      : item,
                  )
                : record.value.threads,
            automation: { ...record.value.automation, [assignment]: complete },
          },
          record,
          signal,
        );
        await outbox.acknowledge(id);
        return pending.kind === "assign" ? "assigned" : "reminded";
      }
      return exhausted ? "exhausted" : "idle";
    },
  );
}
