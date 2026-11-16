import { Checkbox } from "../../shared/design-system/ui/Checkbox";
import { useEffect, useRef, useState } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import { reportHumanReview, type HumanOutcome } from "./human-review";
import type { ReviewSession } from "./session";
import type { SavedSubmission } from "./submissions";

export function HumanReviewActions({
  session,
  channel,
  row,
  index,
  onSaved,
}: {
  session: ReviewSession;
  channel: string;
  row: SavedSubmission;
  index: number;
  onSaved(): void;
}) {
  const [message, setMessage] = useState("");
  const [githubApproved, setGithubApproved] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => operation.current?.abort(), []);
  async function report(status: HumanOutcome) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      await reportHumanReview(
        session,
        channel,
        row,
        index,
        status,
        message,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]),
        githubApproved,
      );
      if (!controller.signal.aborted) {
        setMessage("");
        setGithubApproved(false);
        onSaved();
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error ? reason.message : "Could not save review.",
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="review-config-form" aria-label="Your human review">
      <Field
        label="Review note"
        description="Include the reviewed commit and findings. These outcomes are recorded in Buzz; they do not approve on GitHub."
      >
        <Textarea
          rows={2}
          maxLength={4000}
          value={message}
          disabled={busy}
          onChange={(event) => setMessage(event.target.value)}
        />
      </Field>
      <div className="review-config-actions">
        <Button disabled={busy} onClick={() => void report("reviewing")}>
          Start review
        </Button>
        <Button
          disabled={
            busy ||
            !row.reviewStates?.[index] ||
            row.reviewStates[index] === "need_review"
          }
          onClick={() => void report("request_changes")}
        >
          Request changes
        </Button>
        <Button
          disabled={
            busy ||
            !row.reviewStates?.[index] ||
            row.reviewStates[index] === "need_review"
          }
          onClick={() => void report("lgtm_not_approved")}
        >
          Looks good
        </Button>
      </div>
      <Checkbox
        label="I approved the current commit on GitHub"
        checked={githubApproved}
        disabled={busy}
        onCheckedChange={setGithubApproved}
      />
      <Button
        disabled={
          busy ||
          !githubApproved ||
          !row.reviewStates?.[index] ||
          row.reviewStates[index] === "need_review"
        }
        onClick={() => void report("approved")}
      >
        Record approval
      </Button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
