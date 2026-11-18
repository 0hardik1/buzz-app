import { describe, it, expect, vi } from "vitest";
import {
  matchesAssignee,
  dueValue,
  dueInputs,
  createModel,
  parseTask,
  taskTemplate,
} from "../examples/plugins/tasks/plugin.js";
const viewer = "a".repeat(64),
  other = "b".repeat(64);
const home = "10000000-0000-4000-8000-000000000001",
  channelId = "10000000-0000-4000-8000-000000000002";
const taskId = "20000000-0000-4000-8000-000000000001";
function fixture() {
  const records = new Map(),
    saved = new Map();
  const personal = {
    id: home,
    name: "Personal tasks",
    channelType: "system",
    visibility: "private",
    creator: viewer,
    members: [viewer],
  };
  const channel = {
    id: channelId,
    name: "Design",
    channelType: "stream",
    visibility: "public",
    members: [viewer, other],
  };
  let live = () => {},
    sequence = 0;
  const session = {
    scope: `relay:${viewer}`,
    viewer,
    channels: {
      findLabeled: vi.fn(async () => [personal]),
      get: (id) => (id === home ? personal : channel),
      list: () => ({ channels: [channel] }),
      resolve: vi.fn(async () => {}),
      refreshRoster: vi.fn(async () => true),
    },
    snapshotRead: vi.fn(async ([filter]) =>
      [...records.values()].filter(
        (event) =>
          (!filter.ids || filter.ids.includes(event.id)) &&
          (!filter["#p"] ||
            event.tags.some(
              ([key, value]) => key === "p" && filter["#p"].includes(value),
            )) &&
          (!filter["#h"]
            ? event.tags.find(([key]) => key === "h")[1] !== home
            : filter["#h"].includes(
                event.tags.find(([key]) => key === "h")[1],
              )) &&
          (!filter["#d"] ||
            filter["#d"].includes(event.tags.find(([key]) => key === "d")[1])),
      ),
    ),
    configArtifactWriter: {
      sign: vi.fn(async (event) => ({
        ...event,
        pubkey: viewer,
        id: (++sequence).toString(16).padStart(64, "0"),
      })),
      publish: vi.fn(async (event) => {
        records.set(event.tags.find(([key]) => key === "d")[1], event);
      }),
      isNotSent: (error) => error.notSent === true,
    },
    subscribeLive: (listener) => {
      live = listener;
      return () => {
        live = () => {};
      };
    },
    channelCreation: { create: vi.fn(async () => home) },
  };
  const storage = {
    getItem: (key) => saved.get(key),
    setItem: (key, value) => saved.set(key, value),
    removeItem: (key) => saved.delete(key),
  };
  const model = createModel(session, storage, () => {});
  const input = {
    id: taskId,
    channel: channelId,
    title: "Review layouts",
    done: false,
    assignees: [viewer],
  };
  return {
    model,
    session,
    storage,
    records,
    personal,
    channel,
    input,
    saved,
    live: (events) => live({ events }),
  };
}
describe("Tasks plugin", () => {
  it("validates records and preserves revision and assignment tags", () => {
    const f = fixture(),
      event = { ...taskTemplate(f.input), id: "c".repeat(64) };
    expect(parseTask(event).title).toBe("Review layouts");
    expect(
      taskTemplate({ ...parseTask(event), done: true }).tags,
    ).toContainEqual(["prev", event.id]);
    expect(event.tags).toContainEqual(["p", viewer]);
    expect(
      parseTask({ ...event, content: '{"version":1,"title":"broken"}' }),
    ).toBeNull();
    expect(() => taskTemplate({ ...f.input, title: " " })).toThrow();
    f.model.dispose();
  });
  it("creates, confirms, completes and reopens a shared task", async () => {
    const f = fixture();
    await f.model.refresh();
    await f.model.save(f.input);
    expect(f.model.snapshot().tasks).toHaveLength(1);
    await f.model.save({ ...f.model.snapshot().tasks[0], done: true });
    expect(f.model.snapshot().tasks[0].done).toBe(true);
    await f.model.save({ ...f.model.snapshot().tasks[0], done: false });
    expect(f.model.snapshot().tasks[0].done).toBe(false);
    expect(f.saved.size).toBe(0);
    f.model.dispose();
  });
  it("limits the personal query to assigned tasks", async () => {
    const f = fixture();
    await f.model.refresh();
    await f.model.save({ ...f.input, assignees: [] });
    await f.model.refresh();
    expect(f.model.snapshot().tasks).toHaveLength(0);
    expect(f.session.snapshotRead).toHaveBeenCalledWith(
      [expect.objectContaining({ "#p": [viewer] })],
      expect.anything(),
    );
    f.model.dispose();
  });
  it("keeps loaded tasks when a refresh times out", async () => {
    const f = fixture();
    await f.model.refresh();
    await f.model.save(f.input);
    f.session.snapshotRead.mockRejectedValueOnce(
      new Error("Relay read timed out"),
    );
    await f.model.refresh();
    expect(f.model.snapshot().tasks).toHaveLength(1);
    expect(f.model.snapshot().error).toBe("Relay read timed out");
    await f.model.refresh();
    expect(f.model.snapshot().error).toBe("");
    f.model.dispose();
  });
  it("puts personal tasks only in the verified private home", async () => {
    const f = fixture();
    await f.model.refresh();
    await f.model.save({ ...f.input, channel: undefined, assignees: [] });
    expect(f.model.snapshot().tasks[0]).toMatchObject({
      channel: home,
      assignees: [],
    });
    expect(f.session.channelCreation.create).not.toHaveBeenCalled();
    f.model.dispose();
  });
  it("rejects stale edits and removed assignees before publication", async () => {
    const f = fixture();
    await f.model.refresh();
    await f.model.save(f.input);
    const old = f.model.snapshot().tasks[0];
    await f.model.save({ ...old, done: true });
    await expect(f.model.save({ ...old, title: "stale" })).rejects.toThrow(
      "changed elsewhere",
    );
    f.channel.members = [viewer];
    await expect(
      f.model.save({ ...f.input, assignees: [other] }),
    ).rejects.toThrow("no longer");
    expect(f.session.configArtifactWriter.publish).toHaveBeenCalledTimes(2);
    f.model.dispose();
  });
  it("recovers uncertain delivery after restart without publishing twice", async () => {
    const f = fixture();
    await f.model.refresh();
    f.session.configArtifactWriter.publish.mockImplementationOnce(
      async (event) => {
        f.records.set(taskId, event);
        throw new Error("connection lost");
      },
    );
    await expect(f.model.save(f.input)).rejects.toThrow("connection lost");
    expect(f.model.snapshot().pending).not.toBeNull();
    f.model.dispose();
    const next = createModel(f.session, f.storage, () => {});
    await next.refresh();
    expect(next.snapshot().pending).toBeNull();
    expect(next.snapshot().tasks).toHaveLength(1);
    expect(f.session.configArtifactWriter.publish).toHaveBeenCalledTimes(1);
    next.dispose();
  });
  it("keeps an unknown save blocked and retains its exact event", async () => {
    const f = fixture();
    await f.model.refresh();
    f.session.configArtifactWriter.publish.mockRejectedValueOnce(
      new Error("network"),
    );
    await expect(f.model.save(f.input)).rejects.toThrow("network");
    await f.model.refresh();
    expect(f.saved.size).toBe(1);
    await expect(f.model.save(f.input)).rejects.toThrow("outcome");
    f.model.dispose();
  });
  it("clears a proven unsent attempt and reports read errors instead of an empty list", async () => {
    const f = fixture();
    await f.model.refresh();
    f.session.configArtifactWriter.publish.mockRejectedValueOnce(
      Object.assign(new Error("not sent"), { notSent: true }),
    );
    await expect(f.model.save(f.input)).rejects.toThrow("not sent");
    expect(f.saved.size).toBe(0);
    f.session.snapshotRead.mockRejectedValueOnce(new Error("offline"));
    await f.model.refresh();
    expect(f.model.snapshot().error).toBe("offline");
    f.model.dispose();
  });
  it("does not update a disposed account from a late read", async () => {
    const f = fixture();
    let finish;
    f.session.snapshotRead.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = f.model.refresh();
    await vi.waitFor(() => expect(finish).toBeTypeOf("function"));
    f.model.dispose();
    finish([]);
    await pending;
    expect(f.model.snapshot().loading).toBe(true);
  });
  it("retries the same saved event without signing a duplicate task", async () => {
    const f = fixture();
    await f.model.refresh();
    f.session.configArtifactWriter.publish.mockRejectedValueOnce(
      new Error("network"),
    );
    await expect(f.model.save(f.input)).rejects.toThrow("network");
    const signed = f.model.snapshot().pending;
    await f.model.retrySaved();
    expect(f.session.configArtifactWriter.sign).toHaveBeenCalledTimes(1);
    expect(f.session.configArtifactWriter.publish.mock.calls[1][0]).toEqual(
      signed,
    );
    expect(f.model.snapshot().pending).toBeNull();
    expect(f.model.snapshot().tasks).toHaveLength(1);
    f.model.dispose();
  });
  it("refuses personal edits after the list is shared with someone else", async () => {
    const f = fixture();
    await f.model.refresh();
    await f.model.save({ ...f.input, channel: undefined });
    const task = f.model.snapshot().tasks[0];
    f.personal.members.push(other);
    await expect(f.model.save({ ...task, done: true })).rejects.toThrow(
      "no longer private",
    );
    expect(f.session.configArtifactWriter.publish).toHaveBeenCalledTimes(1);
    f.model.dispose();
  });
  it("round-trips dates and timed deadlines while preserving older tasks", () => {
    const f = fixture();
    expect(dueValue("2026-11-20", "")).toEqual({
      dueDate: "2026-11-20",
      dueAt: null,
      dueTime: null,
    });
    const due = dueValue("2026-11-20", "16:30");
    expect(dueInputs(due)).toEqual({ date: "2026-11-20", time: "16:30" });
    const task = parseTask({
      ...taskTemplate({ ...f.input, ...due }),
      id: "c".repeat(64),
    });
    expect(task.dueAt).toBe(due.dueAt);
    expect(
      JSON.parse(taskTemplate({ ...task, done: true }).content).dueAt,
    ).toBe(due.dueAt);
    expect(dueValue("", "")).toEqual({
      dueDate: null,
      dueAt: null,
      dueTime: null,
    });
    expect(() => dueValue("2026-02-30", "")).toThrow();
    const timeOnly = parseTask({
      ...taskTemplate({ ...f.input, ...dueValue("", "16:30") }),
      id: "d".repeat(64),
    });
    expect(dueInputs(timeOnly)).toEqual({
      date: dueInputs({ dueAt: new Date().toISOString() }).date,
      time: "16:30",
    });
    expect(timeOnly.dueAt).not.toBeNull();
    expect(timeOnly.dueDate).toBeNull();
    expect(() => dueValue("", "25:00")).toThrow();
    expect(() => dueValue("2026-11-20", "25:00")).toThrow();
    expect(
      parseTask({
        ...taskTemplate(f.input),
        content: JSON.stringify({
          version: 1,
          title: "Legacy",
          done: false,
          assignees: [],
        }),
      }).dueAt,
    ).toBeNull();
    f.model.dispose();
  });
});

it("shows a new task immediately, survives refresh, and rolls back a definitely unsent save", async () => {
  const f = fixture();
  await f.model.refresh();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  f.session.configArtifactWriter.sign.mockImplementationOnce(async () => {
    await gate;
    throw new Error("Signing failed");
  });
  const save = f.model.save(f.input);
  const rejected = expect(save).rejects.toThrow("Signing failed");
  try {
    expect(f.model.snapshot().tasks[0].title).toBe(f.input.title);
    await f.model.refresh();
    expect(f.model.snapshot().tasks).toHaveLength(1);
  } finally {
    release();
  }
  await rejected;
  expect(f.model.snapshot().tasks).toHaveLength(0);
  expect(f.model.snapshot().error).toContain("Signing failed");
  f.model.dispose();
});

it("keeps an uncertain save visible and retries the exact signed event without duplicating the task", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("Connection lost"),
  );
  await expect(f.model.save(f.input)).rejects.toThrow("Connection lost");
  expect(f.model.snapshot().tasks).toHaveLength(1);
  expect(f.model.snapshot().pending).not.toBeNull();
  await f.model.retrySaved();
  expect(f.model.snapshot().tasks).toHaveLength(1);
  expect(f.session.configArtifactWriter.sign).toHaveBeenCalledTimes(1);
  f.model.dispose();
});

it("queues consecutive tasks immediately and publishes one at a time", async () => {
  const f = fixture();
  await f.model.refresh();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const publish =
    f.session.configArtifactWriter.publish.getMockImplementation();
  f.session.configArtifactWriter.publish.mockImplementationOnce(
    async (event) => {
      await gate;
      await publish(event);
    },
  );
  const first = f.model.save(f.input);
  const secondInput = {
    ...f.input,
    id: "20000000-0000-4000-8000-000000000002",
    title: "Second task",
  };
  const second = f.model.save(secondInput);
  expect(f.model.snapshot().tasks.map((task) => task.title)).toEqual([
    "Second task",
    f.input.title,
  ]);
  await vi.waitFor(() =>
    expect(f.session.configArtifactWriter.publish).toHaveBeenCalledTimes(1),
  );
  release();
  await Promise.all([first, second]);
  expect(f.records.size).toBe(2);
  const ids = f.model.snapshot().tasks.map((task) => task.id);
  expect(ids).toEqual([secondInput.id, f.input.id]);
  const original = f.model
    .snapshot()
    .tasks.find((task) => task.id === f.input.id);
  await f.model.save({ ...original, title: "Edited older task" });
  await f.model.refresh();
  expect(f.model.snapshot().tasks.map((task) => task.id)).toEqual(ids);
  expect(f.model.snapshot().tasks[1].createdAt).toBe(original.createdAt);
  expect(f.model.snapshot().savingIds).toEqual([]);
  f.model.dispose();
});

it("pauses queued tasks on an uncertain save and resumes after exact-event recovery", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("Connection lost"),
  );
  const first = f.model.save(f.input);
  const second = f.model.save({
    ...f.input,
    id: "20000000-0000-4000-8000-000000000002",
    title: "Second task",
  });
  await expect(first).rejects.toThrow("Connection lost");
  expect(f.model.snapshot().tasks).toHaveLength(2);
  expect(f.session.configArtifactWriter.sign).toHaveBeenCalledTimes(1);
  await f.model.retrySaved();
  await second;
  expect(f.records.size).toBe(2);
  expect(f.session.configArtifactWriter.sign).toHaveBeenCalledTimes(2);
  f.model.dispose();
});

describe("assignee search", () => {
  const profile = {
    name: "alexw",
    username: "awalker",
    verified: {
      displayName: "Alex",
      fullName: "Alex Walker",
      username: "alex.w",
    },
  };
  it("matches full names, display names and handles case-insensitively", () => {
    for (const query of [
      "Walker",
      " ALEX WALKER ",
      "Alex",
      "@awalker",
      "alex.w",
      "alexw",
    ])
      expect(matchesAssignee(profile, query)).toBe(true);
    expect(matchesAssignee(profile, "Beatrice")).toBe(false);
  });
  it("handles missing profiles and optional names", () => {
    expect(matchesAssignee(undefined, "")).toBe(true);
    expect(matchesAssignee(undefined, "Alex")).toBe(false);
    expect(matchesAssignee({ name: "Alex" }, "alex")).toBe(true);
  });
});

it("preserves the legacy event timestamp when an older task is edited", () => {
  const f = fixture();
  const event = {
    ...taskTemplate(f.input),
    created_at: 1000,
    id: "c".repeat(64),
  };
  const body = JSON.parse(event.content);
  delete body.createdAt;
  event.content = JSON.stringify(body);
  const task = parseTask(event);
  expect(task.createdAt).toBe(1000000);
  expect(parseTask(taskTemplate({ ...task, title: "Changed" })).createdAt).toBe(
    1000000,
  );
  f.model.dispose();
});

it("rejects titles exceeding the relay UTF-8 byte limit before signing", () => {
  const f = fixture();
  expect(() => taskTemplate({ ...f.input, title: "é".repeat(300) })).toThrow(
    "too long",
  );
  expect(() => taskTemplate({ ...f.input, title: "😀".repeat(129) })).toThrow(
    "too long",
  );
  expect(() =>
    taskTemplate({ ...f.input, title: "é".repeat(256) }),
  ).not.toThrow();
  f.model.dispose();
});
