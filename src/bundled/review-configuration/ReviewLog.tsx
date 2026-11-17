import { useEffect, useRef, useState } from "react";
import { Accordion } from "../../shared/design-system/ui/Accordion";
import { Button } from "../../shared/design-system/ui/Button";
import type { RelaySession } from "../../features/relay/session";
import { threadUrl } from "./submissions";
import {
  loadReviewLog,
  loadLogMessages,
  type LogEntry,
  type LogScope,
} from "./review-log";

export function ReviewLog({
  session,
  channel,
  repository,
  pr,
  scope,
}: {
  session: RelaySession;
  channel: string;
  repository: string;
  pr: number;
  scope?: LogScope | undefined;
}) {
  return (
    <Accordion
      items={[
        {
          value: "log",
          title: "Log",
          content: (
            <LogBody
              key={
                scope
                  ? "id" in scope
                    ? scope.id
                    : (scope.generation ?? "legacy")
                  : `${repository}:${pr}`
              }
              session={session}
              channel={channel}
              repository={repository}
              pr={pr}
              scope={scope}
            />
          ),
        },
      ]}
    />
  );
}

function LogBody({
  session,
  channel,
  repository,
  pr,
  scope,
}: {
  session: RelaySession;
  channel: string;
  repository: string;
  pr: number;
  scope?: LogScope | undefined;
}) {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [offset, setOffset] = useState(0);
  const [more, setMore] = useState(true);
  const [messages, setMessages] = useState<
    { roots: string[]; cursor: { until: number; before_id: string } }[]
  >([]);
  const operation = useRef<AbortController | undefined>(undefined);
  const currentScope = useRef(scope);
  const seenRoots = useRef(new Set<string>());
  const merge = (next: LogEntry[]) =>
    setEntries((old) =>
      [
        ...new Map(
          [...old, ...next].map((entry) => [entry.event.id, entry]),
        ).values(),
      ].sort(
        (a, b) =>
          b.event.created_at - a.event.created_at ||
          Number(b.event.tags.find(([name]) => name === "ms")?.[1] ?? 0) -
            Number(a.event.tags.find(([name]) => name === "ms")?.[1] ?? 0) ||
          a.event.id.localeCompare(b.event.id),
      ),
    );
  async function load(olderMessages = false) {
    if (operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    const signal = AbortSignal.any([
      controller.signal,
      AbortSignal.timeout(30000),
    ]);
    setBusy(true);
    setError("");
    try {
      if (olderMessages) {
        const pending = messages[0];
        if (!pending) return;
        const next = await loadLogMessages(
          session,
          channel,
          pending.roots,
          signal,
          pending.cursor,
          currentScope.current,
        );
        if (controller.signal.aborted) return;
        merge(next.entries);
        setMessages((old) => [
          ...old.slice(1),
          ...(next.cursor
            ? [{ roots: pending.roots, cursor: next.cursor }]
            : []),
        ]);
      } else {
        const next = await loadReviewLog(
          session,
          channel,
          repository,
          pr,
          offset,
          signal,
          currentScope.current,
        );
        if (
          next.scope?.requests?.some(
            (request) => !currentScope.current?.requests?.includes(request),
          )
        )
          seenRoots.current.clear();
        currentScope.current = next.scope ?? currentScope.current;
        const roots = next.roots.filter((root) => !seenRoots.current.has(root));
        // Bound each relay predicate; each batch keeps its own reply cursor.
        const batches: (Awaited<ReturnType<typeof loadLogMessages>> & {
          roots: string[];
        })[] = [];
        for (let start = 0; start < roots.length; start += 100) {
          const batch = roots.slice(start, start + 100);
          const page = await loadLogMessages(
            session,
            channel,
            batch,
            signal,
            undefined,
            currentScope.current,
          );
          batches.push({ roots: batch, ...page });
        }
        if (controller.signal.aborted) return;
        for (const root of roots) seenRoots.current.add(root);
        merge([...next.entries, ...batches.flatMap((batch) => batch.entries)]);
        setOffset(offset + 100);
        setMore(next.more);
        setMessages((old) => [
          ...old,
          ...batches.flatMap(({ roots, cursor }) =>
            cursor ? [{ roots, cursor }] : [],
          ),
        ]);
      }
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          reason instanceof Error
            ? reason.message
            : "Could not read the review log.",
        );
    } finally {
      if (operation.current === controller) operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  // One on-demand read per opening; no background poll or separate subscription.
  // biome-ignore lint/correctness/useExhaustiveDependencies: This body is scoped to one PR and remounted when its disclosure opens.
  useEffect(() => {
    void load();
    return () => {
      operation.current?.abort();
      operation.current = undefined;
    };
  }, []);
  return (
    <section className="review-config-form" aria-label="Review timeline">
      <p className="text-caption text-subtle">
        Events and conversations for this submission, newest first. Expand an
        event for its full record. Close and reopen Log to refresh.
      </p>
      {entries.map(({ event, title, detail }) => (
        <div key={event.id} className="review-config-form">
          <p>
            <strong>{title}</strong> ·{" "}
            <time dateTime={new Date(event.created_at * 1000).toISOString()}>
              {new Date(event.created_at * 1000).toLocaleString()}
            </time>{" "}
            ·{" "}
            {session.profiles.snapshot().get(event.pubkey)?.name ??
              event.pubkey.slice(0, 12)}
          </p>
          {detail && <p className="review-config-instructions">{detail}</p>}
          {event.kind === 9 && (
            <a href={threadUrl(channel, event.id)}>Open message</a>
          )}
          <Accordion
            items={[
              {
                value: event.id,
                title: "Event details",
                content: (
                  <pre className="review-config-instructions">
                    {JSON.stringify(event, null, 2)}
                  </pre>
                ),
              },
            ]}
          />
        </div>
      ))}
      {busy && <p role="status">Loading review log…</p>}
      {error && <p role="alert">{error}</p>}
      {!busy && !error && !entries.length && <p>No saved review events yet.</p>}
      <div className="review-config-actions">
        {more && (
          <Button disabled={busy || offset > 10000} onClick={() => void load()}>
            Load earlier events
          </Button>
        )}
        {!!messages.length && (
          <Button disabled={busy} onClick={() => void load(true)}>
            Load earlier messages
          </Button>
        )}
      </div>
      {more && offset > 10000 && (
        <p role="alert">
          The relay’s history window was reached; this view is incomplete.
        </p>
      )}
      {!more && !messages.length && !busy && !error && (
        <p className="text-caption text-subtle">All available events loaded.</p>
      )}
    </section>
  );
}
