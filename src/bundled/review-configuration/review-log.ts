import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../features/agents/agent-config-artifacts";
import { REVIEW_SUBMISSION } from "../../features/agents/pr-review";
import type { EventData } from "../../features/relay/events";
import { reviewHistoryChannel, reviewChannel } from "./access";
import { decodeSubmission, type SavedSubmission } from "./submissions";
import type { ReviewSession } from "./session";

const TYPE = "buzz.review.activity";
const tag = (event: EventData, name: string) =>
  event.tags.find(([key]) => key === name)?.[1];
export const reviewLogIdentity = (
  channel: string,
  repository: string,
  pr: number,
) => uuidv5(channel, `${REVIEW_SUBMISSION}:${repository}:${pr}`);

/** Admission failures have no submission yet. Keep their last distinct reason
 * as an artifact revision, without posting repeated worker errors into chat. */
export async function recordReviewFailure(
  session: ReviewSession,
  channel: string,
  repository: string,
  pr: number,
  message: string,
  signal: AbortSignal,
) {
  const read = session.snapshotRead,
    writer = session.configArtifactWriter;
  if (!read || !writer) throw new Error("Review log is unavailable.");
  reviewChannel(session, channel, true);
  const id = await uuidv5(channel, `${TYPE}:${repository}:${pr}`);
  const [head] = await read(
    [
      {
        kinds: [ARTIFACT_KIND],
        "#h": [channel],
        "#d": [id],
        artifact: "current",
        limit: 1,
      },
    ],
    { signal },
  );
  const content = JSON.stringify({
    version: 1,
    repository,
    pr,
    action: "Submission blocked",
    message: message.slice(0, 4000),
  });
  if (head?.content === content) return;
  const now = Date.now();
  const event = await writer.sign(
    {
      kind: ARTIFACT_KIND,
      created_at: Math.floor(now / 1000),
      content,
      tags: [
        ["ar", "1"],
        ["h", channel],
        ["d", id],
        ["type", TYPE],
        ["title", `Review log: ${repository}#${pr}`],
        ["ms", String(now % 1000)],
        ["op", head ? "update" : "create"],
        ...(head ? [["prev", head.id]] : []),
      ],
    },
    signal,
  );
  reviewChannel(session, channel, true);
  await writer.publish(event, signal);
}

export type LogEntry = { event: EventData; title: string; detail: string };
export type LogPage = { entries: LogEntry[]; roots: string[]; more: boolean };

/** The artifact revision history IS the durable transition log. No second
 * journal can drift from accepted submissions, decisions, or notifications. */
export async function loadReviewLog(
  session: ReviewSession,
  channel: string,
  repository: string,
  pr: number,
  offset: number,
  signal: AbortSignal,
): Promise<LogPage> {
  reviewHistoryChannel(session, channel);
  const read = session.snapshotRead;
  if (!read) throw new Error("Review log reads are unavailable.");
  const id = await reviewLogIdentity(channel, repository, pr);
  const activity = await uuidv5(channel, `${TYPE}:${repository}:${pr}`);
  const pages = await Promise.all(
    [id, activity].map((artifact) =>
      read(
        [
          {
            kinds: [ARTIFACT_KIND],
            "#h": [channel],
            "#d": [artifact],
            artifact: "history",
            limit: 100,
            offset,
          },
        ],
        { signal },
      ),
    ),
  );
  const entries: LogEntry[] = [];
  const roots = new Set<string>();
  const decoded = new Map<string, SavedSubmission>();
  for (const event of pages[0] ?? [])
    decoded.set(event.id, await decodeSubmission(event, channel));
  for (const event of pages.flat()) {
    if (tag(event, "h") !== channel) throw new Error("Unexpected log channel.");
    const saved = decoded.get(event.id);
    if (!saved) {
      const value = JSON.parse(event.content);
      if (
        tag(event, "type") !== TYPE ||
        value.repository !== repository ||
        value.pr !== pr ||
        typeof value.message !== "string"
      )
        throw new Error("Invalid review log entry.");
      entries.push({
        event,
        title: "Submission blocked",
        detail: value.message,
      });
      continue;
    }
    const value = saved.value;
    const prior = decoded.get(tag(event, "prev") ?? "")?.value;
    for (const thread of [
      ...value.threads,
      ...(value.triage ? [value.triage.thread] : []),
    ])
      if (thread.id) roots.add(thread.id);
    let title = "Review state saved";
    if (value.deleted) title = "Submission deleted";
    else if (value.notifying && !prior?.notifying)
      title = value.reminderMessage
        ? "Reminder requested"
        : "Re-review requested";
    else if (value.triage && value.triage.state !== prior?.triage?.state)
      title = `Triage ${value.triage.state}`;
    else if (
      tag(event, "op") === "create" ||
      prior?.deleted ||
      (prior && prior.generation !== value.generation)
    )
      title = "Submission started";
    else if (
      prior &&
      value.threads.some(
        (thread, index) => thread.delivered && !prior.threads[index]?.delivered,
      )
    )
      title = "Review request delivered";
    else if (
      prior &&
      JSON.stringify(value.automation) !== JSON.stringify(prior.automation)
    )
      title = "Automatic reminder or assignment updated";
    else if (prior?.notifying && !value.notifying) title = "Reviewers notified";
    entries.push({
      event,
      title,
      detail: value.triage?.message ?? value.reminderMessage ?? "",
    });
  }
  reviewHistoryChannel(session, channel);
  return {
    entries,
    roots: [...roots],
    more: pages.some((page) => page.length === 100),
  };
}

export async function loadLogMessages(
  session: ReviewSession,
  channel: string,
  roots: readonly string[],
  signal: AbortSignal,
  cursor?: { until: number; before_id: string },
) {
  reviewHistoryChannel(session, channel);
  if (!session.snapshotRead)
    throw new Error("Review messages are unavailable.");
  if (!roots.length) return { entries: [], cursor: undefined };
  const replies = await session.snapshotRead(
    [{ kinds: [9], "#h": [channel], "#e": roots, limit: 100, ...cursor }],
    { signal },
  );
  const messages = cursor
    ? replies
    : [
        ...replies,
        ...(await session.snapshotRead(
          [{ kinds: [9], "#h": [channel], ids: roots, limit: roots.length }],
          { signal },
        )),
      ];
  reviewHistoryChannel(session, channel);
  const oldest = [...replies].sort(
    (a, b) => a.created_at - b.created_at || b.id.localeCompare(a.id),
  )[0];
  return {
    entries: messages.map((event) => ({
      event,
      title:
        tag(event, "t") === "buzz.review.status"
          ? "Review outcome"
          : tag(event, "t") === "buzz.triage.decision"
            ? "Triage decision"
            : "Thread message",
      detail: event.content,
    })),
    cursor:
      replies.length === 100 && oldest
        ? { until: oldest.created_at, before_id: oldest.id }
        : undefined,
  };
}
