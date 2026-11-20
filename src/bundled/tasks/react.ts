import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
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

/** The local table follows both session and identity/community replacement. */
export function useTasks(
  storage: ArtifactStorage,
  session: RelaySession | undefined,
) {
  const [table, setTable] = useState<TasksTable>(loading);
  const [saved, setSavedMap] = useState<ReadonlyMap<string, Task>>(new Map());
  useEffect(() => {
    setSavedMap(new Map());
    if (!session) {
      setTable(loading);
      return;
    }
    const next = openTasksTable(storage);
    setTable(next);
    return next.close;
  }, [storage, session]);
  const state = useSyncExternalStore(
    table.subscribe,
    table.snapshot,
    table.snapshot,
  );
  const setSaved = (task: Task) =>
    setSavedMap((current) => new Map(current).set(task.id, task));
  // A local save is pending until authoritative sync returns that revision or
  // demonstrably newer activity. Equal timestamps keep the local revision.
  const tasks = useMemo(() => {
    if (!saved.size) return state.tasks;
    const current = new Map(state.tasks.map((task) => [task.id, task]));
    for (const task of saved.values()) {
      const confirmed = current.get(task.id);
      if (
        !confirmed ||
        (confirmed.revision !== task.revision &&
          confirmed.updatedAt <= task.updatedAt)
      )
        current.set(task.id, task);
    }
    return [...current.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }, [state.tasks, saved]);
  return { ...state, tasks, setSaved, refresh: table.refresh };
}
