// The UI reads a durable plugin-owned IndexedDB table. The host keeps that
// table current from the relay. Shared writes still go through NIP-AR and are
// compared with the exact revision the editor opened.
import {
  ARTIFACT_KIND,
  deliver,
  type Delivery,
} from "../../features/agents/agent-config-artifacts";
import type {
  ArtifactCollectionDefinition,
  ArtifactEntry,
  ArtifactPageQuery,
} from "../../features/artifact-storage/types";
import type { ArtifactStorage } from "../../features/artifact-storage/service";
import type { RelayEvent } from "../../features/relay/events";
import type { RelaySession } from "../../features/relay/session";
import {
  byRecent,
  checkedFields,
  isChannelId,
  TASK_CONTENT_VERSION,
  TASK_TYPE,
  taskContent,
  taskOf,
  taskTags,
  type Task,
  type TaskFields,
  type TaskState,
} from "./model";

const READ_LIMIT = 500;
const PAGE_LIMIT = 250;
const taskFilter = { kinds: [ARTIFACT_KIND], "#type": [TASK_TYPE] };

export type TaskSource = Pick<RelaySession, "snapshotRead" | "relayAuthor">;
export type TaskQuery = Readonly<{
  states?: readonly TaskState[] | undefined;
  home?: string | undefined;
}>;

const toTasks = (events: readonly RelayEvent[]) =>
  events.flatMap((event) => taskOf(event) ?? []);

/** One finite read through either the selected session or an agent's own relay. */
export async function readTasks(
  source: TaskSource,
  signal: AbortSignal,
  query: TaskQuery = {},
): Promise<Readonly<{ tasks: readonly Task[]; complete: boolean }>> {
  const read = source.snapshotRead;
  if (!read) throw new Error("Tasks aren’t available in this community.");
  const events = await read(
    [
      {
        artifact: "current",
        ...taskFilter,
        ...(query.states?.length ? { "#state": [...query.states] } : {}),
        ...(query.home ? { "#h": [query.home] } : {}),
        limit: READ_LIMIT,
      },
    ],
    { signal },
  );
  return {
    tasks: toTasks(events).sort(byRecent),
    complete: events.length < READ_LIMIT,
  };
}

export async function readTask(
  source: TaskSource,
  id: string,
  signal: AbortSignal,
): Promise<Task | undefined> {
  const read = source.snapshotRead;
  if (!read) throw new Error("Tasks aren’t available in this community.");
  if (!isChannelId(id)) return undefined;
  const events = await read(
    [
      {
        artifact: "current",
        ...taskFilter,
        "#d": [id],
        limit: 2,
      },
    ],
    { signal },
  );
  const tasks = toTasks(events).filter((task) => task.id === id);
  return tasks.length === 1 ? tasks[0] : undefined;
}

export type SaveResult =
  | Readonly<{ status: "saved"; task: Task }>
  | Readonly<{ status: "conflict"; current: Task }>;

export type SaveTarget =
  | Readonly<{ op: "create"; home: string; id: string; via?: string }>
  | Readonly<{ op: "update"; base: Task; via?: string }>;

/** A new id is chosen before signing, so an uncertain create can be found. */
export async function saveTask(
  session: RelaySession,
  reader: TaskSource,
  fields: TaskFields,
  target: SaveTarget,
  signal: AbortSignal = AbortSignal.timeout(20_000),
): Promise<SaveResult> {
  const writer = session.configArtifactWriter;
  if (!session.snapshotRead || !writer || !session.viewer)
    throw new Error("This community connection can’t save tasks.");
  const checked = checkedFields(fields);
  const base = target.op === "update" ? target.base : undefined;
  const id = base?.id ?? (target.op === "create" ? target.id : "");
  const home = base?.home ?? (target.op === "create" ? target.home : "");
  if (!isChannelId(id) || !isChannelId(home))
    throw new Error("A task needs a valid id and home channel.");
  const event = await writer.sign(
    {
      kind: ARTIFACT_KIND,
      created_at: Math.floor(Date.now() / 1000),
      content: taskContent(checked, base?.preserved.content),
      tags: [
        ["ar", "1"],
        ["d", id],
        ["h", home],
        ["type", TASK_TYPE],
        ["op", target.op],
        ...(base ? [["prev", base.revision]] : []),
        ...(target.via ? [["via", target.via]] : []),
        ...taskTags(checked, base).map((tag) => [...tag]),
      ],
    },
    signal,
  );
  let delivery: Delivery;
  try {
    delivery = await deliver(writer, event, signal);
  } catch (error) {
    if (writer.isNotSent?.(error))
      throw new Error("The task wasn’t sent. Check your connection and retry.");
    throw error;
  }
  if (delivery.status === "accepted") {
    const task = taskOf(event);
    if (!task) throw new Error("Couldn’t read the saved task.");
    return { status: "saved", task };
  }
  if (
    (delivery.status === "refused" && delivery.refusal === "conflict") ||
    delivery.status === "uncertain"
  ) {
    const current = await readTask(reader, id, signal).catch(() => undefined);
    if (current?.revision === event.id)
      return { status: "saved", task: current };
    if (delivery.status === "refused" && current)
      return { status: "conflict", current };
    if (delivery.status === "refused")
      throw new Error(
        "Someone else changed or removed this task. Nothing was saved.",
      );
  }
  if (delivery.status === "refused" && delivery.refusal === "permission")
    throw new Error("You can read this task but can’t edit it here.");
  if (delivery.status === "refused" && delivery.refusal === "too-large")
    throw new Error(
      "This task is too large to save. Link a follow-up instead.",
    );
  if (delivery.status === "uncertain")
    throw new Error(
      `The save outcome is unclear. Read task ${id} before trying again.`,
    );
  throw new Error("Couldn’t save the task. Try again.");
}

function taskOfEntry(entry: ArtifactEntry) {
  const { record } = entry;
  if (
    record.availability.state !== "available" ||
    record.type !== TASK_TYPE ||
    !record.current?.event
  )
    return undefined;
  return taskOf(record.current.event);
}

/** One lexical newest-first order key; id is the page cursor's tie-breaker. */
const orderOf = (entry: ArtifactEntry) => {
  const at = entry.record.current?.event?.created_at ?? 0;
  return `${(9_999_999_999 - Math.max(0, Math.min(at, 9_999_999_999)))
    .toString()
    .padStart(10, "0")}:${entry.record.id}`;
};

export const taskCollection: ArtifactCollectionDefinition = {
  name: "tasks-v2",
  type: TASK_TYPE,
  version: TASK_CONTENT_VERSION,
  project(entry) {
    const event = entry.record.current?.event;
    const state = event?.tags.find(([name]) => name === "state")?.[1];
    return [
      { index: "all", value: "", order: orderOf(entry) },
      ...(state
        ? [{ index: "state", value: state, order: orderOf(entry) }]
        : []),
    ];
  },
};

export type TasksState = Readonly<{
  status: "loading" | "ready";
  tasks: readonly Task[];
  /** A sync failure never discards already confirmed rows. */
  error?: string | undefined;
}>;

export type TasksTable = Readonly<{
  snapshot(): TasksState;
  subscribe(listener: () => void): () => void;
  refresh(): void;
  close(): void;
}>;

/**
 * Subscribe before paging, and discard any page that finishes after a newer
 * notification. This is the documented fallback for hosts without per-id
 * change hints; a notification restarts the whole bounded-page scan.
 */
export function openTasksTable(storage: ArtifactStorage): TasksTable {
  let collection = storage.open(taskCollection);
  const listeners = new Set<() => void>();
  let state: TasksState = { status: "loading", tasks: [] };
  let generation = 0;
  let closed = false;
  const publish = (next: TasksState) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const scan = async () => {
    const own = ++generation;
    const held = collection;
    try {
      const tasks = new Map<string, Task>();
      let after: ArtifactPageQuery["after"];
      do {
        const page = await held.page({
          index: "all",
          value: "",
          limit: PAGE_LIMIT,
          ...(after ? { after } : {}),
        });
        for (const entry of page.entries) {
          const task = taskOfEntry(entry);
          if (task) tasks.set(task.id, task);
        }
        after = page.next;
      } while (after && own === generation && !closed);
      const error = await held.refreshError();
      if (own !== generation || closed) return;
      publish({
        status: "ready",
        tasks: [...tasks.values()].sort(byRecent),
        ...(error ? { error } : {}),
      });
    } catch (error) {
      if (own !== generation || closed) return;
      publish({
        status: state.status,
        tasks: state.tasks,
        error: error instanceof Error ? error.message : "Couldn’t load tasks.",
      });
    }
  };
  // Required before the first read: arrivals during paging invalidate it.
  let stop = collection.subscribe(() => void scan());
  void scan();
  return {
    snapshot: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    refresh() {
      if (closed) return;
      stop();
      collection.close();
      collection = storage.open(taskCollection);
      stop = collection.subscribe(() => void scan());
      void scan();
    },
    close() {
      if (closed) return;
      closed = true;
      generation++;
      stop();
      collection.close();
      listeners.clear();
    },
  };
}
