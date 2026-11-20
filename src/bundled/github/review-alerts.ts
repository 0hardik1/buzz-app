// Desktop alerts for the GitHub notifications meant for the person by name: a
// review requested from them, not only from a team they're on or because
// CODEOWNERS lists them, and an @mention of them, not of a team. Each has its own switch
// in Settings → Notifications.
//
// GitHub pushes nothing to a desktop, so this reads the person's notifications
// as often as GitHub's X-Poll-Interval asks, sending the last ETag: a read that
// finds nothing new is a 304, which costs none of the rate limit. A new review
// request costs one GraphQL read, to see whom it asks.
import type { Notifications } from "../../features/notifications/service";
import type { GitHubCli, GitHubNotifications, GitHubThread } from "./gh";

export const REVIEW_REQUESTED = {
  id: "github-review-requested",
  label: "GitHub reviews requested from you",
};
export const MENTIONED = {
  id: "github-mentioned",
  label: "GitHub mentions of you",
};

const STORAGE_KEY = "buzz.github.review-alerts.v1";
/** GitHub asks for 60 seconds; never read more often than that. */
export const MIN_POLL_MS = 60_000;
/** The longest wait after reads keep failing, as while `gh` is signed out. */
export const MAX_BACKOFF_MS = 15 * 60_000;
/** A notification first seen this long after it was updated, as after a
 * week away, is noted but not alerted. */
export const STALE_MS = 24 * 60 * 60_000;

/** What was last decided about an unread notification. */
type Seen = Readonly<{ reason: string; updated: string; alerted: boolean }>;

const PULL_API =
  /^https:\/\/api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)\/(?:pulls|issues)\/(\d+)$/;

const REQUESTED = `query($owner: String!, $name: String!, $number: Int!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      reviewRequests(first: 100) {
        nodes {
          asCodeOwner
          requestedReviewer { __typename ... on User { login } }
        }
      }
    }
  }
}`;

type Requested = {
  viewer: { login: string };
  repository: {
    pullRequest: {
      reviewRequests: {
        nodes: ({
          asCodeOwner: boolean;
          requestedReviewer: { login?: string } | null;
        } | null)[];
      };
    } | null;
  } | null;
};

function load(): Map<string, Seen> | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
    if (!Array.isArray(value)) return undefined;
    return new Map(
      value.filter(
        (entry): entry is [string, Seen] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          typeof entry[1]?.reason === "string" &&
          typeof entry[1].updated === "string" &&
          typeof entry[1].alerted === "boolean",
      ),
    );
  } catch {
    return undefined;
  }
}

function save(seen: Map<string, Seen>) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...seen]));
  } catch (error) {
    console.warn("GitHub alerts' progress was not saved", error);
  }
}

/** Alerts for new review requests and mentions until the returned function
 * is called. Nothing is read where `gh` cannot run. */
export function watchReviewAlerts(
  notifications: Pick<Notifications, "register">,
  read: GitHubNotifications | undefined,
  gh: GitHubCli | undefined,
): () => void {
  if (!read || !gh) return () => {};
  const review = notifications.register(REVIEW_REQUESTED);
  const mention = notifications.register(MENTIONED);
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  // The first read ever only notes what is already there: nobody wants an
  // alert for every review request they've left unread.
  let seen = load();
  let etag: string | undefined;
  let backoff = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Whether the review requested on `thread`'s pull request names the
   * person: not only a team, and not because CODEOWNERS lists them. */
  const requestsViewer = async (thread: GitHubThread) => {
    const match = PULL_API.exec(thread.subject.url ?? "");
    if (thread.subject.type !== "PullRequest" || !match) return false;
    const [, owner, name, number] = match;
    const data = await gh<Requested>(
      REQUESTED,
      { owner, name, number: Number(number) },
      signal,
    );
    const viewer = data.viewer.login.toLowerCase();
    return (
      data.repository?.pullRequest?.reviewRequests.nodes.some(
        (node) =>
          !node?.asCodeOwner &&
          node?.requestedReviewer?.login?.toLowerCase() === viewer,
      ) ?? false
    );
  };

  const alert = (thread: GitHubThread, kind: "review" | "mention") => {
    const number = PULL_API.exec(thread.subject.url ?? "")?.[3];
    const name = thread.repository.full_name.split("/")[1];
    void (kind === "review" ? review : mention)
      .submit({
        sourceKey: `${thread.id}:${thread.updated_at}`,
        target: { version: 1, kind: "home" },
        title: kind === "review" ? "Review requested" : "Mentioned on GitHub",
        body: number
          ? `${name}#${number} · ${thread.subject.title}`
          : `${thread.repository.full_name} · ${thread.subject.title}`,
      })
      .catch(() => undefined);
  };

  /** One read. Returns how long GitHub asks to wait before the next. */
  const poll = async () => {
    const answer = await read(etag, signal);
    const wait = Math.max(MIN_POLL_MS, (answer.poll ?? 0) * 1000);
    if (answer.status === "unchanged") return wait;
    const quietly = !seen;
    const previous = seen ?? new Map<string, Seen>();
    const next = new Map<string, Seen>();
    let complete = true;
    for (const thread of answer.threads) {
      const kind =
        thread.reason === "review_requested"
          ? "review"
          : thread.reason === "mention"
            ? "mention"
            : undefined;
      const before = previous.get(thread.id);
      // Decided already: alerted for this reason, or not alerted and nothing
      // happened since. A team's request that later names the person is a
      // new update, so it is asked again.
      if (
        before?.reason === thread.reason &&
        (before.alerted || before.updated === thread.updated_at)
      ) {
        next.set(thread.id, before);
        continue;
      }
      let wanted = false;
      try {
        wanted =
          kind === "mention" ||
          (kind === "review" && (await requestsViewer(thread)));
      } catch (error) {
        if (signal.aborted) throw error;
        // Asked again on the next read, which must not be a 304.
        complete = false;
        continue;
      }
      const stale =
        Date.now() - Date.parse(thread.updated_at) > STALE_MS ||
        Number.isNaN(Date.parse(thread.updated_at));
      if (wanted && kind && !quietly && !stale) alert(thread, kind);
      next.set(thread.id, {
        reason: thread.reason,
        updated: thread.updated_at,
        alerted: wanted,
      });
    }
    // A first read that could not decide everything stays the first, so
    // what was already there never alerts.
    if (signal.aborted || (quietly && !complete)) return wait;
    // A notification read on GitHub leaves the list; if it comes back, it
    // is new.
    seen = next;
    save(next);
    etag = complete ? answer.etag : undefined;
    return wait;
  };

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      poll().then(
        (wait) => {
          backoff = 0;
          if (!signal.aborted) schedule(wait);
        },
        () => {
          if (signal.aborted) return;
          backoff = Math.min(
            MAX_BACKOFF_MS,
            backoff ? backoff * 2 : MIN_POLL_MS,
          );
          schedule(backoff);
        },
      );
    }, delay);
  };
  // Spread out first reads, as after an update relaunches every app at once.
  schedule(Math.random() * 10_000);
  return () => {
    lifetime.abort();
    clearTimeout(timer);
  };
}
