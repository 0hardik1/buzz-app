import { assert, expect, it, vi } from "vitest";
import { createSidebarPreferencesStore } from "./sidebar-preferences-store";
import type {
  SidebarPreferences,
  SidebarSortMode,
} from "./sidebar-preferences";
import { flush } from "./testing";

type Sort = Readonly<Record<string, SidebarSortMode>>;
const data: SidebarPreferences = {
  sections: [{ id: "work", name: "Work", order: 0 }],
  assignments: { alpha: "work" },
  starred: ["beta"],
  muted: [],
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function setup() {
  const pending: ReturnType<typeof deferred<Sort>>[] = [];
  const read = vi.fn(async (): Promise<SidebarPreferences> => data);
  const sort = vi.fn(() => {
    const job = deferred<Sort>();
    pending.push(job);
    return job.promise;
  });
  const owner = createSidebarPreferencesStore({
    read,
    available: true,
    writeSort: sort,
  });
  return { owner, preferences: owner.queries, pending, read, sort };
}

it("independent optimistic choices survive older success and failure in queue order", async () => {
  const { owner, preferences, pending, sort } = setup();
  try {
    await preferences.ensure();
    const first = preferences.setSort("channels", "alpha", ["work"]);
    const firstFailed = expect(first).rejects.toThrow("offline");
    const second = preferences.setSort("section:work", "alpha", ["work"]);
    expect(preferences.snapshot().data).toEqual({
      ...data,
      sort: { channels: "alpha", "section:work": "alpha" },
    });
    await flush();
    expect(sort).toHaveBeenCalledTimes(1);
    take(pending).reject(new Error("offline"));
    await firstFailed;
    await flush();
    expect(preferences.snapshot().data?.sort).toEqual({
      "section:work": "alpha",
    });
    expect(preferences.snapshot().sortErrors).toEqual([
      { group: "channels", mode: "alpha", error: "offline" },
    ]);
    take(pending).resolve({ "section:work": "alpha" });
    await second;
    expect(preferences.snapshot().data).toEqual({
      ...data,
      sort: { "section:work": "alpha" },
    });
  } finally {
    owner.dispose();
  }
});

it("an older confirmation never overwrites a newer reset-to-default intent for the same section", async () => {
  const { owner, preferences, pending } = setup();
  try {
    await preferences.ensure();
    const first = preferences.setSort("channels", "alpha", []);
    const second = preferences.setSort("channels", "recent", []);
    expect(preferences.snapshot().data?.sort).toEqual({});
    await flush();
    take(pending).resolve({ channels: "alpha" });
    await first;
    await flush();
    expect(preferences.snapshot().data?.sort).toEqual({});
    take(pending).resolve({});
    await second;
    expect(preferences.snapshot().data?.sort).toEqual({});
  } finally {
    owner.dispose();
  }
});

it("refresh during a pending intent updates unrelated data without hiding that intent", async () => {
  const { owner, preferences, pending, read } = setup();
  try {
    await preferences.ensure();
    const writing = preferences.setSort("channels", "alpha", []);
    const failed = expect(writing).rejects.toThrow("offline");
    await flush();
    read.mockResolvedValueOnce({
      ...data,
      starred: ["alpha"],
      sort: { forums: "alpha" },
    });
    await preferences.refresh();
    expect(preferences.snapshot().data).toEqual({
      ...data,
      starred: ["alpha"],
      sort: { channels: "alpha", forums: "alpha" },
    });
    take(pending).reject(new Error("offline"));
    await failed;
    expect(preferences.snapshot().data).toEqual({
      ...data,
      starred: ["alpha"],
      sort: { forums: "alpha" },
    });
  } finally {
    owner.dispose();
  }
});

it.each(["clear", "dispose"] as const)(
  "%s aborts active sorting and prevents queued writes/late repopulation",
  async (action) => {
    const { owner, preferences, pending, sort } = setup();
    await preferences.ensure();
    const first = preferences.setSort("channels", "alpha", []);
    const second = preferences.setSort("forums", "alpha", []);
    const failed = [
      expect(first).rejects.toThrow("unavailable"),
      expect(second).rejects.toThrow("unavailable"),
    ];
    await flush();
    owner[action]();
    take(pending).resolve({ channels: "alpha" });
    await Promise.all(failed);
    expect(sort).toHaveBeenCalledTimes(1);
    expect(
      (
        sort.mock.calls[0] as unknown as [string, string, string[], AbortSignal]
      )[3].aborted,
    ).toBe(true);
    expect(preferences.snapshot().data).toBeUndefined();
    expect(preferences.snapshot().sortErrors).toBeUndefined();
    owner.dispose();
  },
);

it("caller cancellation rolls back only its own intent and skips its queued publication", async () => {
  const { owner, preferences, pending, sort } = setup();
  try {
    await preferences.ensure();
    const first = preferences.setSort("channels", "alpha", []);
    const controller = new AbortController();
    const second = preferences.setSort(
      "forums",
      "alpha",
      [],
      controller.signal,
    );
    const failed = expect(second).rejects.toThrow();
    controller.abort();
    await flush();
    take(pending).resolve({ channels: "alpha" });
    await first;
    await failed;
    expect(sort).toHaveBeenCalledTimes(1);
    expect(preferences.snapshot().data?.sort).toEqual({ channels: "alpha" });
    expect(preferences.snapshot().sortErrors).toBeUndefined();
  } finally {
    owner.dispose();
  }
});

it("a superseded failure cannot expose retry or roll back a newer choice", async () => {
  const { owner, preferences, pending } = setup();
  try {
    await preferences.ensure();
    const first = preferences.setSort("channels", "alpha", []);
    const failed = expect(first).rejects.toThrow("offline");
    const second = preferences.setSort("channels", "recent", []);
    await flush();
    take(pending).reject(new Error("offline"));
    await failed;
    expect(preferences.snapshot().sortErrors).toBeUndefined();
    expect(preferences.snapshot().data?.sort).toEqual({});
    await flush();
    take(pending).resolve({});
    await second;
    expect(preferences.snapshot().sortErrors).toBeUndefined();
  } finally {
    owner.dispose();
  }
});

it("sort failure survives observer removal, supports retry, and dismisses per section", async () => {
  const { owner, preferences, pending } = setup();
  try {
    await preferences.ensure();
    const off = preferences.subscribe(vi.fn());
    const first = preferences.setSort("channels", "alpha", []);
    const failed = expect(first).rejects.toThrow("offline");
    off();
    await flush();
    take(pending).reject(new Error("offline"));
    await failed;
    const again = preferences.subscribe(vi.fn());
    await preferences.ensure();
    const failure = preferences.snapshot().sortErrors?.[0];
    expect(failure).toEqual({
      group: "channels",
      mode: "alpha",
      error: "offline",
    });
    assert.exists(failure);
    const retry = preferences.setSort(failure.group, failure.mode, []);
    expect(preferences.snapshot().sortErrors).toBeUndefined();
    expect(preferences.snapshot().data?.sort).toEqual({ channels: "alpha" });
    await flush();
    take(pending).resolve({ channels: "alpha" });
    await retry;
    for (const group of ["channels", "forums"]) {
      const rejected = expect(
        preferences.setSort(group, "recent", []),
      ).rejects.toThrow("offline");
      await flush();
      take(pending).reject(new Error("offline"));
      await rejected;
    }
    preferences.dismissSortError("channels");
    expect(preferences.snapshot().sortErrors).toEqual([
      { group: "forums", mode: "recent", error: "offline" },
    ]);
    again();
    owner.clear();
    expect(preferences.snapshot().sortErrors).toBeUndefined();
  } finally {
    owner.dispose();
  }
});

function take<T>(pending: T[]): T {
  const next = pending.shift();
  assert.exists(next, "Expected a pending operation");
  return next;
}
