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

/** The local table follows both session and identity/community replacement. */
export function useTasks(
  storage: ArtifactStorage,
  session: RelaySession | undefined,
) {
  const [table, setTable] = useState<TasksTable>(loading);
  const [saved, setSavedMap] = useState<ReadonlyMap<string, Task>>(new Map());
  const confirmedIds = useRef(new Set<string>());
  useEffect(() => {
    confirmedIds.current.clear();
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
  // Once any authoritative revision arrives, sync owns the row—even if this
  // device later loses access or the record disappears.
  useEffect(() => {
    setSavedMap((current) => {
      const next = new Map(current);
      for (const task of state.tasks) next.delete(task.id);
      return next.size === current.size ? current : next;
    });
  }, [state.tasks]);
  const tasks = useMemo(() => {
    for (const task of state.tasks) confirmedIds.current.add(task.id);
    if (!saved.size) return state.tasks;
    const current = new Map(state.tasks.map((task) => [task.id, task]));
    for (const task of saved.values()) {
      const confirmed = current.get(task.id);
      // Remember confirmation synchronously as well as pruning above: a fast
      // confirmed → deleted sequence must not briefly restore the local copy.
      if (!confirmed && !confirmedIds.current.has(task.id))
        current.set(task.id, task);
    }
    return [...current.values()].sort(
      (a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id),
    );
  }, [state.tasks, saved]);
  return { ...state, tasks, setSaved, refresh: table.refresh };
}
