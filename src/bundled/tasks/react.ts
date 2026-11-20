import {
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ArtifactStorage } from "../../features/artifact-storage/service";
import type { RelaySession } from "../../features/relay/session";
import type { Task } from "./model";
import { openTasksTable, type TasksTable } from "./store";

const idleState = { status: "loading", tasks: [] } as const;
const loading: TasksTable = {
  snapshot: () => idleState,
  subscribe: () => () => {},
  refresh: () => {},
  close: () => {},
};

type PendingSave = Readonly<{ task: Task; baseRevision?: string | undefined }>;
const confirmed = (pending: PendingSave, task: Task) =>
  task.revision === pending.task.revision ||
  task.revision !== pending.baseRevision;

/** The local table follows both session and identity/community replacement. */
export function useTasks(
  storage: ArtifactStorage,
  session: RelaySession | undefined,
) {
  const [table, setTable] = useState<TasksTable>(loading);
  const [saved, setSavedMap] = useState<ReadonlyMap<string, PendingSave>>(
    new Map(),
  );
  const retiredIds = useRef(new Set<string>());
  useEffect(() => {
    retiredIds.current.clear();
    setSavedMap(new Map());
    if (!session) {
      setTable(loading);
      return;
    }
    const next = openTasksTable(storage, session);
    setTable(next);
    return next.close;
  }, [storage, session]);
  const state = useSyncExternalStore(
    table.subscribe,
    table.snapshot,
    table.snapshot,
  );
  const setSaved = (task: Task, baseRevision?: string) =>
    setSavedMap((current) =>
      new Map(current).set(task.id, { task, baseRevision }),
    );
  // The editor's old base does not confirm its newer save. That exact revision,
  // or any other writer's newer revision, retires the overlay permanently.
  useEffect(() => {
    setSavedMap((current) => {
      const next = new Map(current);
      for (const task of state.tasks) {
        const pending = next.get(task.id);
        if (pending && confirmed(pending, task)) next.delete(task.id);
      }
      return next.size === current.size ? current : next;
    });
  }, [state.tasks]);
  const tasks = useMemo(() => {
    for (const task of state.tasks) {
      const pending = saved.get(task.id);
      if (pending && confirmed(pending, task)) retiredIds.current.add(task.id);
    }
    if (!saved.size) return state.tasks;
    const current = new Map(state.tasks.map((task) => [task.id, task]));
    for (const pending of saved.values()) {
      // Remember confirmation synchronously as well as pruning above: a fast
      // confirmed → deleted sequence must not briefly restore the local copy.
      if (!retiredIds.current.has(pending.task.id))
        current.set(pending.task.id, pending.task);
    }
    return [...current.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }, [state.tasks, saved]);
  return { ...state, tasks, setSaved, refresh: table.refresh };
}
