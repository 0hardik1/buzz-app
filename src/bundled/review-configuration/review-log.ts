import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../features/agents/agent-config-artifacts";
import { TRIAGE_REPORT } from "../../features/agents/pr-triage";
import { REVIEW_SUBMISSION } from "../../features/agents/pr-review";
import type { EventData } from "../../features/relay/events";
import { reviewHistoryChannel, reviewChannel } from "./access";
import { decodeSubmission, type SavedSubmission } from "./submissions";
import type { ReviewSession } from "./session";

export type ReviewLogScope = { id: string; startedAt: number; triage?: true };
export type LogScope = (
  | ReviewLogScope
  | { generation?: string | undefined; startedAt: number }
) & { requests?: readonly string[] };
export const submissionLogScope = (value: SavedSubmission["value"]): LogScope =>
  value.log ?? {
    generation: value.generation,
    startedAt: (value.submittedAt ?? 0) * 1000,
  };
const eventTime = (event: EventData) =>
  event.created_at * 1000 +
  Number(event.tags.find(([key]) => key === "ms")?.[1] ?? 0);
const sameLog = (a: LogScope, b: LogScope) =>
  "id" in a && "id" in b
    ? a.id === b.id
    : !("id" in a) && !("id" in b) && a.generation === b.generation;

const TYPE = "buzz.review.activity";
const tag = (event: EventData, name: string) =>
  event.tags.find(([key]) => key === name)?.[1];
export const reviewLogIdentity = (
  channel: string,
  repository: string,
  pr: number,
) => uuidv5(channel, `${REVIEW_SUBMISSION}:${repository}:${pr}`);

/** Failures belong to the caller's attempt, including failures before admission.
 * A repeated reason within that attempt reuses its saved revision. */
export async function recordReviewFailure(
  session: ReviewSession,
  channel: string,
  repository: string,
  pr: number,
  message: string,
  signal: AbortSignal,
  log: ReviewLogScope,
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
    log,
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
export type LogPage = {
  entries: LogEntry[];
  roots: string[];
  more: boolean;
  scope?: LogScope | undefined;
};

/** The artifact revision history IS the durable transition log. No second
 * journal can drift from accepted submissions, decisions, or notifications. */
export async function loadReviewLog(
  session: ReviewSession,
  channel: string,
  repository: string,
  pr: number,
  offset: number,
  signal: AbortSignal,
  scope?: LogScope,
): Promise<LogPage> {
  reviewHistoryChannel(session, channel);
  const read = session.snapshotRead;
  if (!read) throw new Error("Review log reads are unavailable.");
  const id = await reviewLogIdentity(channel, repository, pr);
  const activity = await uuidv5(channel, `${TYPE}:${repository}:${pr}`);
  if (!scope) {
    const heads = await read(
      [
        {
          kinds: [ARTIFACT_KIND],
          "#h": [channel],
          "#d": [id, activity],
          artifact: "current",
          limit: 2,
        },
      ],
      { signal },
    );
    const latest = [...heads].sort((a, b) => eventTime(b) - eventTime(a))[0];
    if (latest)
      scope =
        tag(latest, "d") === id
          ? submissionLogScope((await decodeSubmission(latest, channel)).value)
          : (JSON.parse(latest.content).log ?? {
              startedAt: eventTime(latest),
            });
  }
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
  const requests = new Set(scope?.requests);
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
      if (
        scope &&
        (value.log
          ? !sameLog(scope, value.log)
          : eventTime(event) < scope.startedAt)
      )
        continue;
      entries.push({
        event,
        title: "Submission blocked",
        detail: value.message,
      });
      continue;
    }
    const value = saved.value;
    if (scope && !sameLog(scope, submissionLogScope(value))) continue;
    const prior = decoded.get(tag(event, "prev") ?? "")?.value;
    const triage = !value.log || value.log.triage ? value.triage : undefined;
    for (const thread of [
      ...value.threads,
      ...(triage ? [triage.thread] : []),
    ]) {
      if (thread.id) roots.add(thread.id);
      if (thread.request) requests.add(thread.request);
    }
    let title = "Review state saved";
    if (value.deleted) title = "Submission deleted";
    else if (value.log && prior && value.log.id !== prior.log?.id)
      title = "Submission started";
    else if (value.notifying && !prior?.notifying)
      title = value.reminderMessage
        ? "Reminder requested"
        : "Re-review requested";
    else if (triage && triage.state !== prior?.triage?.state)
      title = `Triage ${triage.state}`;
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
      detail: triage?.message ?? value.reminderMessage ?? "",
    });
  }
  reviewHistoryChannel(session, channel);
  return {
    entries,
    scope: scope ? { ...scope, requests: [...requests] } : undefined,
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
  scope?: LogScope,
) {
  reviewHistoryChannel(session, channel);
  if (!session.snapshotRead)
    throw new Error("Review messages are unavailable.");
  if (!roots.length) return { entries: [], cursor: undefined };
  const replies = await session.snapshotRead(
    [
      {
        kinds: [9],
        "#h": [channel],
        "#e": roots,
        limit: 100,
        ...(scope ? { since: Math.floor(scope.startedAt / 1000) } : {}),
        ...cursor,
      },
    ],
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
    entries: messages
      .filter((event) => {
        if (scope && eventTime(event) < scope.startedAt) return false;
        const structured = ["buzz.review.status", TRIAGE_REPORT].includes(
          tag(event, "t") ?? "",
        );
        return (
          !structured ||
          !scope?.requests ||
          scope.requests.includes(tag(event, "r") ?? "")
        );
      })
      .map((event) => ({
        event,
        title:
          tag(event, "t") === "buzz.review.status"
            ? "Review outcome"
            : tag(event, "t") === TRIAGE_REPORT
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
