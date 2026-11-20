import { describe, expect, it } from "vitest";
import {
  createTaskFields,
  inferLinkKind,
  latestNote,
  matchesWords,
  reviseTask,
  TASK_CONTENT_VERSION,
  TASK_TYPE,
  taskContent,
  taskOf,
  taskTags,
  type TaskFields,
} from "./model";

const id = "11111111-1111-4111-8111-111111111111";
const home = "22222222-2222-4222-8222-222222222222";
const viewer = "a".repeat(64);

function fields(): TaskFields {
  return createTaskFields(
    {
      title: "Track work",
      why: "Agents need the reason to make judgment calls.",
      done_when: "The task and its evidence can be found again.",
      links: [{ kind: "thread", url: "buzz://message?channel=one&id=two" }],
    },
    "Captured from the planning thread.",
    100,
  );
}

function event(extra: Record<string, unknown> = {}) {
  const value = fields();
  return {
    id: "f".repeat(64),
    pubkey: viewer,
    sig: "",
    created_at: 101,
    kind: 45010,
    content: JSON.stringify({
      ...JSON.parse(taskContent(value)),
      futureTopLevel: { keep: true },
      ...extra,
    }),
    tags: [
      ["ar", "1"],
      ["d", id],
      ["h", home],
      ["type", TASK_TYPE],
      ["title", value.title],
      ["state", value.state],
      ["op", "create"],
      ["future_tag", "keep"],
    ],
  };
}

describe("Task v2 record", () => {
  it("round-trips every field and preserves same-version unknown data on edit", () => {
    const original = event();
    const body = JSON.parse(original.content) as Record<string, unknown>;
    body.log = [{ ...valueAt(body), futureLogKey: "also keep" }];
    body.links = [
      {
        kind: "pr",
        url: "https://github.com/block/buzz/pull/1",
        review: "keep",
      },
    ];
    original.content = JSON.stringify(body);
    const task = taskOf(original);
    expect(task).toBeDefined();
    expect(task?.state).toBe("open");
    expect(task?.log[0]).toMatchObject({ futureLogKey: "also keep" });
    const updated = reviseTask(
      task as NonNullable<typeof task>,
      { state: "done" },
      "Merged in PR 1.",
      102,
    );
    const saved = JSON.parse(
      taskContent(updated, task?.preserved.content),
    ) as Record<string, unknown>;
    expect(saved).toMatchObject({
      version: TASK_CONTENT_VERSION,
      futureTopLevel: { keep: true },
      state: "done",
    });
    expect(saved.log).toEqual([
      expect.objectContaining({ futureLogKey: "also keep" }),
      { at: 102, note: "Merged in PR 1.", state: "done" },
    ]);
    expect(saved.links).toEqual([expect.objectContaining({ review: "keep" })]);
    expect(taskTags(updated, task)).toContainEqual(["future_tag", "keep"]);
    expect(taskTags(updated, task)).toContainEqual(["state", "done"]);
    expect(latestNote(updated)).toBe("Merged in PR 1.");
  });

  it("rejects unsafe links, missing context and unknown record versions", () => {
    expect(taskOf(event({ version: 99 }))).toBeUndefined();
    expect(taskOf(event({ state: "proposed" }))).toBeUndefined();
    expect(() =>
      createTaskFields({ title: "X", why: "", done_when: "Done" }),
    ).toThrow("why this matters");
    expect(() =>
      createTaskFields({
        title: "X",
        why: "Y",
        done_when: "Z",
        links: [{ kind: "other", url: "javascript:alert(1)" }],
      }),
    ).toThrow("https or buzz");
  });

  it("appends rather than edits prior notes, and searches the task context", () => {
    const base = taskOf(event());
    if (!base) throw new Error("fixture did not parse");
    const prior = base.log;
    const updated = reviseTask(
      base,
      { state: "waiting" },
      "Blocked on API access.",
      110,
    );
    expect(base.log).toBe(prior);
    expect(base.log).toHaveLength(1);
    expect(updated.log).toHaveLength(2);
    expect(updated.log[1]).toEqual({
      at: 110,
      note: "Blocked on API access.",
      state: "waiting",
    });
    expect(matchesWords(base, "judgment planning")).toBe(true);
    expect(matchesWords(base, "unrelated")).toBe(false);
    expect(() => reviseTask(base, {}, " ")).toThrow("Add a note");
  });

  it("infers link kinds without accepting arbitrary schemes", () => {
    expect(inferLinkKind("https://github.com/block/buzz-app/pull/42")).toBe(
      "pr",
    );
    expect(inferLinkKind("https://github.com/block/buzz-app/issues/42")).toBe(
      "issue",
    );
    expect(inferLinkKind("buzz://message?channel=a&id=b")).toBe("thread");
    expect(inferLinkKind("buzz://agent/session/abc")).toBe("session");
  });
});

function valueAt(body: Record<string, unknown>) {
  const log = body.log as Record<string, unknown>[];
  return log[0] ?? {};
}
