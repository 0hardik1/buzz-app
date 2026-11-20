import { useRef, useState } from "react";
import type { ChannelSummary } from "../../features/relay/contracts";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Field } from "../../shared/design-system/ui/Field";
import { Input } from "../../shared/design-system/ui/Input";
import { Select } from "../../shared/design-system/ui/Select";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import {
  createTaskFields,
  inferLinkKind,
  linkKinds,
  reviseTask,
  stateLabels,
  taskStates,
  taskLink,
  type Task,
  type TaskFields,
  type TaskLink,
} from "./model";
import styles from "./Tasks.module.css";

export type TaskSave = Readonly<{
  fields: TaskFields;
  home: string;
}>;

function encodeLinks(links: readonly TaskLink[]) {
  return links
    .map(
      (link) =>
        `${link.kind} | ${link.url}${link.label ? ` | ${link.label}` : ""}`,
    )
    .join("\n");
}

/** URL per line, optionally `kind | URL | label`. */
export function parseLinks(text: string) {
  const links: TaskLink[] = [];
  for (const [index, line] of text.split("\n").entries()) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const parts = trimmed.split("|").map((part) => part.trim());
    const candidate =
      parts.length === 1
        ? { kind: inferLinkKind(parts[0] ?? ""), url: parts[0] }
        : {
            kind: parts[0],
            url: parts[1],
            ...(parts.slice(2).join(" | ").trim()
              ? { label: parts.slice(2).join(" | ").trim() }
              : {}),
          };
    const link = taskLink(candidate);
    if (!link)
      throw new Error(
        `Link ${index + 1} needs an https or buzz URL and one of: ${linkKinds.join(", ")}.`,
      );
    links.push(link);
  }
  return links;
}

const stateOptions = [
  {
    label: "",
    options: taskStates.map((state) => ({
      value: state,
      label: stateLabels[state],
    })),
  },
];

export function TaskEditor({
  task,
  homes,
  initialHome,
  readOnly = false,
  close,
  save,
}: {
  task?: Task | undefined;
  homes: readonly ChannelSummary[];
  initialHome: string;
  readOnly?: boolean;
  close(): void;
  save(value: TaskSave): Promise<void>;
}) {
  const titleInput = useRef<HTMLInputElement>(null);
  const [title, setTitle] = useState(task?.title ?? "");
  const [why, setWhy] = useState(task?.why ?? "");
  const [doneWhen, setDoneWhen] = useState(task?.done_when ?? "");
  const [state, setState] = useState(task?.state ?? "open");
  const [home, setHome] = useState(initialHome);
  const [links, setLinks] = useState(encodeLinks(task?.links ?? []));
  const [note, setNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const disabled = pending || readOnly;

  const submit = async () => {
    if (pending || readOnly) return;
    setError(undefined);
    try {
      const parsed = parseLinks(links);
      const fields = task
        ? reviseTask(
            task,
            { title, why, done_when: doneWhen, state, links: parsed },
            note,
          )
        : createTaskFields(
            {
              title,
              why,
              done_when: doneWhen,
              state,
              links: parsed,
            },
            note.trim() || undefined,
          );
      if (!home) throw new Error("Choose where this task lives.");
      setPending(true);
      await save({ fields, home });
      close();
    } catch (reason) {
      setPending(false);
      setError(
        reason instanceof Error ? reason.message : "Couldn’t save the task.",
      );
    }
  };

  return (
    <Dialog
      open
      size="wide"
      visit
      preventClose={pending}
      dismissOnOutsideClick={false}
      onOpenChange={(open) => !open && close()}
      initialFocus={readOnly ? undefined : titleInput}
      title={
        readOnly ? (task?.title ?? "Task") : task ? "Edit task" : "New task"
      }
      description="Keep the reason, completion condition and evidence with the work."
      actions={
        readOnly ? (
          <Button onClick={close}>Close</Button>
        ) : (
          <>
            <Button disabled={pending} onClick={close}>
              Cancel
            </Button>
            <Button
              variant="prominent"
              loading={pending}
              disabled={pending || (!task && !home)}
              onClick={() => void submit()}
            >
              {task ? "Save update" : "Create task"}
            </Button>
          </>
        )
      }
    >
      <div className={styles.form} aria-busy={pending}>
        {!task && (
          <Select
            label="Home"
            description="Access follows this channel or Solo chat."
            variant="field"
            value={home}
            disabled={disabled}
            groups={[
              {
                label: "",
                options: homes.map((channel) => ({
                  value: channel.id,
                  label: channel.name || channel.id,
                })),
              },
            ]}
            onValueChange={setHome}
          />
        )}
        <Field label="Title">
          <Input
            ref={titleInput}
            value={title}
            maxLength={240}
            disabled={disabled}
            onChange={(event) => setTitle(event.target.value)}
          />
        </Field>
        <Field
          label="Why"
          description="The context an agent needs to make judgment calls without asking again."
        >
          <Textarea
            rows={4}
            value={why}
            maxLength={8000}
            disabled={disabled}
            onChange={(event) => setWhy(event.target.value)}
          />
        </Field>
        <Field
          label="Done when"
          description="An observable completion condition."
        >
          <Textarea
            rows={3}
            value={doneWhen}
            maxLength={8000}
            disabled={disabled}
            onChange={(event) => setDoneWhen(event.target.value)}
          />
        </Field>
        <Select
          label="State"
          variant="field"
          value={state}
          disabled={disabled || !task}
          groups={stateOptions}
          onValueChange={(next) => setState(next as Task["state"])}
        />
        <Field
          label="Links"
          optional
          description="One URL per line, or kind | URL | label. Kinds: pr, issue, thread, doc, session, other."
        >
          <Textarea
            rows={3}
            value={links}
            disabled={disabled}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            onChange={(event) => setLinks(event.target.value)}
          />
        </Field>
        {!readOnly && (
          <Field
            label={task ? "Update note" : "First note"}
            optional={!task}
            description={
              task
                ? "Required. Record progress, a decision or evidence; this becomes the summary."
                : "Starts the append-only log."
            }
          >
            <Textarea
              rows={3}
              value={note}
              maxLength={8000}
              disabled={pending}
              onChange={(event) => setNote(event.target.value)}
            />
          </Field>
        )}
        {task && (
          <section className={styles.log} aria-labelledby="task-log-title">
            <h3 id="task-log-title" className="text-label text-primary">
              Log
            </h3>
            <p className="text-body-sm text-subtle">
              Oldest first. The latest note is the summary line.
            </p>
            <ol>
              {task.log.map((entry, index) => (
                // Append position is stable identity: entries are never reordered.
                // biome-ignore lint/suspicious/noArrayIndexKey: append-only log entries have no separate id.
                <li key={`${entry.at}:${index}`}>
                  <time dateTime={new Date(entry.at * 1000).toISOString()}>
                    {new Date(entry.at * 1000).toLocaleString()}
                  </time>
                  {entry.state && (
                    <span className={styles.logState}>
                      {stateLabels[entry.state]}
                    </span>
                  )}
                  <p>{entry.note}</p>
                </li>
              ))}
            </ol>
          </section>
        )}
        {error && (
          <p role="alert" className="text-body text-primary">
            {error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
