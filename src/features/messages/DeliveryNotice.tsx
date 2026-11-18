import { Button } from "../../shared/design-system/ui/Button";
import { ArrowsClockwiseIcon } from "../../shared/design-system/icons";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ChannelMessage } from "../relay/contracts";
import type { Outbox, OutboxRecovery } from "../relay/outbox";
import { abandonableSetup, soloAdminKey } from "../relay/solo-admins";
import { AbandonAdminSetup } from "./AbandonAdminSetup";
import { DELIVERY_GRACE_MS, deliveryFeedback } from "./delivery";
import styles from "./Messages.module.css";

const noSubscribe = () => () => {};

export function DeliveryNotice({
  row,
  retry,
  outbox,
}: {
  row: ChannelMessage;
  retry?: ((id: string) => void) | undefined;
  outbox?: Outbox | undefined;
}) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!row.delivery || row.delivery === "seen") return;
    setNow(Date.now());
    const remaining = row.createdAt * 1000 + DELIVERY_GRACE_MS - Date.now();
    if (remaining <= 0) return;
    const timer = setTimeout(() => setNow(Date.now()), remaining);
    return () => clearTimeout(timer);
  }, [row.createdAt, row.delivery]);
  // A refused retry explains itself until the delivery changes.
  const [refusal, setRefusal] = useState<{
    delivery: ChannelMessage["delivery"];
    reason: string;
  }>();
  const refused =
    refusal && refusal.delivery === row.delivery ? refusal.reason : undefined;
  // A Solo chat's unfinished opening-admin setup fails every message in it,
  // so a failed row there gives the setup's reason and the way to end it.
  const failed = row.delivery === "failed";
  const unfinished = () =>
    failed
      ? outbox
          ?.snapshot()
          .find((item) => item.recovery?.key === soloAdminKey(row.channelId))
      : undefined;
  const setup = useSyncExternalStore(
    (failed && outbox?.subscribe) || noSubscribe,
    unfinished,
    unfinished,
  );
  // Kept once seen, so the row can say that setup ended, however it ended.
  // Having said so, the row drops it when it is next tried: a failure after
  // that has its own cause. A try begun under setup keeps it, because setup
  // can end during that try.
  const [held, setHeld] = useState<"setup" | "ended">();
  if (setup) {
    if (held !== "setup") setHeld("setup");
  } else if (failed) {
    if (held === "setup") setHeld("ended");
  } else if (held === "ended") setHeld(undefined);
  const recovery = setup && abandonableSetup(setup);
  const [abandon, setAbandon] = useState<{
    id: string;
    recovery: OutboxRecovery;
  }>();
  const retryButton = useRef<HTMLButtonElement>(null);
  const abandonButton = useRef<HTMLButtonElement>(null);
  const reason = !failed
    ? undefined
    : setup
      ? row.deliveryError
      : held
        ? "Chat admin setup has ended, and the chat keeps its current roles. Retry this message, or send it again if it has expired."
        : undefined;
  const status = deliveryFeedback(row, now);
  const feedback =
    status && [status, reason, refused].filter(Boolean).join(" ");
  if (!feedback) return null;
  const canRetry =
    !refused &&
    (row.delivery === "failed" || row.delivery === "unknown") &&
    retry;
  return (
    <div className={styles.delivery}>
      <span
        role="status"
        className={canRetry && !reason ? "sr-only" : undefined}
      >
        {feedback}
      </span>
      {canRetry && (
        <Button
          ref={retryButton}
          size="inline"
          variant="ghost"
          title={feedback}
          onClick={() => {
            try {
              retry(row.id);
            } catch (error) {
              setRefusal({
                delivery: row.delivery,
                reason: error instanceof Error ? error.message : String(error),
              });
            }
          }}
        >
          <ArrowsClockwiseIcon size={12} aria-hidden="true" /> Retry
        </Button>
      )}
      {setup && recovery && (
        <Button
          ref={abandonButton}
          size="inline"
          variant="ghost"
          onClick={() => setAbandon({ id: setup.event.id, recovery })}
        >
          Abandon admin setup
        </Button>
      )}
      {abandon && outbox && (
        <AbandonAdminSetup
          outbox={outbox}
          id={abandon.id}
          recovery={abandon.recovery}
          finalFocus={() =>
            abandonButton.current?.isConnected
              ? abandonButton.current
              : retryButton.current
          }
          onClose={() => setAbandon(undefined)}
        />
      )}
    </div>
  );
}
