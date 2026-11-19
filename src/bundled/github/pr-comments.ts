import type { Host } from "../../features/host/service";
import {
  gitHubCli,
  gitHubDiff,
  gitHubRest,
  GitHubRestError,
  GhUnavailable,
  GitHubError,
} from "./gh";
import { parsePatch } from "../diffs/parse";

export type PullRef = Readonly<{ repository: string; number: number }>;
export type Side = "LEFT" | "RIGHT";
export type Snapshot = PullRef &
  Readonly<{
    pullId: string;
    viewer: string;
    head: string;
    base: string;
    diff: string;
    /** Open/unmerged only; GitHub still checks write permission. */
    writable: boolean;
    files: readonly { path: string; previousPath?: string | undefined }[];
  }>;
export type Anchor = Readonly<{
  head: string;
  base: string;
  path: string;
  side: Side;
  line: number;
}>;
export type Comment = Readonly<{
  id: string;
  databaseId: number;
  body: string;
  author: string;
  url: string;
  createdAt: string;
  commit: string | null;
  originalCommit: string | null;
}>;
export type Thread = Readonly<{
  id: string;
  path: string;
  side: Side;
  line: number | null;
  originalLine: number | null;
  outdated: boolean;
  resolved: boolean;
  rootCommentId: number;
  comments: readonly Comment[];
  commentsComplete: boolean;
  commentsCursor: string | null;
}>;
export type Page<T> = Readonly<{
  items: readonly T[];
  nextCursor: string | null;
}>;
export type WriteResult =
  | { status: "sent"; comment: Comment }
  | { status: "stale" }
  | { status: "failed"; error: PrCommentError }
  | { status: "unknown"; attempt: string };
export class PrCommentError extends Error {
  constructor(
    message: string,
    readonly kind:
      | "unavailable"
      | "forbidden"
      | "not-found"
      | "validation"
      | "rate-limited"
      | "transient",
  ) {
    super(message);
  }
}
export interface PrComments {
  loadSnapshot(pull: PullRef, signal?: AbortSignal): Promise<Snapshot>;
  loadThreads(
    pull: PullRef,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<Thread> & { head: string; base: string }>;
  loadComments(
    threadId: string,
    cursor?: string,
    signal?: AbortSignal,
  ): Promise<Page<Comment>>;
  create(
    snapshot: Snapshot,
    anchor: Anchor,
    body: string,
    operation: string,
  ): Promise<WriteResult>;
  reply(
    snapshot: Snapshot,
    rootCommentId: number,
    body: string,
    operation: string,
  ): Promise<WriteResult>;
  reconcile(
    attempt: string,
  ): Promise<Extract<WriteResult, { status: "sent" | "unknown" }>>;
}
function failure(error: unknown): PrCommentError {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof PrCommentError) return error;
  const graphType = error instanceof GitHubError ? error.type : undefined;
  const status =
    error instanceof GitHubRestError
      ? error.status
      : graphType === "FORBIDDEN"
        ? 403
        : graphType === "NOT_FOUND"
          ? 404
          : graphType === "RATE_LIMITED"
            ? 429
            : 0;
  const kind =
    /rate limit|secondary limit/i.test(message) || status === 429
      ? "rate-limited"
      : status === 401 || error instanceof GhUnavailable
        ? "unavailable"
        : status === 403
          ? "forbidden"
          : status === 404
            ? "not-found"
            : status === 400 || status === 422
              ? "validation"
              : "transient";
  return new PrCommentError(message, kind);
}
type Meta = {
  node_id: string;
  head: { sha: string };
  base: { sha: string };
  state: string;
  merged: boolean;
};
type RestComment = {
  node_id: string;
  id: number;
  body: string;
  user: { login: string } | null;
  html_url: string;
  created_at: string;
  commit_id: string | null;
  original_commit_id: string | null;
  path: string;
  side: Side;
  line: number | null;
  original_line: number | null;
  in_reply_to_id?: number;
};
const commentOf = (value: RestComment): Comment => ({
  id: value.node_id,
  databaseId: value.id,
  body: value.body,
  author: value.user?.login ?? "deleted user",
  url: value.html_url,
  createdAt: value.created_at,
  commit: value.commit_id,
  originalCommit: value.original_commit_id,
});
const commentFields =
  "id databaseId body author { login } url createdAt commit { oid } originalCommit { oid }";
type GraphComment = Omit<Comment, "author" | "commit" | "originalCommit"> & {
  author: { login: string } | null;
  commit: { oid: string } | null;
  originalCommit: { oid: string } | null;
};
type Connection<T> = {
  nodes: T[];
  pageInfo: { hasNextPage: boolean; endCursor: string | null };
};
const pageOf = <T>(connection: Connection<T>): Page<T> => ({
  items: connection.nodes,
  nextCursor: connection.pageInfo.hasNextPage
    ? connection.pageInfo.endCursor
    : null,
});
const graphComment = (comment: GraphComment): Comment => ({
  ...comment,
  author: comment.author?.login ?? "deleted user",
  commit: comment.commit?.oid ?? null,
  originalCommit: comment.originalCommit?.oid ?? null,
});

export function anchorInSnapshot(snapshot: Snapshot, anchor: Anchor): boolean {
  if (
    anchor.head !== snapshot.head ||
    anchor.base !== snapshot.base ||
    !Number.isSafeInteger(anchor.line) ||
    anchor.line < 1 ||
    !snapshot.files.some((file) => file.path === anchor.path)
  )
    return false;
  const files = snapshot.diff
    .split(/^(?=diff --git )/m)
    .flatMap((part) => parsePatch(part) ?? []);
  const file = files.find(
    (file) =>
      (file.newPath === "/dev/null" ? file.oldPath : file.newPath) ===
      anchor.path,
  );
  return (
    !!file &&
    !file.isBinary &&
    file.hunks.some((hunk) =>
      hunk.changes.some((change) =>
        change.type === "normal"
          ? (anchor.side === "LEFT"
              ? change.oldLineNumber
              : change.newLineNumber) === anchor.line
          : (change.type === "delete" ? "LEFT" : "RIGHT") === anchor.side &&
            change.lineNumber === anchor.line,
      ),
    )
  );
}

/** One instance owns delivery attempts for the plugin session, across panel remounts. */
export function createPrComments(
  host: Pick<Host, "spawn">,
): PrComments | undefined {
  const availableRest = gitHubRest(host),
    gh = gitHubCli(host),
    diff = gitHubDiff(host);
  if (!availableRest || !gh || !diff) return undefined;
  const rest = availableRest;
  const endpoint = (pull: PullRef) => {
    if (
      !/^[\w.-]+\/[\w.-]+$/.test(pull.repository) ||
      !Number.isSafeInteger(pull.number) ||
      pull.number < 1
    )
      throw new PrCommentError("Unsupported pull request", "validation");
    return `repos/${pull.repository}/pulls/${pull.number}`;
  };
  const meta = (pull: PullRef, signal?: AbortSignal) =>
    rest<Meta>("GET", endpoint(pull), undefined, signal);
  const viewer = async () =>
    (await rest<{ login: string }>("GET", "user")).login;
  async function allComments(pull: PullRef): Promise<RestComment[]> {
    const result: RestComment[] = [];
    for (let page = 1; page <= 100; page++) {
      const rows = await rest<RestComment[]>(
        "GET",
        `${endpoint(pull)}/comments?per_page=100&page=${page}`,
      );
      result.push(...rows);
      if (rows.length < 100) return result;
    }
    throw new PrCommentError(
      "Too many comments to verify delivery safely",
      "validation",
    );
  }
  type Attempt = {
    snapshot: Snapshot;
    anchor: Anchor | undefined;
    root: number | undefined;
    body: string;
    key: string;
    baseline: Set<number>;
    result: Promise<WriteResult>;
  };
  const attempts = new Map<string, Attempt>();
  const keys = new Map<string, string>();
  const operations = new Map<string, string>();
  async function send(
    snapshot: Snapshot,
    anchor: Anchor | undefined,
    root: number | undefined,
    body: string,
    operation: string,
  ): Promise<WriteResult> {
    if (
      !body.trim() ||
      !snapshot.writable ||
      (anchor && !anchorInSnapshot(snapshot, anchor)) ||
      (root !== undefined && (!Number.isSafeInteger(root) || root < 1))
    )
      return {
        status: "failed",
        error: new PrCommentError(
          "Choose a commentable line in the current PR diff",
          "validation",
        ),
      };
    const key = JSON.stringify([
      snapshot.repository.toLowerCase(),
      snapshot.number,
      snapshot.viewer,
      anchor ?? root,
      body,
    ]);
    const operationKey = JSON.stringify([
      snapshot.repository.toLowerCase(),
      snapshot.number,
      snapshot.viewer,
      operation,
    ]);
    const priorOperation = operations.get(operationKey);
    if (priorOperation) {
      const prior = attempts.get(priorOperation);
      if (prior)
        return prior.key === key
          ? prior.result
          : {
              status: "failed",
              error: new PrCommentError(
                "Submission changed while delivery was pending",
                "validation",
              ),
            };
    }
    const existing = keys.get(key);
    if (existing) {
      const attempt = attempts.get(existing);
      if (attempt) return attempt.result;
    }
    const id = crypto.randomUUID();
    // Register before the first await so other panels share the same operation.
    let finish: (result: WriteResult) => void = () => {};
    const result = new Promise<WriteResult>((resolve) => {
      finish = resolve;
    });
    const attempt: Attempt = {
      snapshot,
      anchor,
      root,
      body,
      key,
      baseline: new Set(),
      result,
    };
    operations.set(operationKey, id);
    keys.set(key, id);
    attempts.set(id, attempt);
    let dispatched = false;
    try {
      const previous = await allComments(snapshot);
      attempt.baseline = new Set(previous.map((comment) => comment.id));
      const current = await meta(snapshot);
      if (
        current.node_id !== snapshot.pullId ||
        current.head.sha !== snapshot.head ||
        current.base.sha !== snapshot.base ||
        current.state !== "open" ||
        current.merged
      ) {
        finish({ status: "stale" });
        keys.delete(key);
        operations.delete(operationKey);
        attempts.delete(id);
        return result;
      }
      if ((await viewer()) !== snapshot.viewer)
        throw new PrCommentError(
          "GitHub account changed; reload before posting",
          "forbidden",
        );
      if (
        root !== undefined &&
        !previous.some(
          (comment) => comment.id === root && !comment.in_reply_to_id,
        )
      )
        throw new PrCommentError(
          "Reply thread no longer exists in this PR",
          "validation",
        );
      dispatched = true;
      const created = await rest<RestComment>(
        "POST",
        root === undefined
          ? `${endpoint(snapshot)}/comments`
          : `${endpoint(snapshot)}/comments/${root}/replies`,
        anchor
          ? {
              body,
              commit_id: anchor.head,
              path: anchor.path,
              side: anchor.side,
              line: anchor.line,
            }
          : { body },
      );
      if (!created.id || !created.html_url)
        throw new Error("GitHub did not return a comment receipt");
      finish({ status: "sent", comment: commentOf(created) });
      keys.delete(key);
    } catch (error) {
      const definite =
        !dispatched ||
        error instanceof GhUnavailable ||
        (error instanceof GitHubRestError &&
          [400, 401, 403, 404, 422, 429].includes(error.status));
      if (definite) {
        finish({
          status: "failed",
          error: error instanceof PrCommentError ? error : failure(error),
        });
        keys.delete(key);
        operations.delete(operationKey);
        attempts.delete(id);
      } else finish({ status: "unknown", attempt: id });
    }
    return result;
  }
  return {
    async loadSnapshot(pull, signal) {
      try {
        const before = await meta(pull, signal);
        const identity = await viewer();
        const files: { path: string; previousPath?: string | undefined }[] = [];
        for (let page = 1; page <= 30; page++) {
          const rows = await rest<
            { filename: string; previous_filename?: string }[]
          >(
            "GET",
            `${endpoint(pull)}/files?per_page=100&page=${page}`,
            undefined,
            signal,
          );
          files.push(
            ...rows.map((row) => ({
              path: row.filename,
              previousPath: row.previous_filename,
            })),
          );
          if (rows.length < 100) break;
          if (page === 30)
            throw new PrCommentError(
              "PR has too many files to verify anchors",
              "validation",
            );
        }
        const content = await diff(
          {
            repository: pull.repository,
            head: before.head.sha,
            base: before.base.sha,
            merged: pull.number,
          },
          signal,
        );
        const after = await meta(pull, signal);
        if (
          before.node_id !== after.node_id ||
          before.head.sha !== after.head.sha ||
          before.base.sha !== after.base.sha
        )
          throw new PrCommentError(
            "PR changed while loading; refresh the diff",
            "transient",
          );
        return {
          ...pull,
          pullId: before.node_id,
          viewer: identity,
          head: before.head.sha,
          base: before.base.sha,
          diff: content,
          files,
          writable: before.state === "open" && !before.merged,
        };
      } catch (error) {
        signal?.throwIfAborted();
        throw failure(error);
      }
    },
    async loadThreads(pull, cursor, signal) {
      try {
        type Row = Omit<
          Thread,
          | "side"
          | "outdated"
          | "resolved"
          | "rootCommentId"
          | "comments"
          | "commentsComplete"
          | "commentsCursor"
        > & {
          diffSide: Side;
          isOutdated: boolean;
          isResolved: boolean;
          comments: Connection<GraphComment>;
        };
        const [owner, name] = pull.repository.split("/");
        const data = await gh<{
          repository: {
            pullRequest: {
              headRefOid: string;
              baseRefOid: string;
              reviewThreads: Connection<Row>;
            };
          };
        }>(
          `query($owner:String!,$name:String!,$number:Int!,$cursor:String){repository(owner:$owner,name:$name){pullRequest(number:$number){headRefOid baseRefOid reviewThreads(first:100,after:$cursor){nodes{id path diffSide line originalLine isOutdated isResolved comments(first:100){nodes{${commentFields}} pageInfo{hasNextPage endCursor}}} pageInfo{hasNextPage endCursor}}}}}`,
          { owner, name, number: pull.number, cursor: cursor ?? null },
          signal,
        );
        if (!data.repository?.pullRequest)
          throw new PrCommentError("Pull request is unavailable", "not-found");
        const page = pageOf(data.repository.pullRequest.reviewThreads);
        return {
          head: data.repository.pullRequest.headRefOid,
          base: data.repository.pullRequest.baseRefOid,
          nextCursor: page.nextCursor,
          items: page.items.map((row) => ({
            ...row,
            side: row.diffSide,
            outdated: row.isOutdated,
            resolved: row.isResolved,
            rootCommentId: row.comments.nodes[0]?.databaseId ?? 0,
            comments: row.comments.nodes.map(graphComment),
            commentsComplete: !row.comments.pageInfo.hasNextPage,
            commentsCursor: row.comments.pageInfo.hasNextPage
              ? row.comments.pageInfo.endCursor
              : null,
          })),
        };
      } catch (error) {
        signal?.throwIfAborted();
        throw failure(error);
      }
    },
    async loadComments(threadId, cursor, signal) {
      try {
        const data = await gh<{ node: { comments: Connection<GraphComment> } }>(
          `query($id:ID!,$cursor:String){node(id:$id){... on PullRequestReviewThread{comments(first:100,after:$cursor){nodes{${commentFields}} pageInfo{hasNextPage endCursor}}}}}`,
          { id: threadId, cursor: cursor ?? null },
          signal,
        );
        if (!data.node?.comments)
          throw new PrCommentError(
            "Comment thread is unavailable",
            "not-found",
          );
        const page = pageOf(data.node.comments);
        return { ...page, items: page.items.map(graphComment) };
      } catch (error) {
        signal?.throwIfAborted();
        throw failure(error);
      }
    },
    create: (snapshot, anchor, body, operation) =>
      send(snapshot, anchor, undefined, body, operation),
    reply: (snapshot, root, body, operation) =>
      send(snapshot, undefined, root, body, operation),
    async reconcile(id) {
      const attempt = attempts.get(id);
      if (!attempt) return { status: "unknown", attempt: id };
      const prior = await attempt.result;
      if (prior.status === "sent") return prior;
      try {
        if ((await viewer()) !== attempt.snapshot.viewer)
          return { status: "unknown", attempt: id };
        const matches = (await allComments(attempt.snapshot)).filter(
          (comment) =>
            !attempt.baseline.has(comment.id) &&
            comment.user?.login === attempt.snapshot.viewer &&
            comment.body === attempt.body &&
            (attempt.root !== undefined
              ? comment.in_reply_to_id === attempt.root
              : !comment.in_reply_to_id &&
                comment.path === attempt.anchor?.path &&
                comment.side === attempt.anchor.side &&
                comment.original_line === attempt.anchor.line &&
                comment.original_commit_id === attempt.anchor.head),
        );
        if (matches.length === 1 && matches[0]) {
          const sent = {
            status: "sent",
            comment: commentOf(matches[0]),
          } as const;
          attempt.result = Promise.resolve(sent);
          keys.delete(attempt.key);
          return sent;
        }
      } catch {
        /* A failed read proves nothing about a write. */
      }
      return { status: "unknown", attempt: id };
    },
  };
}
