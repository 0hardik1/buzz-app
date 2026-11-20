// Task v2 is one NIP-AR artifact (kind 45010) of type `buzz.task`. Its `h`
// is its home channel or chat: the relay inherits read/write access from it.
// Every revision is a complete snapshot; `prev` makes edits compare-and-set.
import { ARTIFACT_KIND } from "../../features/agents/agent-config-artifacts";
import type { EventData } from "../../features/relay/events";

export const TASK_TYPE = "buzz.task";
export const TASK_CONTENT_VERSION = 4;

export const taskStates = ["open", "waiting", "done", "dropped"] as const;
export type TaskState = (typeof taskStates)[number];
export const stateLabels: Readonly<Record<TaskState, string>> = {
  open: "Open",
  waiting: "Waiting",
  done: "Done",
  dropped: "Dropped",
};
export const activeStates: readonly TaskState[] = ["open", "waiting"];

export const linkKinds = [
  "pr",
  "issue",
  "thread",
  "doc",
  "session",
  "other",
] as const;
export type TaskLinkKind = (typeof linkKinds)[number];
export type TaskLink = Readonly<{
  kind: TaskLinkKind;
  url: string;
  label?: string | undefined;
}>;

/** Unknown keys are retained when a known revision is edited. */
export type TaskLogEntry = Readonly<{
  at: number;
  note: string;
  state?: TaskState | undefined;
}>;

export type TaskFields = Readonly<{
  title: string;
  why: string;
  done_when: string;
  state: TaskState;
  links: readonly TaskLink[];
  log: readonly TaskLogEntry[];
}>;

export type Task = TaskFields &
  Readonly<{
    /** Stable NIP-AR `d`, independent of author and home. */
    id: string;
    home: string;
    revision: string;
    editor: string;
    updatedAt: number;
    /** Same-version fields and tags this client does not know yet. */
    preserved: Readonly<{
      content: Readonly<Record<string, unknown>>;
      tags: readonly (readonly string[])[];
    }>;
  }>;

export const MAX_TITLE = 240;
export const MAX_TEXT = 8000;
export const MAX_LINKS = 100;
const CHANNEL =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const encoder = new TextEncoder();

export const isChannelId = (value: unknown): value is string =>
  typeof value === "string" && CHANNEL.test(value);

const tag = (event: EventData, name: string) =>
  event.tags.find((entry) => entry[0] === name)?.[1];

const stateOf = (value: unknown): TaskState | undefined =>
  taskStates.find((state) => state === value);

const kindOf = (value: unknown): TaskLinkKind | undefined =>
  linkKinds.find((kind) => kind === value);

/** Agent sessions, Buzz threads, and ordinary web evidence all have safe URLs. */
export function taskLink(value: unknown): TaskLink | undefined {
  if (typeof value === "string")
    value = { kind: inferLinkKind(value), url: value };
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  const kind = kindOf(input.kind);
  if (!kind || typeof input.url !== "string") return undefined;
  const url = input.url.trim();
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "buzz:")
      return undefined;
  } catch {
    return undefined;
  }
  if (url.length > 4096) return undefined;
  const label = typeof input.label === "string" ? input.label.trim() : "";
  // Return the original shape, including future keys, not just known fields.
  return {
    ...input,
    kind,
    url,
    ...(label ? { label: label.slice(0, MAX_TITLE) } : { label: undefined }),
  } as TaskLink;
}

export function inferLinkKind(url: string): TaskLinkKind {
  if (url.startsWith("buzz:"))
    return /agent|session/i.test(url) ? "session" : "thread";
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "github.com") {
      if (/\/pull\/\d+/.test(parsed.pathname)) return "pr";
      if (/\/issues\/\d+/.test(parsed.pathname)) return "issue";
    }
    return /docs?|notion|readme/i.test(parsed.hostname + parsed.pathname)
      ? "doc"
      : "other";
  } catch {
    return "other";
  }
}

function logEntry(value: unknown): TaskLogEntry | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const input = value as Record<string, unknown>;
  if (
    !Number.isSafeInteger(input.at) ||
    (input.at as number) < 0 ||
    typeof input.note !== "string" ||
    !input.note.trim() ||
    (input.state !== undefined && !stateOf(input.state))
  )
    return undefined;
  return { ...input, note: input.note.trim() } as TaskLogEntry;
}

/** Parses only the schema this client can edit without discarding its meaning. */
export function taskOf(event: EventData & { id: string }): Task | undefined {
  if (event.kind !== ARTIFACT_KIND || tag(event, "type") !== TASK_TYPE)
    return undefined;
  const id = tag(event, "d");
  const home = tag(event, "h");
  if (!isChannelId(id) || !isChannelId(home)) return undefined;
  let content: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(event.content);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      return undefined;
    content = parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
  if (content.version !== TASK_CONTENT_VERSION) return undefined;
  const state = stateOf(content.state);
  if (
    !state ||
    state !== tag(event, "state") ||
    typeof content.title !== "string" ||
    content.title !== tag(event, "title") ||
    typeof content.why !== "string" ||
    typeof content.done_when !== "string" ||
    !Array.isArray(content.links) ||
    !Array.isArray(content.log)
  )
    return undefined;
  const links = content.links.map(taskLink);
  const log = content.log.map(logEntry);
  if (links.some((link) => !link) || log.some((entry) => !entry))
    return undefined;
  return {
    id,
    home,
    title: content.title,
    why: content.why,
    done_when: content.done_when,
    state,
    links: links as TaskLink[],
    log: log as TaskLogEntry[],
    revision: event.id,
    editor: event.pubkey,
    updatedAt: event.created_at,
    preserved: { content, tags: event.tags },
  };
}

const checkedText = (value: string, name: string, required: boolean) => {
  const text = required ? value.trim() : value;
  if (required && !text) throw new Error(`Give the task ${name}.`);
  if (text.length > MAX_TEXT)
    throw new Error(`Keep ${name} under ${MAX_TEXT} characters.`);
  return text;
};

/** Checks user- or tool-supplied fields without inventing missing context. */
export function checkedFields(fields: TaskFields): TaskFields {
  const title = fields.title.trim().replace(/\s+/g, " ");
  if (!title) throw new Error("Give the task a title.");
  if (title.length > MAX_TITLE)
    throw new Error(`Keep the title under ${MAX_TITLE} characters.`);
  const state = stateOf(fields.state);
  if (!state) throw new Error("Choose a valid task state.");
  if (fields.links.length > MAX_LINKS)
    throw new Error(`A task holds up to ${MAX_LINKS} links.`);
  const links = fields.links.map(taskLink);
  if (links.some((link) => !link))
    throw new Error("Each link needs a kind and an https or buzz URL.");
  const log = fields.log.map(logEntry);
  if (log.some((entry) => !entry))
    throw new Error("Each log entry needs a date and a nonempty note.");
  const checked = {
    title,
    why: checkedText(fields.why, "why this matters", true),
    done_when: checkedText(fields.done_when, "a done condition", true),
    state,
    links: [
      ...new Map(links.map((link) => [link?.url, link])).values(),
    ] as TaskLink[],
    log: log as TaskLogEntry[],
  };
  if (encoder.encode(taskContent(checked)).length > 120_000)
    throw new Error(
      "This task is too large to save. Start a follow-up task and link it; the log stays append-only.",
    );
  return checked;
}

export function taskContent(
  fields: TaskFields,
  preserved?: Readonly<Record<string, unknown>>,
) {
  return JSON.stringify({
    ...preserved,
    version: TASK_CONTENT_VERSION,
    title: fields.title,
    why: fields.why,
    done_when: fields.done_when,
    state: fields.state,
    links: fields.links,
    log: fields.log,
  });
}

const OWNED_TAGS = new Set([
  "ar",
  "d",
  "h",
  "type",
  "title",
  "op",
  "prev",
  "state",
  "via",
]);

export function taskTags(fields: TaskFields, base?: Task) {
  return [
    ...(base?.preserved.tags
      .filter(([name]) => !OWNED_TAGS.has(name ?? ""))
      .map((tag) => [...tag]) ?? []),
    ["title", fields.title],
    ["state", fields.state],
  ];
}

/** Every edit adds evidence/context. The latest note is the table's summary. */
export function reviseTask(
  base: TaskFields,
  change: Partial<
    Pick<TaskFields, "title" | "why" | "done_when" | "state" | "links">
  >,
  note: string,
  at = Math.floor(Date.now() / 1000),
): TaskFields {
  const text = note.trim();
  if (!text) throw new Error("Add a note describing this update.");
  const state = change.state ?? base.state;
  return checkedFields({
    ...base,
    ...change,
    state,
    log: [
      ...base.log,
      { at, note: text, ...(state !== base.state ? { state } : {}) },
    ],
  });
}

export function createTaskFields(
  input: Pick<TaskFields, "title" | "why" | "done_when"> &
    Partial<Pick<TaskFields, "state" | "links">>,
  note = "Created task.",
  at = Math.floor(Date.now() / 1000),
): TaskFields {
  const state = input.state ?? "open";
  return checkedFields({
    ...input,
    state,
    links: input.links ?? [],
    log: [{ at, note: note.trim() || "Created task.", state }],
  });
}

export const latestNote = (task: Pick<TaskFields, "log">) =>
  task.log.at(-1)?.note ?? "No updates yet.";

export const byRecent = (a: Task, b: Task) =>
  b.updatedAt - a.updatedAt || a.id.localeCompare(b.id);

export function matchesWords(task: Task, words: string) {
  const needles = words.toLocaleLowerCase().split(/\s+/).filter(Boolean);
  const haystack =
    `${task.title} ${task.why} ${task.done_when} ${latestNote(task)}`.toLocaleLowerCase();
  return needles.every((word) => haystack.includes(word));
}
