// Desktop alerts for GitHub notifications. The person chooses which kinds
// alert in the GitHub settings card (reviews requested from them, from their
// teams or because they're a code owner; mentions of them or of their teams),
// and can turn them all off under GitHub in Settings → Notifications.
//
// GitHub pushes nothing to a desktop, so this reads the person's notifications
// once a minute, sending the last ETag: a read that finds nothing new is a 304,
// which costs none of the rate limit. A new review request costs one GraphQL
// read, to see whom it asks.
import type { Notifications } from "../../features/notifications/service";
import { type AlertChoices, alertChoices } from "./alert-preferences";
import type { GitHubCli, GitHubNotifications, GitHubThread } from "./gh";

export const GITHUB_ALERTS = { id: "github", label: "GitHub" };

const STORAGE_KEY = "buzz.github.review-alerts.v1";
/** GitHub asks clients to read notifications at most once a minute. */
export const POLL_MS = 60_000;
/** The longest wait after reads keep failing, as while `gh` is signed out. */
export const MAX_BACKOFF_MS = 15 * 60_000;
/** A notification first seen this long after it was updated, as after a
 * week away, is noted but not alerted. */
export const STALE_MS = 24 * 60 * 60_000;

/** What was last decided about an unread notification: `done` once alerted
 * (or noted on the first run), never asked about again while it stays
 * unread; otherwise asked about again when it is next updated. */
type Seen = Readonly<{ reason: string; updated: string; done: boolean }>;

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
          requestedReviewer: { __typename: string; login?: string } | null;
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
          typeof entry[1].done === "boolean",
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

/** Alerts for the GitHub notifications the person chose until the returned
 * function is called. Nothing is read where `gh` cannot run. */
export function watchReviewAlerts(
  notifications: Pick<Notifications, "register">,
  read: GitHubNotifications | undefined,
  gh: GitHubCli | undefined,
): () => void {
  if (!read || !gh) return () => {};
  const category = notifications.register(GITHUB_ALERTS);
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let seen = load();
  let etag: string | undefined;
  let backoff = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;

  /** Whom the review requested on `thread`'s pull request asks. GitHub has
   * no field for whether the person is on a requested team, but it only
   * notifies them of a team's request when they are. */
  const requested = async (thread: GitHubThread) => {
    const match = PULL_API.exec(thread.subject.url ?? "");
    if (thread.subject.type !== "PullRequest" || !match) return undefined;
    const [, owner, name, number] = match;
    const data = await gh<Requested>(
      REQUESTED,
      { owner, name, number: Number(number) },
      signal,
    );
    const viewer = data.viewer.login.toLowerCase();
    const nodes = data.repository?.pullRequest?.reviewRequests.nodes ?? [];
    const you = (node: (typeof nodes)[number]) =>
      node?.requestedReviewer?.login?.toLowerCase() === viewer;
    const team = (node: (typeof nodes)[number]) =>
      node?.requestedReviewer?.__typename === "Team";
    return {
      you: nodes.some((node) => !node?.asCodeOwner && you(node)),
      team: nodes.some((node) => !node?.asCodeOwner && team(node)),
      codeOwner: nodes.some(
        (node) => node?.asCodeOwner && (you(node) || team(node)),
      ),
    };
  };

  /** The alert's title, if `thread` is a kind the person chose. */
  const title = async (thread: GitHubThread, choices: AlertChoices) => {
    if (thread.reason === "mention")
      return choices.mention ? "Mentioned on GitHub" : undefined;
    if (thread.reason === "team_mention")
      return choices.teamMention ? "Your team was mentioned" : undefined;
    if (
      thread.reason !== "review_requested" ||
      !(choices.review || choices.teamReview || choices.codeOwnerReview)
    )
      return undefined;
    const asks = await requested(thread);
    if (choices.review && asks?.you) return "Review requested";
    if (choices.codeOwnerReview && asks?.codeOwner)
      return "Review requested from a code owner";
    if (choices.teamReview && asks?.team)
      return "Review requested from your team";
    return undefined;
  };

  const alert = (thread: GitHubThread, title: string) => {
    const number = PULL_API.exec(thread.subject.url ?? "")?.[3];
    const name = thread.repository.full_name.split("/")[1];
    return category
      .submit({
        sourceKey: `${thread.id}:${thread.updated_at}`,
        target: { version: 1, kind: "home" },
        title,
        body: number
          ? `${name}#${number} · ${thread.subject.title}`
          : `${thread.repository.full_name} · ${thread.subject.title}`,
      })
      .catch(() => false);
  };

  const poll = async () => {
    const answer = await read(etag, signal);
    if (answer.status === "unchanged") return;
    // The first read ever only notes what is already there: nobody wants an
    // alert for every review request they've left unread.
    const first = !seen;
    const previous = seen ?? new Map<string, Seen>();
    const next = new Map<string, Seen>();
    const choices = alertChoices();
    for (const thread of answer.threads) {
      const before = previous.get(thread.id);
      // Decided already: alerted for this reason, or this update was. A
      // team's request that later names the person is a new update.
      if (
        before?.reason === thread.reason &&
        (before.done || before.updated === thread.updated_at)
      ) {
        next.set(thread.id, before);
        continue;
      }
      let done = first;
      if (!first && Date.now() - Date.parse(thread.updated_at) <= STALE_MS) {
        try {
          const chosen = await title(thread, choices);
          if (chosen) done = await alert(thread, chosen);
        } catch (error) {
          // A pull request the token can't read is asked about again only
          // when it is next updated.
          if (signal.aborted) throw error;
        }
      }
      next.set(thread.id, {
        reason: thread.reason,
        updated: thread.updated_at,
        done,
      });
    }
    if (signal.aborted) return;
    // A notification read on GitHub leaves the list, and if it comes back it
    // is new.
    seen = next;
    save(next);
    etag = answer.etag;
  };

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      poll().then(
        () => {
          backoff = 0;
          if (!signal.aborted) schedule(POLL_MS);
        },
        () => {
          if (signal.aborted) return;
          backoff = Math.min(MAX_BACKOFF_MS, backoff ? backoff * 2 : POLL_MS);
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
