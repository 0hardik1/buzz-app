// Desktop alerts for what happens on the person's pull requests and the ones
// they're in. They choose which kinds alert in the GitHub settings card, and
// can turn them all off under GitHub in Settings → Notifications.
//
// GitHub pushes nothing to a desktop, so this reads the person's notifications
// once a minute, sending the last ETag: a read that finds nothing new is a 304,
// which costs none of the rate limit. A pull request's notification says only
// that something happened, so each update costs one GraphQL read of what did.
// A failing check notifies nothing, so while that switch is on the person's
// open pull requests are read once a minute too.
import type { Notifications } from "../../features/notifications/service";
import { type AlertKind, alertChoices } from "./alert-preferences";
import {
  type GitHubCli,
  GitHubError,
  type GitHubNotifications,
  type GitHubThread,
} from "./gh";

export const GITHUB_ALERTS = { id: "github", label: "GitHub" };

const STORAGE_KEY = "buzz.github.alert-progress.v1";
/** GitHub asks clients to read notifications at most once a minute. */
export const POLL_MS = 60_000;
/** A notification first seen this long after it was updated, as after a
 * week away, is noted but not alerted. */
export const STALE_MS = 24 * 60 * 60_000;
/** How far before a notification's last update its events are read again, so
 * an event GitHub recorded just before that update is not missed. */
const OVERLAP_MS = 5 * 60_000;

/** The last update of an unread notification, and the events found when it
 * was looked at, so reading them again does not alert again. `null` when it
 * was only noted, as on the first run: its events before `updated` are old. */
type Seen = Readonly<{ updated: string; events: readonly string[] | null }>;

/** Which alert wins when one update has several kinds of event. */
const PRIORITY: readonly AlertKind[] = [
  "review",
  "codeOwnerReview",
  "teamReview",
  "reviewed",
  "mention",
  "assigned",
  "merged",
  "comment",
  "threadComment",
];

const PULL_API =
  /^https:\/\/api\.github\.com\/repos\/([\w.-]+)\/([\w.-]+)\/pulls\/(\d+)$/;

const EVENTS = `query($owner: String!, $name: String!, $number: Int!, $since: DateTime!) {
  viewer { login }
  repository(owner: $owner, name: $name) {
    pullRequest(number: $number) {
      author { login } createdAt body
      reviewRequests(first: 100) {
        nodes { asCodeOwner requestedReviewer { ...Reviewer } }
      }
      timelineItems(last: 50, since: $since, itemTypes: [ISSUE_COMMENT, PULL_REQUEST_REVIEW, REVIEW_REQUESTED_EVENT, READY_FOR_REVIEW_EVENT, ASSIGNED_EVENT, MERGED_EVENT]) {
        nodes {
          __typename
          ... on Node { id }
          ... on IssueComment { author { login } body }
          ... on PullRequestReview {
            author { login } state body
            comments(first: 20) { nodes { body } }
          }
          ... on ReviewRequestedEvent { actor { login } requestedReviewer { ...Reviewer } }
          ... on AssignedEvent { actor { login } assignee { ... on User { login } } }
          ... on ReadyForReviewEvent { actor { login } }
          ... on MergedEvent { actor { login } }
        }
      }
    }
  }
}
fragment Reviewer on RequestedReviewer {
  __typename
  ... on User { login }
  ... on Team { slug }
}`;

type Login = { login: string } | null;
type Reviewer = { __typename: string; login?: string; slug?: string } | null;
type Event = { id: string; actor?: Login; author?: Login } & (
  | { __typename: "IssueComment"; body: string }
  | {
      __typename: "PullRequestReview";
      state: string;
      body: string;
      comments: { nodes: ({ body: string } | null)[] };
    }
  | { __typename: "ReviewRequestedEvent"; requestedReviewer: Reviewer }
  | { __typename: "AssignedEvent"; assignee: { login?: string } | null }
  | { __typename: "ReadyForReviewEvent" }
  | { __typename: "MergedEvent" }
);
type Events = {
  viewer: { login: string };
  repository: {
    pullRequest: {
      author: Login;
      createdAt: string;
      body: string;
      reviewRequests: {
        nodes: ({ asCodeOwner: boolean; requestedReviewer: Reviewer } | null)[];
      };
      timelineItems: { nodes: (Event | null)[] };
    } | null;
  } | null;
};

const CHECKS = `query {
  viewer {
    pullRequests(states: OPEN, first: 50, orderBy: {field: UPDATED_AT, direction: DESC}) {
      nodes {
        id number title repository { name }
        commits(last: 1) { nodes { commit { oid statusCheckRollup { state } } } }
      }
    }
  }
}`;

type Checks = {
  viewer: {
    pullRequests: {
      nodes: ({
        id: string;
        number: number;
        title: string;
        repository: { name: string };
        commits: {
          nodes: ({
            commit: {
              oid: string;
              statusCheckRollup: { state: string } | null;
            };
          } | null)[];
        };
      } | null)[];
    };
  };
};

/** The alerts that `data`'s events not in `known` call for, each with its
 * title. The person's own actions alert nothing. */
function happened(
  data: Events,
  reason: string,
  since: number,
  known: ReadonlySet<string>,
) {
  const found = new Map<AlertKind, string>();
  const pull = data.repository?.pullRequest;
  if (!pull) return found;
  const viewer = data.viewer.login.toLowerCase();
  const isViewer = (login?: string | null) => login?.toLowerCase() === viewer;
  const yours = isViewer(pull.author?.login);
  const mentioned = new RegExp(
    `(?:^|[^\\w/\`])@${viewer.replace(/[^\w]/g, "\\$&")}(?![\\w-])`,
    "i",
  );
  const add = (kind: AlertKind, title: string) => {
    if (!found.has(kind)) found.set(kind, title);
  };
  /** A review request, if it still waits on the person: not withdrawn,
   * nor reviewed already. */
  const request = (asked: Reviewer) => {
    const you = isViewer(asked?.login);
    // GitHub notifies the person of a team's request only when they're on
    // the team, and has no field to ask whether they are.
    if (!you && (asked?.__typename !== "Team" || reason !== "review_requested"))
      return;
    const name = (reviewer: Reviewer) =>
      (reviewer?.login ?? reviewer?.slug)?.toLowerCase();
    const pending = pull.reviewRequests.nodes.find(
      (node) =>
        node?.requestedReviewer?.__typename === asked?.__typename &&
        name(node?.requestedReviewer ?? null) === name(asked),
    );
    if (pending?.asCodeOwner)
      add("codeOwnerReview", "Review requested as code owner");
    else if (pending)
      add(
        you ? "review" : "teamReview",
        you ? "Review requested" : "Review requested from your team",
      );
  };
  const text = (bodies: (string | undefined)[]) => {
    const said = bodies.filter((body): body is string => !!body?.trim());
    if (said.some((body) => mentioned.test(body))) add("mention", "Mentioned");
    return said.length > 0;
  };
  // A description is no timeline event, but may mention the person.
  if (!yours && Date.parse(pull.createdAt) >= since) text([pull.body]);
  for (const event of pull.timelineItems.nodes) {
    if (!event || known.has(event.id)) continue;
    if (isViewer((event.actor ?? event.author)?.login)) continue;
    if (event.__typename === "ReviewRequestedEvent") {
      request(event.requestedReviewer);
    } else if (event.__typename === "ReadyForReviewEvent") {
      // GitHub tells reviewers of a draft only once it is ready.
      for (const node of pull.reviewRequests.nodes)
        request(node?.requestedReviewer ?? null);
    } else if (event.__typename === "AssignedEvent") {
      if (isViewer(event.assignee?.login)) add("assigned", "Assigned to you");
    } else if (event.__typename === "MergedEvent") {
      if (yours) add("merged", "Pull request merged");
    } else {
      if (
        yours &&
        event.__typename === "PullRequestReview" &&
        (event.state === "APPROVED" || event.state === "CHANGES_REQUESTED")
      )
        add(
          "reviewed",
          event.state === "APPROVED"
            ? "Pull request approved"
            : "Changes requested",
        );
      if (
        text([
          event.body,
          ...(event.__typename === "PullRequestReview"
            ? event.comments.nodes.map((comment) => comment?.body)
            : []),
        ])
      )
        add(yours ? "comment" : "threadComment", "New comment");
    }
  }
  return found;
}

function load(): Map<string, Seen> | undefined {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "");
    if (!Array.isArray(value)) return undefined;
    return new Map(
      value.filter(
        (entry): entry is [string, Seen] =>
          Array.isArray(entry) &&
          typeof entry[0] === "string" &&
          typeof entry[1]?.updated === "string" &&
          (entry[1].events === null || Array.isArray(entry[1].events)),
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

/** Alerts for the pull request events the person chose until the returned
 * function is called. Nothing is read where `gh` cannot run. */
export function watchAlerts(
  notifications: Pick<Notifications, "register">,
  read: GitHubNotifications | undefined,
  gh: GitHubCli | undefined,
): () => void {
  if (!read || !gh) return () => {};
  const category = notifications.register(GITHUB_ALERTS);
  const lifetime = new AbortController();
  const signal = lifetime.signal;
  let seen = load();
  /** Each open pull request's head commit whose checks failed. */
  let failing: Map<string, string> | undefined;
  let etag: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const alert = (sourceKey: string, title: string, body: string) =>
    category
      .submit({ sourceKey, target: { version: 1, kind: "home" }, title, body })
      .catch(() => false);

  const readNotifications = async (
    choices: ReturnType<typeof alertChoices>,
  ) => {
    const answer = await read(etag, signal);
    if (answer.status === "unchanged") return;
    // The first read ever only notes what is already there: nobody wants an
    // alert for everything they've left unread.
    const first = !seen;
    const previous = seen ?? new Map<string, Seen>();
    const next = new Map<string, Seen>();
    const wanted = PRIORITY.some((kind) => choices[kind]);
    const lookUp = async (
      thread: GitHubThread,
      [, owner, name, number]: RegExpExecArray,
      before: Seen | undefined,
    ) => {
      const since =
        before && !before.events
          ? // GitHub's times are to the second.
            Date.parse(before.updated) + 1000
          : Date.parse(before?.updated ?? thread.updated_at) - OVERLAP_MS;
      const data = await gh<Events>(
        EVENTS,
        {
          owner,
          name,
          number: Number(number),
          since: new Date(since).toISOString(),
        },
        signal,
      );
      const found = happened(
        data,
        thread.reason,
        since,
        new Set(before?.events),
      );
      const kind = PRIORITY.find((kind) => choices[kind] && found.has(kind));
      if (kind)
        await alert(
          `${thread.id}:${thread.updated_at}`,
          found.get(kind) ?? "",
          `${name}#${number} · ${thread.subject.title}`,
        );
      return (data.repository?.pullRequest?.timelineItems.nodes ?? []).flatMap(
        (event) => (event ? [event.id] : []),
      );
    };
    for (const thread of answer.threads) {
      const before = previous.get(thread.id);
      if (before?.updated === thread.updated_at) {
        next.set(thread.id, before);
        continue;
      }
      const match = PULL_API.exec(thread.subject.url ?? "");
      const updated = Date.parse(thread.updated_at);
      let events: readonly string[] | null = null;
      if (!first && wanted && match && Date.now() - updated <= STALE_MS) {
        try {
          events = await lookUp(thread, match, before);
        } catch (error) {
          // Looked at again only when it is next updated.
          if (signal.aborted) throw error;
        }
      }
      next.set(thread.id, { updated: thread.updated_at, events });
    }
    if (signal.aborted) return;
    // GitHub reads 50 at a time; one pushed off the page for a while is still
    // known when it comes back.
    for (const [id, entry] of previous)
      if (!next.has(id) && Date.now() - Date.parse(entry.updated) <= STALE_MS)
        next.set(id, entry);
    seen = next;
    save(next);
    etag = answer.etag;
  };

  const readChecks = async () => {
    // A repository the token can't read leaves the rest of the answer.
    const data = await gh<Checks>(CHECKS, {}, signal).catch((error) => {
      if (error instanceof GitHubError && error.data && !signal.aborted)
        return error.data as Checks;
      throw error;
    });
    // One left off the 50 for a while is still known when it comes back.
    const next = new Map(failing);
    for (const pull of data.viewer.pullRequests.nodes) {
      const commit = pull?.commits.nodes[0]?.commit;
      const state = commit?.statusCheckRollup?.state;
      if (!pull || !commit || (state !== "FAILURE" && state !== "ERROR"))
        continue;
      // The first read after the switch is turned on only notes failures.
      if (failing && failing.get(pull.id) !== commit.oid)
        await alert(
          `${pull.id}:${commit.oid}`,
          "Checks failed",
          `${pull.repository.name}#${pull.number} · ${pull.title}`,
        );
      next.set(pull.id, commit.oid);
    }
    if (!signal.aborted) failing = next;
  };

  const poll = async () => {
    const choices = alertChoices();
    if (!choices.failedChecks) failing = undefined;
    // Each is tried again next minute if it fails.
    await Promise.allSettled([
      readNotifications(choices),
      choices.failedChecks && readChecks(),
    ]);
  };

  const schedule = (delay: number) => {
    timer = setTimeout(() => {
      void poll().finally(() => {
        if (!signal.aborted) schedule(POLL_MS);
      });
    }, delay);
  };
  // Spread out first reads, as after an update relaunches every app at once.
  schedule(Math.random() * 10_000);
  return () => {
    lifetime.abort();
    clearTimeout(timer);
  };
}
