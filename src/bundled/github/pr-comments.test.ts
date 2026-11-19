import { expect, it } from "vitest";
import { createPrComments, anchorInSnapshot } from "./pr-comments";
import {
  fixturePull,
  githubCommentHost,
} from "../../../tests/fixtures/github-comment-host";

async function setup() {
  const fixture = githubCommentHost();
  const api = createPrComments(fixture.host);
  if (!api) throw new Error("Missing adapter");
  const snapshot = await api.loadSnapshot(fixturePull);
  const anchor = {
    head: snapshot.head,
    base: snapshot.base,
    path: "src/example.ts",
    side: "LEFT",
    line: 5000,
  } as const;
  return { ...fixture, api, snapshot, anchor };
}
it("loads the PR endpoint with verified SHAs and canonical renamed path", async () => {
  const { snapshot, anchor, state } = await setup();
  expect(snapshot.files).toEqual([
    { path: "src/example.ts", previousPath: "src/old.ts" },
  ]);
  expect(anchorInSnapshot(snapshot, anchor)).toBe(true);
  expect(anchorInSnapshot(snapshot, { ...anchor, path: "src/old.ts" })).toBe(
    false,
  );
  expect(
    anchorInSnapshot(snapshot, { ...anchor, side: "RIGHT", line: 5002 }),
  ).toBe(true);
  expect(
    anchorInSnapshot(snapshot, { ...anchor, side: "LEFT", line: 5002 }),
  ).toBe(false);
  expect(state.calls.find((call) => call.id === "diff")?.args).toEqual([
    "repos/example-org/sample/pulls/1",
  ]);
});
it("returns a write receipt independently of refresh and supports replies", async () => {
  const { api, snapshot, anchor, state } = await setup();
  expect(
    (await api.create(snapshot, anchor, "First", "operation")).status,
  ).toBe("sent");
  const threads = await api.loadThreads(fixturePull);
  expect(threads.items[0]?.comments[0]?.author).toBe("example-reviewer");
  expect(
    (await api.reply(snapshot, 1, "Reply", "reply-operation")).status,
  ).toBe("sent");
  expect(state.comments.map((row) => row.body)).toEqual(["First", "Reply"]);
});
it.each(["head", "base"] as const)(
  "refuses changed %s without posting",
  async (field) => {
    const { api, snapshot, anchor, state } = await setup();
    state[field] = "c".repeat(40);
    expect(
      await api.create(snapshot, anchor, "Keep draft", "operation"),
    ).toEqual({
      status: "stale",
    });
    expect(state.comments).toHaveLength(0);
  },
);
it.each(["denied", "validation"] as const)(
  "classifies definite %s refusals",
  async (mode) => {
    const { api, snapshot, anchor, state } = await setup();
    state.mode = mode;
    expect(
      await api.create(snapshot, anchor, "Keep draft", "operation"),
    ).toMatchObject({
      status: "failed",
      error: { kind: mode === "denied" ? "forbidden" : "validation" },
    });
    expect(state.comments).toHaveLength(0);
  },
);
it("reconciles timeout-after-success without a second POST", async () => {
  const { api, snapshot, anchor, state } = await setup();
  state.mode = "timeout";
  const result = await api.create(snapshot, anchor, "Keep draft", "operation");
  expect(result.status).toBe("unknown");
  expect(await api.create(snapshot, anchor, "Keep draft", "operation")).toEqual(
    result,
  );
  if (result.status !== "unknown")
    throw new Error("Expected uncertain outcome");
  expect((await api.reconcile(result.attempt)).status).toBe("sent");
  expect(state.calls.filter((call) => call.args[0] === "POST")).toHaveLength(1);
});
it("does not reconcile under a changed GitHub viewer", async () => {
  const { api, snapshot, anchor, state } = await setup();
  state.mode = "timeout";
  const result = await api.create(snapshot, anchor, "Keep draft", "operation");
  if (result.status !== "unknown")
    throw new Error("Expected uncertain outcome");
  state.viewer = "another-reviewer";
  expect(await api.reconcile(result.attempt)).toEqual(result);
});
it("coalesces simultaneous sends before any awaits", async () => {
  const { api, snapshot, anchor, state } = await setup();
  const [first, second] = await Promise.all([
    api.create(snapshot, anchor, "Same draft", "operation"),
    api.create(snapshot, anchor, "Same draft", "operation"),
  ]);
  expect(first).toEqual(second);
  expect(state.comments).toHaveLength(1);
});

it("allows intentional identical text with a new operation but reuses the first receipt", async () => {
  const { api, snapshot, anchor, state } = await setup();
  const first = await api.create(snapshot, anchor, "Same", "first-operation");
  expect(await api.create(snapshot, anchor, "Same", "first-operation")).toEqual(
    first,
  );
  expect(
    (await api.create(snapshot, anchor, "Same", "second-operation")).status,
  ).toBe("sent");
  expect(state.comments).toHaveLength(2);
});
it("keeps an unknown attempt unresolved when reconciliation finds no unique match", async () => {
  const { api, snapshot, anchor, state } = await setup();
  state.mode = "timeout";
  const result = await api.create(snapshot, anchor, "Same", "operation");
  if (result.status !== "unknown") throw new Error("Expected unknown");
  const saved = state.comments.splice(0);
  expect(await api.reconcile(result.attempt)).toEqual(result);
  state.comments.push(...saved, ...saved.map((row) => ({ ...row, id: 99 })));
  expect(await api.reconcile(result.attempt)).toEqual(result);
  expect(state.calls.filter((call) => call.args[0] === "POST")).toHaveLength(1);
});
it("refuses a different viewer before dispatch and sends exact captured payloads", async () => {
  const { api, snapshot, anchor, state } = await setup();
  state.viewer = "other";
  expect(await api.create(snapshot, anchor, "Keep", "operation")).toMatchObject(
    { status: "failed", error: { kind: "forbidden" } },
  );
  expect(state.comments).toHaveLength(0);
  state.viewer = snapshot.viewer;
  await api.create(snapshot, anchor, "First", "operation");
  await api.reply(snapshot, 1, "Reply", "reply");
  expect(
    state.calls
      .filter((call) => call.args[0] === "POST")
      .map(({ args, input }) => ({ args, input })),
  ).toEqual([
    {
      args: ["POST", "repos/example-org/sample/pulls/1/comments"],
      input: {
        body: "First",
        commit_id: snapshot.head,
        path: anchor.path,
        side: "LEFT",
        line: 5000,
      },
    },
    {
      args: ["POST", "repos/example-org/sample/pulls/1/comments/1/replies"],
      input: { body: "Reply" },
    },
  ]);
});
it("keeps sent distinct when the next thread refresh fails", async () => {
  const { api, snapshot, anchor, state } = await setup();
  state.mode = "refresh-failed";
  const sent = await api.create(snapshot, anchor, "First", "operation");
  expect(sent.status).toBe("sent");
  await expect(api.loadThreads(fixturePull)).rejects.toMatchObject({
    kind: "transient",
  });
  expect(await api.create(snapshot, anchor, "First", "operation")).toEqual(
    sent,
  );
  expect(state.comments).toHaveLength(1);
});
it("accepts deleted-file LEFT anchors and rejects RIGHT anchors", async () => {
  const { snapshot } = await setup();
  const deleted = {
    ...snapshot,
    files: [{ path: "src/deleted.ts" }],
    diff: `diff --git a/src/deleted.ts b/src/deleted.ts
--- a/src/deleted.ts
+++ /dev/null
@@ -4 +0,0 @@
-old
`,
  };
  const anchor = {
    head: snapshot.head,
    base: snapshot.base,
    path: "src/deleted.ts",
    side: "LEFT",
    line: 4,
  } as const;
  expect(anchorInSnapshot(deleted, anchor)).toBe(true);
  expect(anchorInSnapshot(deleted, { ...anchor, side: "RIGHT" })).toBe(false);
});
it.each(["head", "base"] as const)(
  "detects a %s race during snapshot loading",
  async (field) => {
    const fixture = githubCommentHost();
    fixture.state.onCall = (call) => {
      if (call.id === "diff") fixture.state[field] = "c".repeat(40);
    };
    const api = createPrComments(fixture.host);
    await expect(api?.loadSnapshot(fixturePull)).rejects.toMatchObject({
      kind: "transient",
    });
  },
);
it("reads file pages, outer thread cursors, and nested comment cursors", async () => {
  const { api, snapshot, anchor, state } = await setup();
  state.files = Array.from({ length: 101 }, (_, index) => ({
    filename: `file-${index}`,
    previous_filename: "previous",
  }));
  expect((await api.loadSnapshot(fixturePull)).files).toHaveLength(101);
  await api.create(snapshot, anchor, "First", "first");
  await api.reply(snapshot, 1, "Reply", "reply");
  await api.create(snapshot, anchor, "Second", "second");
  state.pageSize = 1;
  const first = await api.loadThreads(fixturePull);
  expect(first.items).toHaveLength(1);
  expect(first.nextCursor).toBe("1");
  expect(first.items[0]?.commentsCursor).toBe("1");
  expect(
    (await api.loadThreads(fixturePull, first.nextCursor ?? undefined)).items[0]
      ?.comments[0]?.body,
  ).toBe("Second");
  expect((await api.loadComments("thread-1", "1")).items[0]?.body).toBe(
    "Reply",
  );
});
it("normalizes inaccessible PR/thread GraphQL reads", async () => {
  const fixture = githubCommentHost();
  const spawn = async (
    id: string,
    options?: Parameters<typeof fixture.host.spawn>[1],
  ) => {
    if (id !== "graphql") return fixture.host.spawn(id, options);
    return {
      write: async () => {},
      kill: async () => {},
      exited: Promise.resolve(1),
      end: async () => {
        options?.onStdout?.(
          JSON.stringify({
            errors: [{ type: "FORBIDDEN", message: "Access denied" }],
          }),
        );
      },
    };
  };
  const api = createPrComments({ spawn });
  await expect(api?.loadThreads(fixturePull)).rejects.toMatchObject({
    kind: "forbidden",
  });
  await expect(api?.loadComments("thread-1")).rejects.toMatchObject({
    kind: "forbidden",
  });
});
