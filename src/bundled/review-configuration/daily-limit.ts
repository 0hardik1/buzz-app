import {
  ARTIFACT_KIND,
  uuidv5,
} from "../../features/agents/agent-config-artifacts";
import { PublishRejected } from "../../features/relay/outbox";
import { reviewChannel } from "./access";
import type { SavedReviewConfig } from "./configuration";
import type { ReviewSession } from "./session";

const TYPE = "buzz.review.daily-usage";

/** One CAS counter per configuration/day. Each immutable counter revision is
 * also the receipt for that admission, so retries need no growing key array.
 * Count work admitted to triage/review, including subsequently deleted reviews.
 * A failed/uncertain submission retains its reservation for the same retry. */
export async function reserveDailyReview(
  session: ReviewSession,
  channel: string,
  saved: SavedReviewConfig,
  submission: string,
  previous: string | undefined,
  signal: AbortSignal,
) {
  const read = session.snapshotRead;
  const writer = session.configArtifactWriter;
  if (!read || !writer)
    throw new Error("Daily review accounting is unavailable.");
  const day = new Date(Date.now()).toISOString().slice(0, 10);
  const id = await uuidv5(channel, `${TYPE}:${saved.config.repository}:${day}`);
  const request = await uuidv5(submission, previous ?? "first");
  for (let attempt = 0; attempt < 4; attempt++) {
    reviewChannel(session, channel, true);
    const [configuration] = await read(
      [
        {
          kinds: [ARTIFACT_KIND],
          "#h": [channel],
          "#d": [saved.artifactId],
          artifact: "current",
          limit: 1,
        },
      ],
      { signal },
    );
    if (!configuration || configuration.id !== saved.revision)
      throw new Error(
        "Review configuration changed or was removed. Reload before submitting.",
      );
    const heads = await read(
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
    const head = heads[0];
    const receipts = await read(
      [
        {
          kinds: [ARTIFACT_KIND],
          "#h": [channel],
          "#d": [id],
          "#r": [request],
          artifact: "history",
          limit: 1,
        },
      ],
      { signal },
    );
    if (
      receipts.some((event) =>
        event.tags.some(([key, value]) => key === "r" && value === request),
      )
    )
      return;
    const value = head
      ? JSON.parse(head.content)
      : { version: 1, day, count: 0 };
    if (
      value.version !== 1 ||
      value.day !== day ||
      !Number.isSafeInteger(value.count) ||
      value.count < 0
    )
      throw new Error("Daily review accounting could not be read safely.");
    if (
      saved.config.maxPrsPerDay !== undefined &&
      value.count >= saved.config.maxPrsPerDay
    )
      throw new Error(
        `Daily PR limit reached (${saved.config.maxPrsPerDay}). New submissions resume at midnight UTC. Existing reviews and reminders can continue.`,
      );
    const now = Date.now();
    const event = await writer.sign(
      {
        kind: ARTIFACT_KIND,
        created_at: Math.floor(now / 1000),
        content: JSON.stringify({ version: 1, day, count: value.count + 1 }),
        tags: [
          ["ar", "1"],
          ["h", channel],
          ["d", id],
          ["type", TYPE],
          ["title", `Daily reviews: ${saved.config.repository} · ${day}`],
          ["op", head ? "update" : "create"],
          ["r", request],
          ["ms", String(now % 1000)],
          ...(head ? [["prev", head.id]] : []),
        ],
      },
      signal,
    );
    reviewChannel(session, channel, true);
    try {
      await writer.publish(event, signal);
      return;
    } catch (reason) {
      if (
        !(reason instanceof PublishRejected) ||
        !/^conflict:/.test(reason.reason ?? reason.message)
      )
        throw reason;
    }
  }
  throw new Error(
    "Daily review accounting changed concurrently. Try submitting again.",
  );
}
