// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import { ALERT_KINDS, setAlertChoice } from "./alert-preferences";
import { GITHUB_ALERTS, POLL_MS, STALE_MS, watchAlerts } from "./alerts";
import { GitHubError, type GitHubNotifications, type GitHubThread } from "./gh";

const NOW = Date.parse("2026-11-20T17:00:00Z");

beforeEach(() => {
  vi.useFakeTimers({ now: NOW });
  vi.spyOn(Math, "random").mockReturnValue(0);
  localStorage.clear();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function thread(
  id: string,
  reason: string,
  updated = new Date(Date.now()).toISOString(),
): GitHubThread {
  return {
    id,
    reason,
    updated_at: updated,
    subject: {
      title: `Change ${id}`,
      url: `https://api.github.com/repos/example-org/example-repo/pulls/${id}`,
      type: "PullRequest",
    },
    repository: { full_name: "example-org/example-repo" },
  };
}

/** "octocat" or "@team"; "owner:" before either for a code owner's. */
const reviewer = (who: string) => {
  const name = who.replace(/^owner:/, "");
  return name.startsWith("@")
    ? { __typename: "Team", slug: name.slice(1) }
    : { __typename: "User", login: name };
};

let ids = 0;
const at = <T extends object>(event: T) => ({
  id: `event-${++ids}`,
  createdAt: Date.now(),
  ...event,
});
const requested = (who: string, by = "hubot") =>
  at({
    __typename: "ReviewRequestedEvent",
    actor: { login: by },
    requestedReviewer: reviewer(who),
  });
const commented = (by: string, body: string) =>
  at({ __typename: "IssueComment", author: { login: by }, body });
const reviewed = (by: string, state: string, body = "") =>
  at({
    __typename: "PullRequestReview",
    author: { login: by },
    state,
    body,
    comments: { nodes: [] },
  });
const assigned = (who: string) =>
  at({
    __typename: "AssignedEvent",
    actor: { login: "hubot" },
    assignee: { login: who },
  });
const ready = (by: string) =>
  at({ __typename: "ReadyForReviewEvent", actor: { login: by } });
const merged = (by: string) =>
  at({ __typename: "MergedEvent", actor: { login: by } });

type Pull = {
  author: string;
  created?: number;
  body?: string;
  requests: string[];
  events: ReturnType<typeof at>[];
  failing?: string;
};

/** A GitHub whose notifications are `inbox`, and whose pull requests are
 * `pulls`. */
function github() {
  const inbox: { threads: GitHubThread[]; etag: number } = {
    threads: [],
    etag: 0,
  };
  const pulls = new Map<number, Pull>();
  const read = vi.fn<GitHubNotifications>(async (etag) =>
    etag === `"${inbox.etag}"`
      ? { status: "unchanged" }
      : {
          status: "changed",
          etag: `"${inbox.etag}"`,
          threads: [...inbox.threads],
        },
  );
  const gh = vi.fn(
    async (query: string, variables: Record<string, unknown>) => {
      if (query.includes("statusCheckRollup"))
        return {
          viewer: {
            pullRequests: {
              nodes: [...pulls].map(([number, pull]) => ({
                id: `pull-${number}`,
                number,
                title: `Change ${number}`,
                repository: { name: "example-repo" },
                commits: {
                  nodes: [
                    {
                      commit: {
                        oid: pull.failing ?? "passing",
                        statusCheckRollup: {
                          state: pull.failing ? "FAILURE" : "SUCCESS",
                        },
                      },
                    },
                  ],
                },
              })),
            },
          },
        };
      const pull = pulls.get(variables.number as number);
      const since = Date.parse(variables.since as string);
      return {
        viewer: { login: "OctoCat" },
        repository: {
          pullRequest: pull && {
            author: { login: pull.author },
            createdAt: new Date(pull.created ?? 0).toISOString(),
            body: pull.body ?? "",
            reviewRequests: {
              nodes: pull.requests.map((who) => ({
                asCodeOwner: who.startsWith("owner:"),
                requestedReviewer: reviewer(who),
              })),
            },
            timelineItems: {
              nodes: pull.events.filter((event) => event.createdAt >= since),
            },
          },
        },
      };
    },
  ) as unknown as NonNullable<Parameters<typeof watchAlerts>[2]> &
    Mock<(...args: unknown[]) => Promise<unknown>>;
  const post = (...threads: GitHubThread[]) => {
    inbox.threads = threads;
    inbox.etag++;
  };
  return { read, gh, pulls, post };
}

function notifications() {
  const submitted: { title: string | undefined; body: string | undefined }[] =
    [];
  return {
    submitted,
    register: vi.fn((_category: { id: string; label: string }) => ({
      submit: vi.fn(
        async ({ title, body }: { title?: string; body?: string }) => {
          submitted.push({ title, body });
          return true;
        },
      ),
    })),
  };
}

const tick = (ms = POLL_MS) => vi.advanceTimersByTimeAsync(ms);

/** One pull request for each kind of event, and its notification. */
function everyKind(hub: ReturnType<typeof github>) {
  const pull = (number: number, pull: Pull, reason: string) => {
    hub.pulls.set(number, pull);
    return thread(String(number), reason);
  };
  hub.post(
    pull(
      1,
      {
        author: "hubot",
        requests: ["octocat"],
        events: [requested("octocat")],
      },
      "review_requested",
    ),
    pull(
      2,
      { author: "hubot", requests: ["@team"], events: [requested("@team")] },
      "review_requested",
    ),
    pull(
      3,
      {
        author: "hubot",
        requests: ["owner:octocat"],
        events: [requested("octocat")],
      },
      "review_requested",
    ),
    pull(
      4,
      {
        author: "octocat",
        requests: [],
        events: [reviewed("hubot", "APPROVED")],
      },
      "author",
    ),
    pull(
      5,
      { author: "hubot", requests: [], events: [assigned("octocat")] },
      "assign",
    ),
    pull(
      6,
      {
        author: "octocat",
        requests: [],
        events: [commented("hubot", "Looks good")],
      },
      "author",
    ),
    pull(
      7,
      {
        author: "hubot",
        requests: [],
        events: [commented("monalisa", "Nice")],
      },
      "comment",
    ),
    pull(
      8,
      {
        author: "hubot",
        requests: [],
        events: [commented("monalisa", "cc @OctoCat")],
      },
      "mention",
    ),
    pull(
      9,
      { author: "octocat", requests: [], events: [merged("hubot")] },
      "author",
    ),
    pull(
      10,
      {
        author: "octocat",
        requests: [],
        events: [commented("octocat", "Fixed"), merged("octocat")],
      },
      "author",
    ),
  );
}

it("by default alerts for your review, your pull requests' reviews and comments, assignments and mentions", async () => {
  const hub = github();
  const shown = notifications();
  everyKind(hub);
  const stop = watchAlerts(shown, hub.read, hub.gh);
  expect(shown.register.mock.calls).toEqual([[GITHUB_ALERTS]]);
  await tick(0);
  // The first read only notes what is already there, without lookups.
  expect(shown.submitted).toEqual([]);
  expect(hub.gh).not.toHaveBeenCalled();

  vi.setSystemTime(NOW + 60_000);
  everyKind(hub);
  await tick();
  expect(shown.submitted).toEqual([
    { title: "Review requested", body: "example-repo#1 · Change 1" },
    { title: "Pull request approved", body: "example-repo#4 · Change 4" },
    { title: "Assigned to you", body: "example-repo#5 · Change 5" },
    { title: "New comment", body: "example-repo#6 · Change 6" },
    { title: "Mentioned", body: "example-repo#8 · Change 8" },
  ]);

  // Nothing new: a 304, and no GraphQL read.
  const asked = hub.gh.mock.calls.length;
  await tick();
  expect(hub.read).toHaveBeenLastCalledWith(`"2"`, expect.any(AbortSignal));
  expect(hub.gh.mock.calls.length).toBe(asked);
  expect(shown.submitted).toHaveLength(5);
  stop();
});

it("alerts for the kinds the person chose", async () => {
  for (const kind of ALERT_KINDS) setAlertChoice(kind.key, !kind.on);
  const hub = github();
  const shown = notifications();
  hub.post();
  const stop = watchAlerts(shown, hub.read, hub.gh);
  await tick(0);
  everyKind(hub);
  await tick();
  expect(
    shown.submitted.filter((item) => item.title !== "Checks failed"),
  ).toEqual([
    {
      title: "Review requested from your team",
      body: "example-repo#2 · Change 2",
    },
    {
      title: "Review requested as code owner",
      body: "example-repo#3 · Change 3",
    },
    { title: "New comment", body: "example-repo#7 · Change 7" },
    { title: "New comment", body: "example-repo#8 · Change 8" },
    { title: "Pull request merged", body: "example-repo#9 · Change 9" },
  ]);

  // Another team's request on a pull request the person is in is not theirs.
  vi.setSystemTime(NOW + 60_000);
  hub.pulls.set(19, {
    author: "hubot",
    requests: ["@other-team"],
    events: [requested("@other-team")],
  });
  hub.post(thread("19", "comment"));
  await tick();
  expect(shown.submitted).toHaveLength(5);
  stop();
});

it("asks nothing about pull requests when only failed checks are chosen", async () => {
  for (const kind of ALERT_KINDS)
    setAlertChoice(kind.key, kind.key === "failedChecks");
  const hub = github();
  const shown = notifications();
  hub.post();
  const stop = watchAlerts(shown, hub.read, hub.gh);
  await tick(0);
  everyKind(hub);
  await tick();
  expect(
    hub.gh.mock.calls.some(([query]) => String(query).includes("timeline")),
  ).toBe(false);
  stop();
});

it("alerts once for each new event, the most important first", async () => {
  const hub = github();
  const shown = notifications();
  const pull: Pull = { author: "octocat", requests: [], events: [] };
  hub.pulls.set(11, pull);
  hub.post();
  const stop = watchAlerts(shown, hub.read, hub.gh);
  await tick(0);

  pull.events.push(commented("hubot", "One thing"));
  hub.post(thread("11", "author"));
  await tick();
  // A later update reads the last one's events again, but does not alert
  // for them again.
  vi.setSystemTime(NOW + 60_000);
  hub.post(thread("11", "author"));
  await tick();
  vi.setSystemTime(NOW + 2 * 60_000);
  pull.events.push(
    commented("monalisa", "Agreed, @octocat"),
    reviewed("hubot", "CHANGES_REQUESTED", "Please fix"),
  );
  hub.post(thread("11", "author"));
  await tick();
  expect(shown.submitted.map((item) => item.title)).toEqual([
    "New comment",
    "Changes requested",
  ]);

  // A review request withdrawn before it was read alerts nothing.
  vi.setSystemTime(NOW + 3 * 60_000);
  hub.pulls.set(12, {
    author: "hubot",
    requests: [],
    events: [requested("octocat")],
  });
  hub.post(thread("11", "author"), thread("12", "review_requested"));
  await tick();
  expect(shown.submitted).toHaveLength(2);
  stop();
});

it("does not alert again for events it only noted, or for a notification back from past the first page", async () => {
  const hub = github();
  const shown = notifications();
  const pull: Pull = {
    author: "hubot",
    requests: ["octocat"],
    events: [requested("octocat")],
  };
  hub.pulls.set(20, pull);
  hub.post(thread("20", "review_requested"));
  const stop = watchAlerts(shown, hub.read, hub.gh);
  await tick(0);
  // The first run noted the request; a later comment does not alert it.
  vi.setSystemTime(NOW + 60_000);
  pull.events.push(commented("monalisa", "Bump"));
  hub.post(thread("20", "review_requested"));
  await tick();
  expect(shown.submitted).toEqual([]);

  vi.setSystemTime(NOW + 2 * 60_000);
  hub.pulls.set(21, {
    author: "octocat",
    requests: [],
    events: [commented("hubot", "Hi")],
  });
  const returning = thread("21", "author");
  hub.post(returning);
  await tick();
  hub.post();
  await tick();
  hub.post(returning);
  await tick();
  expect(shown.submitted).toHaveLength(1);
  stop();
});

it("alerts for a mention in a new description, and for reviews requested on a draft once it's ready", async () => {
  const hub = github();
  const shown = notifications();
  hub.post();
  const stop = watchAlerts(shown, hub.read, hub.gh);
  await tick(0);
  hub.pulls.set(22, {
    author: "hubot",
    created: Date.now(),
    body: "For @octocat to try",
    requests: [],
    events: [],
  });
  // Requested a day before, while a draft.
  const early = { ...requested("octocat"), createdAt: NOW - STALE_MS };
  hub.pulls.set(23, {
    author: "hubot",
    requests: ["octocat"],
    events: [early, ready("hubot")],
  });
  hub.post(thread("22", "mention"), thread("23", "review_requested"));
  await tick();
  expect(shown.submitted).toEqual([
    { title: "Mentioned", body: "example-repo#22 · Change 22" },
    { title: "Review requested", body: "example-repo#23 · Change 23" },
  ]);
  stop();
});

it("remembers what it read across a restart, and skips stale notifications", async () => {
  const hub = github();
  const first = notifications();
  hub.post();
  let stop = watchAlerts(first, hub.read, hub.gh);
  await tick(0);
  hub.pulls.set(13, {
    author: "hubot",
    requests: [],
    events: [commented("monalisa", "@octocat?")],
  });
  hub.post(thread("13", "mention"));
  await tick();
  expect(first.submitted).toHaveLength(1);
  stop();

  const second = notifications();
  hub.pulls.set(14, {
    author: "hubot",
    requests: [],
    events: [commented("monalisa", "@octocat?")],
  });
  hub.pulls.set(15, {
    author: "hubot",
    requests: [],
    events: [commented("monalisa", "@octocat?")],
  });
  hub.post(
    thread("13", "mention"),
    thread("14", "mention", new Date(NOW - STALE_MS - 1).toISOString()),
    thread("15", "mention"),
  );
  stop = watchAlerts(second, hub.read, hub.gh);
  await tick(0);
  expect(second.submitted.map((item) => item.body)).toEqual([
    "example-repo#15 · Change 15",
  ]);
  stop();
});

it("alerts when your pull request's checks fail, once for each head commit", async () => {
  setAlertChoice("failedChecks", true);
  const hub = github();
  const shown = notifications();
  const pull: Pull = {
    author: "octocat",
    requests: [],
    events: [],
    failing: "abc",
  };
  hub.pulls.set(16, pull);
  hub.post();
  const stop = watchAlerts(shown, hub.read, hub.gh);
  // Failures already there when the switch was turned on are only noted.
  await tick(0);
  expect(shown.submitted).toEqual([]);
  pull.failing = "def";
  await tick();
  await tick();
  expect(shown.submitted).toEqual([
    { title: "Checks failed", body: "example-repo#16 · Change 16" },
  ]);
  // One left off the list for a while is still known when it comes back.
  hub.pulls.delete(16);
  await tick();
  hub.pulls.set(16, pull);
  await tick();
  expect(shown.submitted).toHaveLength(1);
  // A repository the token can't read leaves the rest of the answer.
  pull.failing = "ghi";
  const answer = await hub.gh("query { statusCheckRollup }", {});
  hub.gh.mockImplementation(async () => {
    throw new GitHubError("Resource protected by SSO", "FORBIDDEN", answer);
  });
  await tick();
  expect(shown.submitted).toHaveLength(2);
  stop();
});

it("goes on after a failed lookup or read, and stops when asked", async () => {
  const hub = github();
  const shown = notifications();
  hub.post();
  const stop = watchAlerts(shown, hub.read, hub.gh);
  await tick(0);
  hub.pulls.set(17, {
    author: "hubot",
    requests: ["octocat"],
    events: [requested("octocat")],
  });
  hub.pulls.set(18, {
    author: "hubot",
    requests: [],
    events: [commented("monalisa", "@octocat")],
  });
  hub.post(thread("17", "review_requested"), thread("18", "mention"));
  hub.gh.mockRejectedValueOnce(new Error("HTTP 502"));
  await tick();
  expect(shown.submitted.map((item) => item.body)).toEqual([
    "example-repo#18 · Change 18",
  ]);

  hub.read.mockRejectedValue(new Error("gh is signed out"));
  const reads = () => hub.read.mock.calls.length;
  const before = reads();
  await tick();
  await tick();
  expect(reads()).toBe(before + 2);
  stop();
  await tick();
  expect(reads()).toBe(before + 2);
});

it("reads nothing where gh cannot run", () => {
  const shown = notifications();
  watchAlerts(shown, undefined, undefined)();
  expect(shown.register).not.toHaveBeenCalled();
});
