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
        sig: "c".repeat(128),
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
  const locks = {
    request: (_name, _options, run) => Promise.resolve().then(run),
  };
  const model = createModel(session, storage, () => {}, locks);
  const input = {
    id: taskId,
    channel: channelId,
    title: "Review layouts",
    done: false,
    assignees: [viewer],
  };
  return {
    model,
    locks,
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
    const removed = fixture();
    await removed.model.refresh();
    removed.channel.members = [viewer];
    await expect(
      removed.model.save({ ...removed.input, assignees: [other] }),
    ).rejects.toThrow("no longer");
    removed.model.dispose();
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
    const next = createModel(f.session, f.storage, () => {}, f.locks);
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
    expect(() => f.model.save(f.input)).toThrow("outcome");
    f.model.dispose();
  });
  it("clears a proven unsent attempt and reports read errors instead of an empty list", async () => {
    const f = fixture();
    await f.model.refresh();
    f.session.configArtifactWriter.publish.mockRejectedValueOnce(
      Object.assign(new Error("not sent"), { notSent: true }),
    );
    await expect(f.model.save(f.input)).rejects.toThrow("not sent");
    expect(f.saved.size).toBe(1);
    expect(f.model.snapshot().pending).toBeNull();
    expect(f.model.snapshot().queuePaused).toBe(true);
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

it("shows a new task immediately and retains a definitely unsent draft for retry", async () => {
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
  expect(f.model.snapshot().tasks).toHaveLength(1);
  expect(f.model.snapshot().queuePaused).toBe(true);
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

it("restores every queued task after reload and retries the original signed event", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("offline"),
  );
  const first = f.model.save(f.input);
  const secondInput = {
    ...f.input,
    id: "20000000-0000-4000-8000-000000000002",
    title: "Second",
    dueDate: "2026-12-01",
    assignees: [other],
  };
  void f.model.save(secondInput);
  await expect(first).rejects.toThrow("offline");
  const signed = f.model.snapshot().pending;
  f.model.dispose();
  const next = createModel(f.session, f.storage, () => {}, f.locks);
  await next.refresh();
  expect(next.snapshot().tasks).toHaveLength(2);
  expect(
    next.snapshot().tasks.find((task) => task.id === secondInput.id),
  ).toMatchObject(secondInput);
  await next.retrySaved();
  await vi.waitFor(() => expect(f.records.size).toBe(2));
  expect(f.session.configArtifactWriter.publish.mock.calls[1][0]).toEqual(
    signed,
  );
  expect(f.session.configArtifactWriter.sign).toHaveBeenCalledTimes(2);
  expect(f.saved.size).toBe(0);
  next.dispose();
});

it("keeps a full unsigned draft across reload after signing fails", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.sign.mockRejectedValueOnce(
    new Error("signing unavailable"),
  );
  const draft = {
    ...f.input,
    title: "Keep me",
    dueDate: "2026-12-02",
    assignees: [other],
  };
  await expect(f.model.save(draft)).rejects.toThrow("signing unavailable");
  f.model.dispose();
  const next = createModel(f.session, f.storage, () => {}, f.locks);
  await next.refresh();
  expect(next.snapshot().tasks[0]).toMatchObject(draft);
  expect(next.snapshot().queuePaused).toBe(true);
  expect(f.session.configArtifactWriter.publish).not.toHaveBeenCalled();
  await next.retrySaved();
  expect(f.records.size).toBe(1);
  expect(f.saved.size).toBe(0);
  next.dispose();
});

it("refuses queue admission synchronously when durable storage fails", async () => {
  const f = fixture();
  await f.model.refresh();
  f.storage.setItem = () => {
    throw new Error("storage full");
  };
  expect(() => f.model.save(f.input)).toThrow("storage full");
  expect(f.model.snapshot().tasks).toHaveLength(0);
  expect(f.session.configArtifactWriter.sign).not.toHaveBeenCalled();
  f.model.dispose();
});

it("allows explicit discard of a proven-unsent head and continues the durable queue", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.sign.mockRejectedValueOnce(
    new Error("signing failed"),
  );
  const first = f.model.save(f.input);
  const secondInput = {
    ...f.input,
    id: "20000000-0000-4000-8000-000000000002",
    title: "Second",
  };
  const second = f.model.save(secondInput);
  await expect(first).rejects.toThrow("signing failed");
  f.model.discardUnsent();
  await second;
  expect([...f.records.keys()]).toEqual([secondInput.id]);
  expect(f.saved.size).toBe(0);
  f.model.dispose();
});

it("does not retire an active save during a refresh before its failed acknowledgement", async () => {
  const f = fixture();
  await f.model.refresh();
  let rejectPublish;
  f.session.configArtifactWriter.publish.mockImplementationOnce(
    async (event) => {
      f.records.set(f.input.id, event);
      await new Promise((_resolve, reject) => {
        rejectPublish = reject;
      });
    },
  );
  const first = f.model.save(f.input);
  const second = f.model.save({
    ...f.input,
    id: "20000000-0000-4000-8000-000000000002",
    title: "Second",
  });
  await vi.waitFor(() => expect(rejectPublish).toBeTypeOf("function"));
  await f.model.refresh();
  rejectPublish(new Error("ack lost"));
  await expect(first).rejects.toThrow("ack lost");
  expect(f.model.snapshot().pending).not.toBeNull();
  expect(f.model.snapshot().queuePaused).toBe(false);
  await f.model.refresh();
  await second;
  expect(f.records.size).toBe(2);
  expect(f.saved.size).toBe(0);
  f.model.dispose();
});

it("retires an initial conflict but retains an uncertain attempt when replay conflicts", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("conflict: head changed"),
  );
  await expect(f.model.save(f.input)).rejects.toThrow("conflict:");
  expect(f.model.snapshot().pending).toBeNull();
  expect(f.model.snapshot().queuePaused).toBe(true);
  f.model.discardUnsent();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("timeout"),
  );
  await expect(f.model.save(f.input)).rejects.toThrow("timeout");
  const pending = f.model.snapshot().pending;
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("conflict: head changed"),
  );
  await f.model.retrySaved();
  expect(f.model.snapshot().pending).toEqual(pending);
  expect(f.saved.size).toBe(1);
  f.model.dispose();
});

it("loads a channel even when personal-home discovery fails", async () => {
  const f = fixture();
  await f.model.refresh();
  await f.model.save({ ...f.input, assignees: [] });
  f.session.channels.findLabeled.mockRejectedValue(
    new Error("home lookup unavailable"),
  );
  const stop = f.model.followChannel(channelId);
  await f.model.refresh();
  expect(f.model.snapshot().tasks).toHaveLength(1);
  expect(f.model.snapshot().error).toContain("home lookup unavailable");
  stop();
  f.model.dispose();
});

it("purges a revoked channel and keeps independent personal reads working", async () => {
  const f = fixture();
  let revoked;
  f.session.artifacts = {
    follow: (_ids, _changed, lost) => {
      revoked = lost;
      return () => {};
    },
  };
  await f.model.refresh();
  await f.model.save(f.input);
  const stop = f.model.followChannel(channelId);
  await f.model.refresh();
  const read = f.session.snapshotRead.getMockImplementation();
  f.session.snapshotRead.mockImplementation((filters) => {
    if (filters[0]["#h"]?.includes(channelId))
      throw Object.assign(new Error("denied"), { kind: "denied" });
    return read(filters);
  });
  revoked([channelId]);
  expect(f.model.snapshot().tasks).toHaveLength(0);
  await f.model.refresh();
  expect(f.model.snapshot().tasks).toHaveLength(0);
  expect(f.session.channels.findLabeled).toHaveBeenCalled();
  stop();
  f.model.dispose();
});

it("hands the journal to another window only after the first owner releases it", async () => {
  const f = fixture();
  f.model.dispose();
  let tail = Promise.resolve();
  const locks = {
    request: (_key, { signal }, run) => {
      const next = tail.then(() => {
        if (!signal.aborted) return run();
      });
      tail = next.catch(() => {});
      return next;
    },
  };
  const first = createModel(f.session, f.storage, () => {}, locks);
  await first.refresh();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("offline"),
  );
  await expect(first.save(f.input)).rejects.toThrow("offline");
  const pending = first.snapshot().pending;
  const second = createModel(f.session, f.storage, () => {}, locks);
  await second.refresh();
  expect(() => second.save({ ...f.input, title: "Other window" })).toThrow(
    /another.*window/,
  );
  expect(first.snapshot().pending).toEqual(pending);
  first.dispose();
  await vi.waitFor(() => expect(second.snapshot().readOnly).toBe(false));
  expect(second.snapshot().pending).toEqual(pending);
  await second.retrySaved();
  expect(f.saved.size).toBe(0);
  second.dispose();
});

it("hides restored private drafts until fresh access has been verified", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.sign.mockRejectedValueOnce(
    new Error("signing failed"),
  );
  await expect(f.model.save(f.input)).rejects.toThrow("signing failed");
  f.model.dispose();
  f.channel.members = [other];
  f.session.snapshotRead.mockResolvedValue([]);
  const next = createModel(f.session, f.storage, () => {}, f.locks);
  await next.refresh();
  expect(next.snapshot().tasks).toHaveLength(0);
  expect(next.snapshot().queuedTitle).not.toContain(f.input.title);
  expect(f.saved.size).toBe(1);
  next.dispose();
});

it("prefers a fresh assigned revision over a failed channel's cached revision", async () => {
  const f = fixture();
  await f.model.refresh();
  await f.model.save(f.input);
  f.model.followChannel(channelId);
  await f.model.refresh();
  const old = f.records.get(taskId);
  const updated = {
    ...old,
    id: "f".repeat(64),
    content: JSON.stringify({
      ...JSON.parse(old.content),
      title: "Fresh title",
      done: true,
    }),
  };
  f.records.set(taskId, updated);
  const read = f.session.snapshotRead.getMockImplementation();
  f.session.snapshotRead.mockImplementation((filters) => {
    if (filters[0]["#h"]?.includes(channelId)) throw new Error("offline");
    return read(filters);
  });
  await f.model.refresh();
  expect(
    f.model.snapshot().tasks.find((task) => task.id === taskId),
  ).toMatchObject({
    title: "Fresh title",
    done: true,
    event: { id: updated.id },
  });
  f.model.dispose();
});

it("retains a set-aside uncertain event across restart while unrelated saves continue", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("timeout"),
  );
  await expect(f.model.save(f.input)).rejects.toThrow("timeout");
  const pending = f.model.snapshot().pending;
  f.model.setAside();
  expect(f.model.snapshot().pending).toBeNull();
  expect(f.model.snapshot().asideCount).toBe(1);
  expect(() => f.model.save(f.input)).toThrow("set aside");
  await f.model.save({
    ...f.input,
    id: "20000000-0000-4000-8000-000000000002",
  });
  f.model.dispose();
  const restored = createModel(f.session, f.storage, () => {}, f.locks);
  await restored.refresh();
  expect(restored.snapshot().asideCount).toBe(1);
  await restored.checkAside();
  expect(restored.snapshot().asideCount).toBe(1);
  expect(() => restored.save(f.input)).toThrow("set aside");
  f.records.set(taskId, pending); // The original attempt arrives late.
  await restored.checkAside();
  expect(restored.snapshot().asideCount).toBe(0);
  await restored.save({
    ...f.input,
    title: "Edit after confirmation",
    event: pending,
  });
  expect(f.session.configArtifactWriter.sign).toHaveBeenCalledTimes(3);
  restored.dispose();
});

it("does not release uncertain saves when persisting set-aside state fails", async () => {
  const f = fixture();
  await f.model.refresh();
  f.session.configArtifactWriter.publish.mockRejectedValueOnce(
    new Error("timeout"),
  );
  await expect(f.model.save(f.input)).rejects.toThrow("timeout");
  const pending = f.model.snapshot().pending;
  f.storage.setItem = () => {
    throw new Error("disk full");
  };
  f.model.setAside();
  expect(f.model.snapshot().pending).toEqual(pending);
  expect(f.model.snapshot().asideCount).toBe(0);
  expect(f.model.snapshot().error).toBe("disk full");
  f.model.dispose();
});

it("checks other set-aside saves even when one channel is inaccessible", async () => {
  const f = fixture();
  await f.model.refresh();
  const events = [];
  for (const input of [
    f.input,
    {
      ...f.input,
      channel: home,
      assignees: [],
      id: "20000000-0000-4000-8000-000000000002",
    },
  ]) {
    f.session.configArtifactWriter.publish.mockRejectedValueOnce(
      new Error("timeout"),
    );
    await expect(f.model.save(input)).rejects.toThrow("timeout");
    events.push(f.model.snapshot().pending);
    f.model.setAside();
  }
  f.records.set("personal", events[1]);
  const read = f.session.snapshotRead.getMockImplementation();
  f.session.snapshotRead.mockImplementation((filters) => {
    if (filters[0].ids?.includes(events[0].id)) throw new Error("access lost");
    return read(filters);
  });
  await f.model.checkAside();
  expect(f.model.snapshot().asideCount).toBe(1);
  expect(f.model.snapshot().error).toContain("access lost");
  expect(f.model.snapshot().asideIds).toEqual([taskId]);
  f.model.dispose();
});

it("continues unrelated queued drafts past a set-aside task's queued edit", async () => {
  const f = fixture();
  await f.model.refresh();
  let reject;
  f.session.configArtifactWriter.publish.mockImplementationOnce(
    () =>
      new Promise((_, fail) => {
        reject = fail;
      }),
  );
  const first = f.model.save(f.input);
  const failed = expect(first).rejects.toThrow("timeout");
  await vi.waitFor(() => expect(reject).toBeTypeOf("function"));
  const laterEdit = f.model.save({ ...f.input, title: "Queued edit retained" });
  // A queued promise may remain pending until the uncertain attempt is confirmed.
  void laterEdit.catch(() => {});
  const unrelated = f.model.save({
    ...f.input,
    id: "20000000-0000-4000-8000-000000000002",
    title: "Independent",
  });
  reject(new Error("timeout"));
  await failed;
  f.model.setAside();
  await unrelated;
  expect(f.model.snapshot().asideCount).toBe(1);
  expect(f.model.snapshot().queuePaused).toBe(false);
  expect(
    f.model
      .snapshot()
      .tasks.some((task) => task.title === "Queued edit retained"),
  ).toBe(true);
  expect(JSON.parse([...f.saved.values()][0]).queue).toHaveLength(1);
  f.model.dispose();
});

it("does not restore an old assignment from a failed channel read", async () => {
  const f = fixture();
  await f.model.refresh();
  await f.model.save(f.input);
  f.model.followChannel(channelId);
  await f.model.refresh();
  const read = f.session.snapshotRead.getMockImplementation();
  f.session.snapshotRead.mockImplementation((filters) => {
    if (filters[0]["#h"]?.includes(channelId)) throw new Error("offline");
    if (filters[0]["#p"]) return Promise.resolve([]);
    return read(filters);
  });
  await f.model.refresh();
  expect(f.model.snapshot().tasks).toHaveLength(0);
  expect(f.model.snapshot().error).toContain("offline");
  f.model.dispose();
});

it("preserves a corrupt journal until an explicit backed-up reset", async () => {
  const f = fixture();
  f.model.dispose();
  const key = `buzz-task-list-pending:${f.session.scope}`;
  f.saved.set(key, "{broken");
  const next = createModel(f.session, f.storage, () => {}, f.locks);
  await next.refresh();
  expect(next.snapshot().canResetJournal).toBe(true);
  expect(next.snapshot().readOnly).toBe(true);
  expect(() => next.save(f.input)).toThrow(/left untouched/);
  expect(next.resetDamagedJournal()).toBe(true);
  await next.refresh();
  expect(f.saved.has(key)).toBe(false);
  expect([...f.saved.values()]).toContain("{broken");
  await next.save(f.input);
  expect(f.records.size).toBe(1);
  expect([...f.saved.values()]).toContain("{broken");
  next.dispose();
});

it("does not reset damaged data when its backup cannot be written", async () => {
  const f = fixture();
  f.model.dispose();
  const key = `buzz-task-list-pending:${f.session.scope}`;
  f.saved.set(key, "{broken");
  const next = createModel(f.session, f.storage, () => {}, f.locks);
  await next.refresh();
  f.storage.setItem = () => {
    throw new Error("storage full");
  };
  expect(next.resetDamagedJournal()).toBe(false);
  expect(f.saved.get(key)).toBe("{broken");
  expect(next.snapshot().readOnly).toBe(true);
  next.dispose();
});

it("rejects malformed pending events and unknown journal versions without replay", async () => {
  for (const saved of [
    { version: 2, queue: [] },
    { version: 1, queue: [], pending: { tags: [] } },
  ]) {
    const f = fixture();
    f.model.dispose();
    f.saved.set(
      `buzz-task-list-pending:${f.session.scope}`,
      JSON.stringify(saved),
    );
    const next = createModel(f.session, f.storage, () => {}, f.locks);
    await next.refresh();
    expect(next.snapshot().canResetJournal).toBe(true);
    expect(f.session.configArtifactWriter.publish).not.toHaveBeenCalled();
    next.dispose();
  }
});

it("does not offer a destructive reset after storage access fails", async () => {
  const f = fixture();
  f.model.dispose();
  f.storage.getItem = () => {
    throw new Error("storage unavailable");
  };
  const next = createModel(f.session, f.storage, () => {}, f.locks);
  await next.refresh();
  expect(next.snapshot().canResetJournal).toBe(false);
  expect(next.resetDamagedJournal()).toBe(false);
  next.dispose();
});

it("reports missing host controls and Web Locks before mounting task editors", async () => {
  const { compatibilityError } = await import(
    "../examples/plugins/tasks/plugin.js"
  );
  const ui = {
    Calendar: {},
    PopoverRoot: {},
    PopoverTrigger: {},
    PopoverPopup: {},
  };
  expect(compatibilityError(ui, { request() {} })).toBe("");
  for (const key of Object.keys(ui)) {
    expect(
      compatibilityError({ ...ui, [key]: undefined }, { request() {} }),
    ).toMatch(/date and time/);
  }
  expect(compatibilityError(ui, {})).toMatch(/coordinate/);
});

it("treats existing empty or scalar journal values as damaged, and retries transient access failures", async () => {
  for (const raw of ["", "false", "null", "0"]) {
    const f = fixture();
    f.model.dispose();
    f.saved.set(`buzz-task-list-pending:${f.session.scope}`, raw);
    const next = createModel(f.session, f.storage, () => {}, f.locks);
    await next.refresh();
    expect(next.snapshot().canResetJournal).toBe(true);
    expect(next.damagedJournalText()).toBe(raw);
    next.dispose();
  }
  const f = fixture();
  f.model.dispose();
  const get = f.storage.getItem;
  f.storage.getItem = () => {
    throw new Error("temporarily unavailable");
  };
  const next = createModel(f.session, f.storage, () => {}, f.locks);
  await next.refresh();
  expect(next.snapshot().readOnly).toBe(true);
  f.storage.getItem = get;
  next.retryRecovery();
  await next.refresh();
  expect(next.snapshot().readOnly).toBe(false);
  await next.save(f.input);
  next.dispose();
});

it("retains a confirmed personal write when the post-save current-head refresh fails", async () => {
  const f = fixture();
  await f.model.refresh();
  const read = f.session.snapshotRead.getMockImplementation();
  f.session.snapshotRead.mockImplementation((filters, options) => {
    if (filters[0].artifact === "current" && f.records.size)
      throw new Error("list timeout");
    return read(filters, options);
  });
  await f.model.save({ ...f.input, channel: home });
  expect(f.model.snapshot().pending).toBeNull();
  expect(
    f.model.snapshot().tasks.find((task) => task.id === taskId)?.title,
  ).toBe(f.input.title);
  await f.model.refresh();
  expect(
    f.model.snapshot().tasks.find((task) => task.id === taskId)?.title,
  ).toBe(f.input.title);
  f.session.snapshotRead.mockImplementation(read);
  await f.model.refresh();
  expect(f.model.snapshot().tasks).toHaveLength(1);
  f.model.dispose();
});

it("retires accepted assigned overlays after a complete fresh absence", async () => {
  const f = fixture();
  await f.model.refresh();
  const read = f.session.snapshotRead.getMockImplementation();
  f.session.snapshotRead.mockImplementation((filters, options) => {
    if (filters[0].artifact === "current" && f.records.size)
      throw new Error("list timeout");
    return read(filters, options);
  });
  await f.model.save(f.input);
  expect(f.model.snapshot().tasks).toHaveLength(1);
  f.records.clear();
  f.session.snapshotRead.mockImplementation(read);
  await f.model.refresh();
  expect(f.model.snapshot().tasks).toHaveLength(0);
  f.model.dispose();
});

it("an accepted unassignment overrides an old assigned fallback during a read failure", async () => {
  const f = fixture();
  await f.model.refresh();
  await f.model.save(f.input);
  const original = f.model.snapshot().tasks[0];
  const read = f.session.snapshotRead.getMockImplementation();
  f.session.snapshotRead.mockImplementation((filters, options) => {
    if (filters[0].artifact === "current" && !filters[0]["#d"])
      throw new Error("list timeout");
    return read(filters, options);
  });
  await f.model.save({ ...original, assignees: [] });
  expect(f.model.snapshot().tasks).toHaveLength(0);
  f.model.dispose();
});
