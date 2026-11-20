// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, type Mock, vi } from "vitest";
import type { GitHubNotifications, GitHubThread } from "./gh";
import {
  ATTEMPTS,
  MAX_BACKOFF_MS,
  MENTIONED,
  MIN_POLL_MS,
  REVIEW_REQUESTED,
  STALE_MS,
  watchReviewAlerts,
} from "./review-alerts";

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
  number: number,
  updated = new Date(Date.now()).toISOString(),
): GitHubThread {
  return {
    id,
    reason,
    updated_at: updated,
    subject: {
      title: `Change ${number}`,
      url: `https://api.github.com/repos/example-org/example-repo/pulls/${number}`,
      type: "PullRequest",
    },
    repository: { full_name: "example-org/example-repo" },
  };
}

/** A GitHub whose notifications are `inbox`, and whose pull requests ask
 * the reviewers `reviewers` names. */
function github() {
  const inbox: { threads: GitHubThread[]; etag: number } = {
    threads: [],
    etag: 0,
  };
  const reviewers = new Map<number, string[]>();
  const read = vi.fn<GitHubNotifications>(async (etag) =>
    etag === `"${inbox.etag}"`
      ? { status: "unchanged", poll: 60 }
      : {
          status: "changed",
          etag: `"${inbox.etag}"`,
          poll: 60,
          threads: [...inbox.threads],
        },
  );
  const gh = vi.fn(
    async (_query: string, variables: Record<string, unknown>) => ({
      viewer: { login: "OctoCat" },
      repository: {
        pullRequest: {
          reviewRequests: {
            nodes: (reviewers.get(variables.number as number) ?? []).map(
              (login) => ({
                // "@team", or "owner:login" for a code owner's request.
                asCodeOwner: login.startsWith("owner:"),
                requestedReviewer: login.startsWith("@")
                  ? {}
                  : { login: login.replace(/^owner:/, "") },
              }),
            ),
          },
        },
      },
    }),
  ) as unknown as NonNullable<Parameters<typeof watchReviewAlerts>[2]> &
    Mock<(...args: unknown[]) => Promise<unknown>>;
  const post = (...threads: GitHubThread[]) => {
    inbox.threads = threads;
    inbox.etag++;
  };
  return { read, gh, reviewers, post };
}

function notifications() {
  const submitted: { category: string; title?: string; body?: string }[] = [];
  return {
    submitted,
    register: vi.fn((category: { id: string }) => ({
      submit: vi.fn(async (input: { title?: string; body?: string }) => {
        submitted.push({ category: category.id, ...input });
        return true;
      }),
    })),
  };
}

const tick = (ms = MIN_POLL_MS) => vi.advanceTimersByTimeAsync(ms);

it("alerts for reviews requested from the person and their mentions, not their teams' or code owners'", async () => {
  const hub = github();
  const shown = notifications();
  hub.reviewers.set(1, ["octocat"]);
  hub.post(thread("1", "review_requested", 1));
  const stop = watchReviewAlerts(shown, hub.read, hub.gh);
  expect(shown.register.mock.calls.map(([category]) => category)).toEqual([
    REVIEW_REQUESTED,
    MENTIONED,
  ]);
  await tick(0);
  // The first read only notes what is already there.
  expect(shown.submitted).toEqual([]);

  hub.reviewers.set(2, ["octocat", "@example-team"]);
  hub.reviewers.set(3, ["@example-team"]);
  hub.reviewers.set(12, ["owner:octocat"]);
  hub.post(
    thread("1", "review_requested", 1),
    thread("2", "review_requested", 2),
    thread("3", "review_requested", 3),
    thread("12", "review_requested", 12),
    thread("4", "mention", 4),
    thread("5", "team_mention", 5),
    thread("6", "author", 6),
  );
  await tick();
  expect(shown.submitted).toEqual([
    expect.objectContaining({
      category: REVIEW_REQUESTED.id,
      title: "Review requested",
      body: "example-repo#2 · Change 2",
    }),
    expect.objectContaining({
      category: MENTIONED.id,
      title: "Mentioned on GitHub",
      body: "example-repo#4 · Change 4",
    }),
  ]);

  // Nothing new: a 304, and no GraphQL read.
  const asked = hub.gh.mock.calls.length;
  await tick();
  expect(hub.read).toHaveBeenLastCalledWith(`"2"`, expect.any(AbortSignal));
  expect(hub.gh.mock.calls.length).toBe(asked);
  expect(shown.submitted).toHaveLength(2);
  stop();
});

it("alerts when a team's request later names the person, and once per request", async () => {
  const hub = github();
  const shown = notifications();
  hub.post();
  const stop = watchReviewAlerts(shown, hub.read, hub.gh);
  await tick(0);
  hub.reviewers.set(7, ["@example-team"]);
  hub.post(thread("7", "review_requested", 7));
  await tick();
  expect(shown.submitted).toEqual([]);

  vi.setSystemTime(NOW + 5 * 60_000);
  hub.reviewers.set(7, ["@example-team", "octocat"]);
  hub.post(thread("7", "review_requested", 7));
  await tick();
  expect(shown.submitted).toHaveLength(1);

  // More activity on the same unread request does not alert again.
  vi.setSystemTime(NOW + 10 * 60_000);
  hub.post(thread("7", "review_requested", 7));
  await tick();
  expect(shown.submitted).toHaveLength(1);

  // Read on GitHub, then requested again: a new alert.
  hub.post();
  await tick();
  hub.post(thread("7", "review_requested", 7));
  await tick();
  expect(shown.submitted).toHaveLength(2);
  stop();
});

it("remembers what it alerted across a restart, and skips stale notifications", async () => {
  const hub = github();
  const first = notifications();
  hub.post();
  let stop = watchReviewAlerts(first, hub.read, hub.gh);
  await tick(0);
  hub.post(thread("8", "mention", 8));
  await tick();
  expect(first.submitted).toHaveLength(1);
  stop();

  const second = notifications();
  hub.post(
    thread("8", "mention", 8),
    thread("9", "mention", 9, new Date(NOW - STALE_MS - 1).toISOString()),
    thread("10", "mention", 10),
  );
  stop = watchReviewAlerts(second, hub.read, hub.gh);
  await tick(0);
  expect(second.submitted.map((item) => item.body)).toEqual([
    "example-repo#10 · Change 10",
  ]);
  stop();
});

it("asks again after a failed lookup, and backs off while reads fail", async () => {
  const hub = github();
  const shown = notifications();
  hub.post();
  const stop = watchReviewAlerts(shown, hub.read, hub.gh);
  await tick(0);
  hub.reviewers.set(11, ["octocat"]);
  hub.post(thread("11", "review_requested", 11));
  hub.gh.mockRejectedValueOnce(new Error("HTTP 502"));
  await tick();
  expect(shown.submitted).toEqual([]);
  // The next read is not a 304, so the request is asked about again.
  await tick();
  expect(hub.read).toHaveBeenLastCalledWith(undefined, expect.any(AbortSignal));
  expect(shown.submitted).toHaveLength(1);

  hub.read.mockRejectedValue(new Error("gh is signed out"));
  const reads = () => hub.read.mock.calls.length;
  let before = reads();
  await tick();
  expect(reads()).toBe(before + 1);
  // Then 1, 2, 4… minutes apart, up to the cap.
  await tick();
  expect(reads()).toBe(before + 2);
  before = reads();
  await tick(MIN_POLL_MS * 2 - 1);
  expect(reads()).toBe(before);
  await tick(1);
  expect(reads()).toBe(before + 1);
  await tick(MAX_BACKOFF_MS * 4);
  before = reads();
  await tick(MAX_BACKOFF_MS);
  expect(reads()).toBe(before + 1);
  stop();
  await tick(MAX_BACKOFF_MS);
  expect(reads()).toBe(before + 1);
});

it("notes the first read without lookups, and gives up on a lookup that keeps failing", async () => {
  const hub = github();
  const shown = notifications();
  hub.reviewers.set(13, ["octocat"]);
  hub.post(thread("13", "review_requested", 13));
  const stop = watchReviewAlerts(shown, hub.read, hub.gh);
  await tick(0);
  expect(hub.gh.mock.calls).toHaveLength(0);

  // A pull request the token can't read: asked about ATTEMPTS times, then
  // reads are 304s again, and other alerts still come.
  hub.gh.mockRejectedValue(new Error("Could not resolve to a Repository"));
  hub.post(
    thread("13", "review_requested", 13),
    thread("14", "review_requested", 14),
  );
  for (let read = 0; read < ATTEMPTS + 2; read++) await tick();
  expect(hub.gh.mock.calls).toHaveLength(ATTEMPTS);
  expect(hub.read).toHaveBeenLastCalledWith(`"2"`, expect.any(AbortSignal));
  hub.post(
    thread("13", "review_requested", 13),
    thread("14", "review_requested", 14),
    thread("15", "mention", 15),
  );
  await tick();
  expect(shown.submitted.map((item) => item.body)).toEqual([
    "example-repo#15 · Change 15",
  ]);
  stop();
});

it("alerts again when Buzz refused the alert, as before an account is chosen", async () => {
  const hub = github();
  let accepting = false;
  const submitted: string[] = [];
  const shown = {
    register: vi.fn(() => ({
      submit: vi.fn(async (input: { body?: string }) => {
        if (accepting) submitted.push(input.body ?? "");
        return accepting;
      }),
    })),
  };
  hub.post();
  const stop = watchReviewAlerts(shown, hub.read, hub.gh);
  await tick(0);
  hub.post(thread("16", "mention", 16));
  await tick();
  expect(submitted).toEqual([]);
  accepting = true;
  await tick();
  await tick();
  expect(submitted).toEqual(["example-repo#16 · Change 16"]);
  stop();
});

it("keeps what it decided about notifications past GitHub's first page", async () => {
  const hub = github();
  const shown = notifications();
  hub.post();
  const stop = watchReviewAlerts(shown, hub.read, hub.gh);
  await tick(0);
  hub.post(thread("17", "mention", 17));
  await tick();
  const page = Array.from({ length: 50 }, (_, index) =>
    thread(`page-${index}`, "author", index),
  );
  hub.post(...page);
  await tick();
  hub.post(thread("17", "mention", 17), ...page.slice(1));
  await tick();
  expect(shown.submitted).toHaveLength(1);
  stop();
});

it("reads nothing where gh cannot run", () => {
  const shown = notifications();
  watchReviewAlerts(shown, undefined, undefined)();
  expect(shown.register).not.toHaveBeenCalled();
});
