import { expect, it, vi } from "vitest";
import { PublishRejected } from "../../features/relay/outbox";
import type { RelayEvent } from "../../features/relay/events";
import type { RelaySession } from "../../features/relay/session";
import type { ArtifactEntry } from "../../features/artifact-storage/types";
import type { ArtifactStorage } from "../../features/artifact-storage/service";
import {
  createTaskFields,
  reviseTask,
  taskOf,
  type TaskFields,
  type Task,
} from "./model";
import {
  openTasksTable,
  readTask,
  readTasks,
  saveTask,
  taskCollection,
} from "./store";

const viewer = "a".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
const home = "22222222-2222-4222-8222-222222222222";
const otherId = "33333333-3333-4333-8333-333333333333";
const fields = createTaskFields({
  title: "Fix the tracker",
  why: "Work should survive a new session.",
  done_when: "A fresh agent can find it.",
});

function event(
  fieldsValue: TaskFields,
  revision = "d".repeat(64),
  taskId = id,
  at = 5,
) {
  return {
    id: revision,
    pubkey: viewer,
    sig: "",
    created_at: at,
    kind: 45010,
    content: JSON.stringify({
      version: 4,
      title: fieldsValue.title,
      why: fieldsValue.why,
      done_when: fieldsValue.done_when,
      state: fieldsValue.state,
      links: fieldsValue.links,
      log: fieldsValue.log,
    }),
    tags: [
      ["ar", "1"],
      ["d", taskId],
      ["h", home],
      ["type", "buzz.task"],
      ["op", revision === "d".repeat(64) ? "create" : "update"],
      ["title", fieldsValue.title],
      ["state", fieldsValue.state],
    ],
  };
}

function setup(publish: () => Promise<string>, heads = [event(fields)]) {
  const snapshotRead = vi.fn(async () => heads);
  const sign = vi.fn(async (template: object) => ({
    ...template,
    id: "f".repeat(64),
    pubkey: viewer,
    sig: "",
  }));
  const session = {
    viewer,
    relayAuthor: "e".repeat(64),
    snapshotRead,
    configArtifactWriter: { sign, publish: vi.fn(publish) },
  } as unknown as RelaySession;
  return { session, sign, publish: session.configArtifactWriter?.publish };
}

it("reads current Task v2 rows and filters by state and home", async () => {
  const { session } = setup(async () => "");
  const found = await readTasks(session, new AbortController().signal, {
    states: ["open", "waiting"],
    home,
  });
  expect(found.tasks).toEqual([taskOf(event(fields))]);
  expect(found.complete).toBe(true);
  expect(session.snapshotRead).toHaveBeenCalledWith(
    [
      expect.objectContaining({
        artifact: "current",
        "#state": ["open", "waiting"],
        "#h": [home],
        limit: 500,
      }),
    ],
    expect.anything(),
  );
  expect(await readTask(session, id, new AbortController().signal)).toEqual(
    taskOf(event(fields)),
  );
});

it("creates and updates compare-and-set revisions with the Task v2 schema", async () => {
  const { session, sign } = setup(async () => "");
  const created = await saveTask(session, session, fields, {
    op: "create",
    home,
    id,
    via: "9".repeat(64),
  });
  expect(created.status).toBe("saved");
  const first = sign.mock.calls[0]?.[0] as {
    tags: string[][];
    content: string;
  };
  expect(first.tags).toContainEqual(["op", "create"]);
  expect(first.tags).toContainEqual(["via", "9".repeat(64)]);
  expect(first.tags.some(([name]) => name === "prev")).toBe(false);
  expect(JSON.parse(first.content)).toMatchObject({
    version: 4,
    title: fields.title,
    state: "open",
  });
  if (created.status !== "saved") return;
  const updated = reviseTask(
    created.task,
    { state: "done" },
    "Found after restart.",
    10,
  );
  await saveTask(session, session, updated, {
    op: "update",
    base: created.task,
  });
  const second = sign.mock.calls[1]?.[0] as { tags: string[][] };
  expect(second.tags).toContainEqual(["op", "update"]);
  expect(second.tags).toContainEqual(["prev", created.task.revision]);
  expect(second.tags.some(([name]) => name === "via")).toBe(false);
});

it("returns the other writer's head on conflict", async () => {
  const theirs = event(
    reviseTask(fields, { state: "open" }, "Someone else started it.", 8),
    "c".repeat(64),
  );
  const { session } = setup(async () => {
    throw new PublishRejected("rejected", "conflict: stale prev");
  }, [theirs]);
  const base = taskOf(event(fields)) as Task;
  const result = await saveTask(
    session,
    session,
    reviseTask(base, {}, "My concurrent note.", 9),
    { op: "update", base },
  );
  expect(result).toEqual({ status: "conflict", current: taskOf(theirs) });
});

it("confirms an uncertain save by its signed revision id", async () => {
  const { session } = setup(async () => {
    throw new Error("socket closed");
  }, [event(fields, "f".repeat(64))]);
  const base = taskOf(event(fields)) as Task;
  const saved = await saveTask(session, session, fields, {
    op: "update",
    base,
  });
  expect(saved.status).toBe("saved");
  expect(saved.status === "saved" && saved.task.revision).toBe("f".repeat(64));
});

function entry(value: ReturnType<typeof event>): ArtifactEntry {
  return {
    record: {
      id: value.id,
      channelId: home,
      type: "buzz.task",
      current: {
        id: value.id,
        content: value.content,
        event: value as unknown as RelayEvent,
      },
      availability: { state: "available" },
    },
  };
}

it("subscribes before reading the table and replaces a notified scan", async () => {
  let rows = [entry(event(fields))];
  const listeners = new Set<() => void>();
  const calls: string[] = [];
  const collection = {
    subscribe(listener: () => void) {
      calls.push("subscribe");
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async page() {
      calls.push("page");
      return { entries: rows };
    },
    async refreshError() {
      return null;
    },
    close: vi.fn(),
  };
  const storage = {
    open: vi.fn(() => collection),
  } as unknown as ArtifactStorage;
  const table = openTasksTable(storage);
  await vi.waitFor(() => expect(table.snapshot().status).toBe("ready"));
  expect(calls[0]).toBe("subscribe");
  expect(table.snapshot().tasks.map((task) => task.id)).toEqual([id]);
  rows = [entry(event(fields, "e".repeat(64), otherId))];
  for (const listener of listeners) listener();
  await vi.waitFor(() =>
    expect(table.snapshot().tasks.map((task) => task.id)).toEqual([otherId]),
  );
  expect(calls.filter((call) => call === "page").length).toBeGreaterThanOrEqual(
    2,
  );
  table.close();
  expect(collection.close).toHaveBeenCalledOnce();
  expect(listeners.size).toBe(0);
});

it("uses a complete current read when incremental storage sync is unavailable", async () => {
  const current = event(fields, "e".repeat(64), otherId, 10);
  const collection = {
    subscribe: () => () => {},
    page: async () => ({ entries: [entry(event(fields))] }),
    refreshError: async () => null,
    close: vi.fn(),
  };
  const storage = {
    open: vi.fn(() => collection),
  } as unknown as ArtifactStorage;
  const read = vi.fn(async (_filters: readonly unknown[]) => [current]);
  const source = {
    snapshotRead: read,
    relayAuthor: "relay",
  } as unknown as RelaySession;
  const table = openTasksTable(storage, source);
  await vi.waitFor(() => expect(table.snapshot().status).toBe("ready"));
  expect(table.snapshot().tasks.map((task) => task.id)).toEqual([otherId]);
  expect(read.mock.calls[0]?.[0]).toEqual([
    {
      artifact: "current",
      kinds: [45010],
      "#type": ["buzz.task"],
      limit: 500,
    },
  ]);
  table.close();
});

it("projects newest activity first, including a state index", () => {
  const projected = taskCollection.project(entry(event(fields)));
  expect(projected.map(({ index, value }) => [index, value])).toEqual([
    ["all", ""],
    ["state", "open"],
  ]);
  const newer = taskCollection.project(
    entry(event(fields, "e".repeat(64), otherId, 10)),
  )[0];
  const currentOrder = projected[0]?.order;
  const newerOrder = newer?.order;
  if (currentOrder === undefined || newerOrder === undefined)
    throw new Error("Missing projection orders");
  expect(newerOrder < currentOrder).toBe(true);
});
