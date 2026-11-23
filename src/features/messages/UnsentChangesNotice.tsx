import { useState, useSyncExternalStore } from "react";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import { ToastNotice } from "../../shared/design-system/ui/Toast";
import type { Outbox, OutgoingEvent } from "../relay/outbox";

type Source = Pick<Outbox, "subscribe" | "snapshot" | "stuck" | "discard">;
type ChannelName = (id: string) => string | undefined;

/** The one place people can clear writes that nothing else can send: held
 * plugin writes restored after a restart, and a full queue. Closed, it stays
 * as a small entry point until nothing needs attention. */
export function UnsentChangesNotice({
  outbox,
  channelName = () => undefined,
}: {
  outbox: Source | undefined;
  channelName?: ChannelName;
}) {
  return outbox?.stuck && outbox.discard ? (
    <Notice outbox={outbox as Required<Source>} channelName={channelName} />
  ) : null;
}

const KINDS: Readonly<Record<number, string>> = {
  5: "Deletion",
  7: "Reaction",
  9: "Message",
  9000: "Member addition",
  9007: "Chat creation",
  40003: "Message edit",
  40100: "Canvas save",
};
const PREVIEW_KINDS = new Set([9, 40003]);
const time = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short",
});

/** The record a write targets, from its `d`, `a` or `e` tag, kept short. */
function target({ tags }: OutgoingEvent["event"]) {
  const tag = (name: string) => tags.find(([key]) => key === name)?.[1];
  const value =
    tag("d") ??
    tag("a")?.split(":").slice(2).join(":") ??
    tag("e")?.slice(0, 8);
  return value && value.length > 24 ? `${value.slice(0, 23)}…` : value;
}

function describe(item: OutgoingEvent, channelName: ChannelName) {
  const { event } = item;
  const what =
    KINDS[event.kind] ??
    `${item.held ? "Plugin change" : "Change"} (kind ${event.kind})`;
  const channel = event.tags.find(([name]) => name === "h")?.[1];
  const where = channel ? channelName(channel) : undefined;
  const preview = PREVIEW_KINDS.has(event.kind)
    ? event.content.trim().slice(0, 80)
    : "";
  const record = preview ? undefined : target(event);
  return [
    what,
    record ? `for ${record}` : "",
    where ? `in ${where}` : "",
    time.format(event.created_at * 1000),
    preview ? `“${preview}”` : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

function status(item: OutgoingEvent) {
  switch (item.delivery) {
    case "failed":
      return { label: "Not sent" };
    case "unknown":
    case "sending":
      return {
        label: "Not confirmed",
        effect:
          "It may already be on the relay. Discarding only stops this device from sending it.",
      };
    default:
      return {
        label: "Already sent",
        effect: "Discarding only stops local follow-up.",
      };
  }
}

function Notice({
  outbox,
  channelName,
}: {
  outbox: Required<Source>;
  channelName: ChannelName;
}) {
  const stuck = useSyncExternalStore(
    outbox.subscribe,
    outbox.stuck,
    outbox.stuck,
  );
  const pending = useSyncExternalStore(
    outbox.subscribe,
    outbox.snapshot,
    outbox.snapshot,
  );
  // Writes the person chose to discard stay listed until their removal ends,
  // and those that failed stay listed with the error.
  const [tracked, setTracked] = useState<readonly OutgoingEvent[]>([]);
  const [expanded, setExpanded] = useState(true);
  const [confirming, setConfirming] = useState<readonly OutgoingEvent[]>();
  const [busy, setBusy] = useState(false);
  const [reason, setReason] = useState<string>();
  const listed = new Set(stuck.items.map((item) => item.event.id));
  const present = new Set(pending.map((item) => item.event.id));
  const left = tracked.filter((item) => present.has(item.event.id));
  const items = [
    ...stuck.items,
    ...left.filter((item) => !listed.has(item.event.id)),
  ];
  const count = items.length;
  if (!count) return null;
  const error =
    !busy && reason && left.length > 0
      ? `Couldn’t discard ${left.length === 1 ? "1 change" : `${left.length} changes`}. ${reason}`
      : undefined;
  const discard = async (targets: readonly OutgoingEvent[]) => {
    setBusy(true);
    const ids = new Set(targets.map((item) => item.event.id));
    setTracked((current) => [
      ...current.filter((item) => !ids.has(item.event.id)),
      ...targets,
    ]);
    const results = await Promise.allSettled(
      targets.map((item) => outbox.discard(item.event.id)),
    );
    const done = new Set(
      targets
        .filter((_, index) => results[index]?.status === "fulfilled")
        .map((item) => item.event.id),
    );
    setTracked((current) => current.filter((item) => !done.has(item.event.id)));
    const failure = results.find(
      (result): result is PromiseRejectedResult => result.status === "rejected",
    )?.reason;
    if (failure) {
      setReason(failure instanceof Error ? failure.message : "Try again.");
      setExpanded(true);
    }
    setBusy(false);
    setConfirming(undefined);
  };
  const title = `${count} unsent ${count === 1 ? "change" : "changes"}`;
  if (!expanded)
    return (
      <ToastNotice
        key="collapsed"
        title={title}
        tone={stuck.full ? "warning" : "info"}
      >
        <Button type="button" size="sm" onClick={() => setExpanded(true)}>
          Review
        </Button>
      </ToastNotice>
    );
  return (
    <>
      <ToastNotice
        key="expanded"
        title={title}
        description={
          stuck.full
            ? "Buzz can’t send anything new until you discard some of these. Discarding removes a change from this device without sending it."
            : "After a restart, only the plugin that made these can send them. Discarding removes a change from this device without sending it."
        }
        tone={stuck.full ? "warning" : "info"}
        reachableOverModal={stuck.full}
        closeLabel="Hide unsent changes"
        onDismiss={() => setExpanded(false)}
        details={
          busy && tracked.length > 1 ? (
            <p className="text-caption">Discarding…</p>
          ) : (
            <>
              <ul
                style={{
                  maxHeight: "12rem",
                  overflowY: "auto",
                  display: "grid",
                  gap: "var(--space-2)",
                  paddingInlineStart: 0,
                  listStyle: "none",
                }}
              >
                {items.map((item) => {
                  const { label, effect } = status(item);
                  const name = describe(item, channelName);
                  return (
                    <li
                      key={item.event.id}
                      style={{ display: "flex", gap: "var(--space-2)" }}
                    >
                      <span className="text-caption" style={{ flex: 1 }}>
                        {name}
                        <br />
                        <span className="text-subtle">
                          {label}
                          {effect ? `. ${effect}` : ""}
                        </span>
                      </span>
                      <Button
                        type="button"
                        size="sm"
                        disabled={busy}
                        aria-label={`Discard ${name}`}
                        onClick={() => discard([item])}
                      >
                        Discard
                      </Button>
                    </li>
                  );
                })}
              </ul>
              {error && (
                <p role="alert" className="text-caption">
                  {error}
                </p>
              )}
            </>
          )
        }
      >
        <Button
          type="button"
          size="sm"
          disabled={busy}
          onClick={() => setConfirming(items)}
        >
          Discard all
        </Button>
      </ToastNotice>
      {confirming && (
        <AlertDialog
          title={`Discard ${confirming.length} unsent ${confirming.length === 1 ? "change" : "changes"}?`}
          description="Each change is removed from this device without being sent. This can’t be undone."
          pending={busy}
          onClose={() => setConfirming(undefined)}
          actions={
            <>
              <Button disabled={busy} onClick={() => setConfirming(undefined)}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                disabled={busy}
                onClick={() => discard(confirming)}
              >
                Discard all
              </Button>
            </>
          }
        />
      )}
    </>
  );
}
