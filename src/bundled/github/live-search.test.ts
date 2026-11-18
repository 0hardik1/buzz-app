// @vitest-environment jsdom
import { afterEach, expect, test, vi } from "vitest";
import { createLivePullSearch } from "./live-search";
import type { GitHubCli } from "./gh";

function deferred() {
  let resolve!: (value: unknown) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const result = {
  search: {
    pageInfo: { hasNextPage: false },
    nodes: [
      {
        title: "Search fix",
        url: "https://github.com/block/buzz-app/pull/1",
        number: 1,
        repository: { nameWithOwner: "block/buzz-app" },
      },
    ],
  },
};
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

test("two consumers share live refreshes, retain rows on failure, and release the timer with the last consumer", async () => {
  vi.useFakeTimers();
  const reads: ReturnType<typeof deferred>[] = [];
  const gh = vi.fn(() => {
    const read = deferred();
    reads.push(read);
    return read.promise;
  });
  const searches = createLivePullSearch(gh as GitHubCli);
  const first = searches.for('is:open "search"');
  const stop = first.subscribe(() => {});
  const second = searches.for('is:open "search"');
  const stopSecond = second.subscribe(() => {});
  expect(gh).toHaveBeenCalledTimes(1);
  reads[0]?.resolve(result);
  await reads[0]?.promise;
  expect(second.snapshot().pulls).toHaveLength(1);
  await vi.advanceTimersByTimeAsync(60_000);
  expect(gh).toHaveBeenCalledTimes(2);
  reads[1]?.reject(new Error("Sign in to GitHub"));
  await reads[1]?.promise.catch(() => {});
  expect(first.snapshot()).toMatchObject({
    pending: false,
    error: "Sign in to GitHub",
    pulls: result.search.nodes,
  });
  stop();
  second.refresh();
  expect(gh).toHaveBeenCalledTimes(3);
  stopSecond();
  reads[2]?.resolve(result);
  await reads[2]?.promise;
  await vi.advanceTimersByTimeAsync(120_000);
  expect(gh).toHaveBeenCalledTimes(3);
  searches.dispose();
});

test("hidden documents cancel in-flight reads, ignore late results, and resume on visibility", async () => {
  const reads: { gate: ReturnType<typeof deferred>; signal?: AbortSignal }[] =
    [];
  const gh = vi.fn((_query, _variables, signal) => {
    const gate = deferred();
    reads.push({ gate, signal });
    return gate.promise;
  });
  const searches = createLivePullSearch(gh as GitHubCli);
  const store = searches.for("is:open");
  const stop = store.subscribe(() => {});
  const hidden = vi.spyOn(document, "hidden", "get").mockReturnValue(true);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(reads[0]?.signal?.aborted).toBe(true);
  reads[0]?.gate.resolve(result);
  await reads[0]?.gate.promise;
  expect(store.snapshot().pulls).toEqual([]);
  hidden.mockReturnValue(false);
  document.dispatchEvent(new Event("visibilitychange"));
  expect(gh).toHaveBeenCalledTimes(2);
  reads[1]?.gate.resolve(result);
  await reads[1]?.gate.promise;
  expect(store.snapshot().pulls).toHaveLength(1);
  stop();
  searches.dispose();
});
