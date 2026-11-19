import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { Select } from "../../shared/design-system/ui/Select";
import {
  DiffViewer,
  type DiffComments,
  type DiffLine,
} from "../diffs/DiffViewer";
import { parsePatch } from "../diffs/parse";
import { InlineCommentForm } from "./InlineCommentForm";
import type { InlineDeliveryStore } from "./inline-delivery";
import {
  anchorInSnapshot,
  type Anchor,
  type PrComments,
  type PullRef,
  type Snapshot,
  type Thread,
  type WriteResult,
} from "./pr-comments";
import { readable } from "./object";
import styles from "./InlineComments.module.css";

type InlineTarget = Anchor & { viewer: string; replyTo?: number | undefined };
type Composer = { body: string; target: InlineTarget; operation: string };

const rowKey = (path: string, side: string, line: number) =>
  JSON.stringify([path, side, line]);
export function PrFiles({
  api,
  pull,
  head,
  base,
  delivery,
}: {
  api: PrComments;
  pull: PullRef;
  head: string;
  base: string;
  delivery: InlineDeliveryStore;
}) {
  const status = useSyncExternalStore(delivery.subscribe, delivery.get);
  const [composer, setComposer] = useState<Composer>();
  const [snapshot, setSnapshot] = useState<Snapshot>();
  const snapshotRef = useRef<Snapshot | undefined>(undefined);
  const threadVersion = useRef(0);
  const [threads, setThreads] = useState<readonly Thread[]>([]);
  const [error, setError] = useState<string>();
  const [threadError, setThreadError] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [commentsLoading, setCommentsLoading] = useState(true);
  const [layout, setLayout] = useState<"unified" | "split">("unified");
  const [choice, setChoice] = useState<{ path: string; lines: DiffLine[] }>();
  const [available, setAvailable] = useState<ReadonlySet<string>>(new Set());
  const returnFocus = useRef<() => void>(() => {});
  const refreshButton = useRef<HTMLButtonElement>(null);
  const restoreFocus = () => {
    returnFocus.current();
    if (document.activeElement === document.body)
      refreshButton.current?.focus();
  };
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const availability = useCallback((path: string, ready: boolean) => {
    setAvailable((previous) => {
      if (previous.has(path) === ready) return previous;
      const next = new Set(previous);
      if (ready) next.add(path);
      else next.delete(path);
      return next;
    });
  }, []);
  const readThreads = useCallback(
    async (current: Snapshot, signal?: AbortSignal) => {
      const result: Thread[] = [];
      let cursor: string | undefined;
      const seen = new Set<string>();
      do {
        const page = await api.loadThreads(current, cursor, signal);
        if (page.head !== current.head || page.base !== current.base)
          throw new Error(
            "PR changed while loading comments; refresh changes.",
          );
        result.push(...page.items);
        cursor = page.nextCursor ?? undefined;
        if (cursor && seen.has(cursor))
          throw new Error("GitHub repeated a comment page; refresh changes.");
        if (cursor) seen.add(cursor);
      } while (cursor);
      return result;
    },
    [api],
  );
  const { repository, number } = pull;
  // biome-ignore lint/correctness/useExhaustiveDependencies: PR revisions and explicit refresh invalidate the remote snapshot.
  useEffect(() => {
    const controller = new AbortController();
    const version = ++threadVersion.current;
    snapshotRef.current = undefined;
    setSnapshot(undefined);
    setAvailable(new Set());
    setChoice(undefined);
    setComposer(undefined);
    setLoading(true);
    setCommentsLoading(true);
    setError(undefined);
    setThreads([]);
    void api
      .loadSnapshot({ repository, number }, controller.signal)
      .then(
        async (current) => {
          if (controller.signal.aborted) return;
          snapshotRef.current = current;
          setSnapshot(current);
          setLoading(false);
          try {
            const rows = await readThreads(current, controller.signal);
            if (
              !controller.signal.aborted &&
              threadVersion.current === version
            ) {
              setThreads(rows);
              setThreadError(undefined);
            }
          } catch (failure) {
            if (!controller.signal.aborted && threadVersion.current === version)
              setThreadError(readable(failure).message);
          }
        },
        (failure) => {
          if (!controller.signal.aborted) setError(readable(failure).message);
        },
      )
      .finally(() => {
        if (!controller.signal.aborted) {
          setLoading(false);
          if (threadVersion.current === version) setCommentsLoading(false);
        }
      });
    return () => controller.abort();
  }, [api, repository, number, head, base, revision, readThreads]);
  const parts = useMemo(
    () =>
      snapshot?.diff
        .split(/^(?=diff --git )/m)
        .filter((part) => part.trim())
        .map((content) => ({ content, files: parsePatch(content) })),
    [snapshot],
  );
  const stale =
    !!composer &&
    (!snapshot ||
      composer.target.head !== snapshot.head ||
      composer.target.base !== snapshot.base ||
      composer.target.viewer !== snapshot.viewer);
  const mapped = (thread: Thread) =>
    !!snapshot &&
    !loading &&
    !thread.outdated &&
    thread.line !== null &&
    available.has(thread.path) &&
    anchorInSnapshot(snapshot, {
      ...thread,
      line: thread.line,
      head: snapshot.head,
      base: snapshot.base,
    });
  const targetMapped =
    !!composer &&
    !stale &&
    !loading &&
    available.has(composer.target.path) &&
    !!snapshot &&
    anchorInSnapshot(snapshot, composer.target);
  function choose(path: string, line: DiffLine, replyTo?: number) {
    if (!snapshot || status.busy || status.unknown || loading) return;
    setComposer({
      body: "",
      operation: crypto.randomUUID(),
      target: {
        path,
        side: line.side === "deletions" ? "LEFT" : "RIGHT",
        line: line.lineNumber,
        head: snapshot.head,
        base: snapshot.base,
        viewer: snapshot.viewer,
        replyTo,
      },
    });
    delivery.update({ error: undefined, sentUrl: undefined });
    setChoice(undefined);
  }
  async function applyResult(
    result: WriteResult,
    current: Snapshot | undefined,
  ) {
    if (result.status === "sent") {
      delivery.update({
        busy: false,
        unknown: false,
        attempt: undefined,
        error: undefined,
        sentUrl: result.comment.url,
      });
      if (alive.current) {
        setComposer(undefined);
        restoreFocus();
      }
      if (!current || !alive.current || snapshotRef.current !== current) return;
      const version = ++threadVersion.current;
      try {
        const rows = await readThreads(current);
        if (
          alive.current &&
          snapshotRef.current === current &&
          threadVersion.current === version
        ) {
          setThreads(rows);
          setThreadError(undefined);
        }
      } catch (failure) {
        if (
          alive.current &&
          snapshotRef.current === current &&
          threadVersion.current === version
        )
          setThreadError(
            `Comment sent. Refresh failed: ${readable(failure).message}`,
          );
      } finally {
        if (
          alive.current &&
          snapshotRef.current === current &&
          threadVersion.current === version
        )
          setCommentsLoading(false);
      }
    } else if (result.status === "unknown") {
      delivery.update({
        busy: false,
        unknown: true,
        attempt: result.attempt,
        error:
          "Delivery unknown. Check delivery before trying another submission.",
      });
    } else if (result.status === "stale") {
      delivery.update({
        busy: false,
        error: "PR changed. Select a line again in the refreshed diff.",
      });
      if (alive.current) setRevision((previous) => previous + 1);
    } else delivery.update({ busy: false, error: result.error.message });
  }
  async function submit() {
    if (
      !snapshot ||
      !composer?.body.trim() ||
      stale ||
      loading ||
      (!targetMapped && !composer?.target.replyTo)
    )
      return;
    if (!delivery.begin()) return;
    const { target, body, operation } = composer;
    try {
      const result =
        target.replyTo === undefined
          ? await api.create(snapshot, target, body, operation)
          : await api.reply(snapshot, target.replyTo, body, operation);
      await applyResult(result, snapshot);
    } catch (failure) {
      // An unexpected rejection cannot establish whether a mutation happened.
      delivery.update({
        busy: false,
        unknown: true,
        error: `Delivery unknown: ${readable(failure).message}`,
      });
    }
  }
  async function reconcile() {
    if (!status.attempt || status.busy) return;
    delivery.update({ busy: true });
    try {
      await applyResult(await api.reconcile(status.attempt), snapshot);
    } catch (failure) {
      delivery.update({ busy: false, error: readable(failure).message });
    }
  }
  const form = (
    <InlineCommentForm
      body={composer?.body ?? ""}
      busy={status.busy}
      blocked={
        !!stale ||
        loading ||
        status.unknown ||
        !snapshot ||
        (!targetMapped && !composer?.target.replyTo)
      }
      notice={stale ? "Select a line again in the latest diff." : undefined}
      onChange={(body) => {
        if (!delivery.get().busy && !delivery.get().unknown)
          setComposer((current) => current && { ...current, body });
      }}
      onSubmit={() => void submit()}
      onCancel={() => {
        setComposer(undefined);
        restoreFocus();
      }}
    />
  );
  async function more(thread: Thread) {
    if (!thread.commentsCursor || !snapshot) return;
    const current = snapshot;
    try {
      const page = await api.loadComments(thread.id, thread.commentsCursor);
      // Re-read the owning thread's snapshot before attaching another page.
      const rows = await readThreads(current);
      const owning = rows.find((row) => row.id === thread.id);
      if (
        !owning ||
        owning.path !== thread.path ||
        owning.side !== thread.side ||
        owning.rootCommentId !== thread.rootCommentId ||
        owning.commentsCursor !== thread.commentsCursor ||
        owning.line !== thread.line ||
        owning.outdated !== thread.outdated
      )
        throw new Error("Thread changed; refresh changes.");
      if (alive.current && snapshotRef.current === current)
        setThreads((previous) =>
          previous.map((row) =>
            row.id === thread.id && row.commentsCursor === thread.commentsCursor
              ? {
                  ...row,
                  comments: [
                    ...row.comments,
                    ...page.items.filter(
                      (comment) =>
                        !row.comments.some(
                          (existing) => existing.id === comment.id,
                        ),
                    ),
                  ],
                  commentsComplete: !page.nextCursor,
                  commentsCursor: page.nextCursor,
                }
              : row,
          ),
        );
    } catch (failure) {
      if (alive.current && snapshotRef.current === current)
        setThreadError(readable(failure).message);
    }
  }
  function threadView(thread: Thread) {
    return (
      <section
        key={thread.id}
        className={styles.thread}
        aria-label={`Comments on ${thread.path}`}
      >
        <p>
          {thread.path} ·{" "}
          {thread.outdated
            ? "Outdated"
            : thread.line === null
              ? "Not on a displayed line"
              : `${thread.side === "LEFT" ? "Old" : "New"} line ${thread.line}`}
          {thread.resolved ? " · Resolved" : ""}
        </p>
        {thread.comments.map((comment) => (
          <article key={comment.id}>
            <a
              href={comment.url}
              target="_blank"
              rel="noreferrer"
              className="text-link"
            >
              {comment.author}
            </a>
            <p className={styles.body}>{comment.body}</p>
          </article>
        ))}
        {!thread.commentsComplete && (
          <Button size="sm" onClick={() => void more(thread)}>
            Load more replies
          </Button>
        )}
        <Button
          size="sm"
          disabled={
            !snapshot ||
            loading ||
            status.busy ||
            status.unknown ||
            !thread.rootCommentId
          }
          onClick={(event) => {
            const button = event.currentTarget;
            returnFocus.current = () => button.focus();
            choose(
              thread.path,
              {
                side: thread.side === "LEFT" ? "deletions" : "additions",
                lineNumber: thread.line ?? 0,
              },
              thread.rootCommentId,
            );
          }}
        >
          Reply
        </Button>
      </section>
    );
  }
  const annotations = new Map<
    string,
    {
      path: string;
      side: DiffLine["side"];
      lineNumber: number;
      content: ReactNode[];
    }
  >();
  function annotate(
    target: Pick<InlineTarget, "path" | "side" | "line">,
    content: ReactNode,
  ) {
    const key = rowKey(target.path, target.side, target.line);
    let row = annotations.get(key);
    if (!row) {
      row = {
        path: target.path,
        side: target.side === "LEFT" ? "deletions" : "additions",
        lineNumber: target.line,
        content: [],
      };
      annotations.set(key, row);
    }
    row.content.push(content);
  }
  for (const thread of threads)
    if (mapped(thread) && thread.line !== null)
      annotate({ ...thread, line: thread.line }, threadView(thread));
  if (composer && targetMapped)
    annotate(composer.target, <div key="composer">{form}</div>);
  const comments: DiffComments = {
    annotations: [...annotations.values()],
    onAvailabilityChange: availability,
    onSelect(path, lines, restoreFocus) {
      if (
        !snapshot?.files.some((file) => file.path === path) ||
        status.busy ||
        status.unknown ||
        loading
      )
        return;
      returnFocus.current = restoreFocus;
      if (lines.length === 1 && lines[0]) choose(path, lines[0]);
      else setChoice({ path, lines });
    },
  };
  return (
    <div className={styles.files}>
      <div className={styles.actions}>
        <Button
          size="sm"
          ref={refreshButton}
          disabled={loading || status.busy}
          onClick={() => setRevision((previous) => previous + 1)}
        >
          Refresh changes
        </Button>
        <Select
          label="Diff layout"
          value={layout}
          size="sm"
          groups={[
            {
              label: "Layout",
              options: [
                { value: "unified", label: "Unified" },
                { value: "split", label: "Split" },
              ],
            },
          ]}
          onValueChange={(value) =>
            setLayout(value === "split" ? "split" : "unified")
          }
        />
      </div>
      {choice && (
        <section className={styles.actions} aria-label="Choose comment side">
          {choice.lines.map((line) => (
            <Button
              key={line.side}
              size="sm"
              onClick={() => choose(choice.path, line)}
            >
              {line.side === "deletions" ? "Old" : "New"} line {line.lineNumber}
            </Button>
          ))}
        </section>
      )}
      {status.sentUrl && (
        <p role="status">
          Comment sent.{" "}
          <a
            className="text-link"
            href={status.sentUrl}
            target="_blank"
            rel="noreferrer"
          >
            View on GitHub
          </a>
        </p>
      )}
      {status.busy && (
        <p role="status">
          {status.unknown ? "Checking delivery…" : "Posting comment…"}
        </p>
      )}
      {status.error && <p role="alert">{status.error}</p>}
      {status.unknown && (
        <div className={styles.actions}>
          <Button
            size="sm"
            disabled={status.busy || !status.attempt}
            onClick={() => void reconcile()}
          >
            Check delivery
          </Button>
        </div>
      )}
      {composer && !targetMapped && form}
      {error && <p role="alert">{error}</p>}
      {threadError && <p role="alert">{threadError}</p>}
      <LoadingRegion pending={loading} label="Loading GitHub changes…">
        {parts?.map((part) => (
          <DiffViewer
            key={part.content.split("\n", 1)[0]}
            content={part.content}
            files={part.files}
            viewType={layout}
            comments={comments}
          />
        ))}
        {parts?.length === 0 && <p>No file changes.</p>}
      </LoadingRegion>
      <LoadingRegion pending={commentsLoading} label="Loading comments…">
        {threads.filter((thread) => !mapped(thread)).map(threadView)}
      </LoadingRegion>
    </div>
  );
}
