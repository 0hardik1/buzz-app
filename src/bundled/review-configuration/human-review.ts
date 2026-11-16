import { ARTIFACT_KIND } from "../../features/agents/agent-config-artifacts";
import {
  REVIEW_REPORT,
  latestReport,
  reportSequence,
  reportStatus,
  reviewLabels,
  reviewTarget,
} from "../../features/agents/pr-review";
import { confirmReviewChannel, confirmHumanReviewers } from "./access";
import {
  delivered,
  decodeSubmission,
  submissionLane,
  type SavedSubmission,
} from "./submissions";
import { reviewLocks, type ReviewSession } from "./session";

export type HumanOutcome =
  | "reviewing"
  | "request_changes"
  | "lgtm_not_approved"
  | "approved";

/** Reports are signed by the assigned person; the submitter cannot report for them. */
export async function reportHumanReview(
  session: ReviewSession,
  channel: string,
  row: SavedSubmission,
  index: number,
  status: HumanOutcome,
  message: string,
  signal: AbortSignal,
  githubApproved = false,
) {
  if (
    !["reviewing", "request_changes", "lgtm_not_approved", "approved"].includes(
      status,
    ) ||
    message.length > 4000
  )
    throw new Error(
      "Choose a review outcome and a note up to 4,000 characters.",
    );
  if (status === "approved" && !githubApproved)
    throw new Error(
      "Confirm that you approved the current commit on GitHub first.",
    );
  const outbox = session.outbox,
    read = session.snapshotRead;
  if (!outbox?.supports(9) || !read || !session.viewer)
    throw new Error("Review reporting is unavailable.");
  const viewer = session.viewer;
  return reviewLocks(session).request(
    `buzz.review.human:${session.scope}`,
    { signal },
    async () => {
      await confirmReviewChannel(session, channel, signal);
      const assertHuman = await confirmHumanReviewers(
        session,
        channel,
        [viewer],
        signal,
      );
      const root = row.value.threads[index]?.id;
      if (!root) throw new Error("The review request has not been delivered.");
      const current = async () => {
        const [head] = await read(
          [
            {
              kinds: [ARTIFACT_KIND],
              "#h": [channel],
              "#d": [row.artifactId],
              artifact: "current",
              limit: 1,
            },
          ],
          { signal },
        );
        if (!head) throw new Error("Submission is unavailable.");
        const saved = await decodeSubmission(head, channel);
        const lane = submissionLane(saved.value, index);
        if (!lane?.humanReviewers?.includes(viewer))
          throw new Error("This human review is not assigned to you.");
        const target = await reviewTarget(head, channel, root, viewer);
        if (target.request !== row.value.threads[index]?.request)
          throw new Error("Review changed. Reload before reporting.");
        return target;
      };
      const target = await current();
      const reports = await read(
        [
          {
            kinds: [9],
            authors: [viewer],
            "#h": [channel],
            "#t": [REVIEW_REPORT],
            "#r": [target.request],
            limit: 100,
            consistency: "strong",
          },
        ],
        { signal },
      );
      if (reports.length >= 100)
        throw new Error("Request a new review before adding more outcomes.");
      if (
        status !== "reviewing" &&
        !reports.some((report) => reportStatus(report, target) === "reviewing")
      )
        throw new Error("Start your review before recording an outcome.");
      const previous = latestReport(reports, target);
      await current();
      await outbox.ready();
      const sequence = previous ? reportSequence(previous) + 1 : 1;
      const key = `review-human:${row.artifactId}:${target.request}:${sequence}`;
      const content = `Review status: ${reviewLabels[status]}.${message.trim() ? `\n\n${message.trim()}` : ""}`;
      const recovery = await outbox.recovery(key);
      let id = recovery?.event.id;
      const active = () => {
        try {
          assertHuman();
          return !signal.aborted;
        } catch {
          return false;
        }
      };
      if (recovery) {
        if (
          recovery.event.content !== content ||
          !recovery.event.tags.some(
            ([name, value]) => name === "status" && value === status,
          )
        )
          throw new Error(
            "A different review report is awaiting delivery. Retry its original outcome and note before recording another.",
          );
        if (!["accepted", "seen", "sending"].includes(recovery.delivery))
          outbox.retry(recovery.event.id, active);
      } else
        id = outbox.send(
          {
            kind: 9,
            tags: [
              ["h", channel],
              ["e", root, "", "reply"],
              ["t", REVIEW_REPORT],
              ["r", target.request],
              ["review", target.artifact, String(target.index)],
              ["status", status],
              ["review-sequence", String(sequence)],
            ],
            content,
          },
          { key, value: row.artifactId },
          active,
        );
      if (!id) throw new Error("Review delivery could not be started.");
      await delivered(outbox, id, signal);
      await current();
      await outbox.acknowledge(id);
    },
  );
}
