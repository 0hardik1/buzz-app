import { useMemo, useState, useSyncExternalStore } from "react";
import type { ArtifactStorage } from "../../features/artifact-storage/service";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import {
  CheckIcon,
  ListChecksIcon,
  PlusIcon,
} from "../../shared/design-system/icons/index";
import { Badge } from "../../shared/design-system/ui/Badge";
import { Button } from "../../shared/design-system/ui/Button";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { FullPageSurface } from "../../shared/design-system/ui/FullPageSurface";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { SearchField } from "../../shared/design-system/ui/SearchField";
import { Select } from "../../shared/design-system/ui/Select";
import { useChannelRoster } from "../../features/relay/react";
import {
  activeStates,
  latestNote,
  matchesWords,
  stateLabels,
  taskStates,
  type Task,
} from "./model";
import { useTasks } from "./react";
import { saveTask } from "./store";
import { TaskEditor, type TaskSave } from "./TaskEditor";
import styles from "./Tasks.module.css";

export function TasksPage({
  relay,
  storage,
}: {
  relay: RelayData;
  storage: ArtifactStorage;
}) {
  const connection = useSyncExternalStore(relay.subscribe, relay.snapshot);
  return (
    <div className="h-full min-h-0">
      <FullPageSurface aria-label="Tasks">
        {connection.status === "ready" ? (
          <ConnectedTasks
            key={`${connection.scope}:${connection.generation}`}
            session={connection.session}
            storage={storage}
          />
        ) : (
          <div data-buzz-ui="" className={styles.page}>
            <TasksHeader />
            <p role="status" className={styles.notice}>
              {connection.status === "error"
                ? (connection.error ?? "Couldn’t connect to this community.")
                : "Connect to a community to see its tasks."}
            </p>
          </div>
        )}
      </FullPageSurface>
    </div>
  );
}

function TasksHeader({ onNew }: { onNew?: (() => void) | undefined }) {
  return (
    <PanelHeader
      title={
        <PanelHeaderLabel
          title="Tasks"
          icon={<ListChecksIcon size="1rem" aria-hidden="true" />}
        />
      }
      actions={
        onNew && (
          <IconButton
            size="sm"
            variant="ghost"
            icon={<PlusIcon size={16} aria-hidden="true" />}
            aria-label="New task"
            title="New task"
            onClick={onNew}
          />
        )
      }
    />
  );
}

type Editor =
  | Readonly<{ kind: "create"; id: string }>
  | Readonly<{ kind: "edit"; task: Task }>;

function ConnectedTasks({
  session,
  storage,
}: {
  session: RelaySession;
  storage: ArtifactStorage;
}) {
  const table = useTasks(storage, session);
  const { channels } = useChannelRoster(session.channels);
  const homes = useMemo(
    () =>
      channels.filter(
        (channel) =>
          !channel.pending &&
          !channel.archived &&
          !channel.huddle &&
          !channel.readOnly &&
          !!channel.channelType &&
          ["stream", "forum", "solo"].includes(channel.channelType),
      ),
    [channels],
  );
  const homeNames = useMemo(
    () =>
      new Map(
        channels.map((channel) => [channel.id, channel.name || channel.id]),
      ),
    [channels],
  );
  const [editor, setEditor] = useState<Editor>();
  const [words, setWords] = useState("");
  const [filter, setFilter] = useState("active");
  const canWrite = !!session.configArtifactWriter && !!session.snapshotRead;
  const tasks = table.tasks.filter((task) => {
    const inState =
      filter === "all" ||
      (filter === "active"
        ? activeStates.includes(task.state)
        : task.state === filter);
    return inState && matchesWords(task, words);
  });
  const newTask = () => {
    if (canWrite && homes.length)
      setEditor({ kind: "create", id: crypto.randomUUID() });
  };
  const save = async (value: TaskSave) => {
    if (!editor || !canWrite)
      throw new Error("This connection can’t save tasks.");
    const result =
      editor.kind === "create"
        ? await saveTask(session, session, value.fields, {
            op: "create",
            home: value.home,
            id: editor.id,
          })
        : await saveTask(session, session, value.fields, {
            op: "update",
            base: editor.task,
          });
    if (result.status === "conflict")
      throw new Error(
        "Someone else updated this task. Your draft is still here; close and reopen it to apply the note to their latest log.",
      );
    table.setSaved(result.task);
  };
  const editing = editor?.kind === "edit" ? editor.task : undefined;
  return (
    <div data-buzz-ui="" className={styles.page}>
      <TasksHeader onNew={canWrite && homes.length ? newTask : undefined} />
      <div className={styles.filters}>
        <SearchField
          label="Search tasks"
          placeholder="Search tasks"
          value={words}
          onValueChange={setWords}
        />
        <Select
          label="Task state"
          variant="compact"
          value={filter}
          groups={[
            {
              label: "",
              options: [
                { value: "active", label: "Active" },
                { value: "all", label: "All states" },
                ...taskStates.map((state) => ({
                  value: state,
                  label: stateLabels[state],
                })),
              ],
            },
          ]}
          onValueChange={setFilter}
        />
      </div>
      {table.error && (
        <div role="alert" className={styles.notice}>
          <p>
            {table.error} Showing the confirmed tasks already on this device.
          </p>
          <Button onClick={table.refresh}>Retry tasks</Button>
        </div>
      )}
      <LoadingRegion
        pending={table.status === "loading"}
        label="Loading tasks…"
      >
        {!table.tasks.length && table.status === "ready" ? (
          <EmptyState
            icon={<ListChecksIcon size={24} />}
            title="No tasks yet"
            description="Track why the work matters, when it’s done, and the evidence along the way."
            action={
              canWrite && homes.length ? (
                <Button variant="prominent" onClick={newTask}>
                  <PlusIcon size={16} aria-hidden="true" />
                  New task
                </Button>
              ) : undefined
            }
          />
        ) : !tasks.length && table.status === "ready" ? (
          <EmptyState
            icon={<ListChecksIcon size={24} />}
            title="No matching tasks"
            description="Try different words or include another state."
            action={
              <Button
                onClick={() => {
                  setWords("");
                  setFilter("active");
                }}
              >
                Clear filters
              </Button>
            }
          />
        ) : (
          <div className={styles.tableScroll}>
            <table className={styles.table}>
              <caption className="sr-only">
                Tasks, newest activity first
              </caption>
              <thead>
                <tr>
                  <th scope="col">State</th>
                  <th scope="col">Task</th>
                  <th scope="col">Why</th>
                  <th scope="col">Done when</th>
                  <th scope="col">Latest note</th>
                  <th scope="col">Links</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {tasks.map((task) => (
                  <tr key={task.id}>
                    <td>
                      <Badge
                        tone={task.state === "done" ? "success" : "neutral"}
                      >
                        {task.state === "done" && (
                          <CheckIcon size={12} aria-hidden="true" />
                        )}
                        {stateLabels[task.state]}
                      </Badge>
                    </td>
                    <th scope="row">
                      <Button
                        variant="plain"
                        size="text"
                        onClick={() => setEditor({ kind: "edit", task })}
                      >
                        {task.title}
                      </Button>
                      <span className={styles.home}>
                        {homeNames.get(task.home) ??
                          `Home ${task.home.slice(0, 8)}`}
                      </span>
                    </th>
                    <td>
                      <span className={styles.context}>{task.why}</span>
                    </td>
                    <td>
                      <span className={styles.context}>{task.done_when}</span>
                    </td>
                    <td>
                      <span className={styles.summary}>{latestNote(task)}</span>
                    </td>
                    <td>{task.links.length || "—"}</td>
                    <td>
                      <time
                        dateTime={new Date(task.updatedAt * 1000).toISOString()}
                      >
                        {new Date(task.updatedAt * 1000).toLocaleDateString()}
                      </time>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </LoadingRegion>
      {editor && (
        <TaskEditor
          key={editor.kind === "edit" ? editor.task.revision : editor.id}
          task={editing}
          homes={homes}
          initialHome={editing?.home ?? homes[0]?.id ?? ""}
          readOnly={editor.kind === "edit" && !canWrite}
          close={() => setEditor(undefined)}
          save={save}
        />
      )}
    </div>
  );
}
