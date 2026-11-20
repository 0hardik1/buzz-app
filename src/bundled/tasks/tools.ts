// Agents read through their own relay connection. Saves are signed by the
// owner only when its current roster entry is writable and the agent is a
// signed member of the same home. NIP-AR also rejects stale revisions.
import type { Agents as AgentsService } from "../../features/agents/service";
import type { BuzzClient } from "../../buzz-mcp/client";
import { channelIdentity } from "../../features/relay/channel-labels";
import { isHuddleRoom } from "../../features/huddle/lifecycle";
import { tag } from "../../features/relay/events";
import type { RelaySession } from "../../features/relay/session";
import {
  activeStates,
  checkedFields,
  createTaskFields,
  isChannelId,
  latestNote,
  matchesWords,
  reviseTask,
  taskLink,
  taskStates,
  type Task,
  type TaskFields,
  type TaskLink,
  type TaskState,
} from "./model";
import {
  readTask,
  readTasks,
  saveTask,
  type SaveResult,
  type TaskSource,
} from "./store";

type Agents = Pick<AgentsService, "addTool" | "relay">;
type Client = Pick<BuzzClient, "key" | "pubkey" | "query" | "publish"> & {
  signal?: AbortSignal | undefined;
  relayAuthor?: string | undefined;
};
type Args = Record<string, unknown>;

const ATTEMPTS = 3;
const LIST_LIMIT = 50;
const STEP_TIMEOUT = 60_000;
const INCOMPLETE =
  "\n(This read reached its relay limit; narrow the search for a complete answer.)";

const deadline = (client: Client) =>
  client.signal
    ? AbortSignal.any([client.signal, AbortSignal.timeout(STEP_TIMEOUT)])
    : AbortSignal.timeout(STEP_TIMEOUT);

function agentReads(client: Client, session: RelaySession): TaskSource {
  return {
    relayAuthor: client.relayAuthor ?? session.relayAuthor,
    snapshotRead: (filters, { signal }) => {
      signal?.throwIfAborted();
      return client.query(filters as never) as never;
    },
  };
}

const textArg = (args: Args, name: string) => {
  const value = args[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`${name} must be text`);
  return value;
};

const stateArg = (args: Args, name = "state") => {
  const value = textArg(args, name);
  if (value === undefined) return undefined;
  return taskStates.find((state) => state === value);
};

function linksArg(args: Args) {
  if (args.links === undefined) return undefined;
  if (!Array.isArray(args.links)) throw new Error("links must be a list");
  const links = args.links.map(taskLink);
  if (links.some((link) => !link))
    throw new Error(
      "Each link needs kind (pr, issue, thread, doc, session or other) and an https or buzz URL",
    );
  return links as TaskLink[];
}

function describe(task: Task) {
  return [
    `# ${task.title}`,
    `id: ${task.id}`,
    `state: ${task.state}`,
    `home: ${task.home}`,
    `revision: ${task.revision}`,
    `updated: ${new Date(task.updatedAt * 1000).toISOString()}`,
    "",
    `Why: ${task.why}`,
    `Done when: ${task.done_when}`,
    "",
    "Links:",
    ...(task.links.length
      ? task.links.map(
          (link) =>
            `- ${link.kind}: ${link.url}${link.label ? ` — ${link.label}` : ""}`,
        )
      : ["- none"]),
    "",
    "Log (oldest first; latest is the summary):",
    ...task.log.map(
      (entry) =>
        `- ${new Date(entry.at * 1000).toISOString()}${entry.state ? ` [${entry.state}]` : ""}: ${entry.note}`,
    ),
  ].join("\n");
}

const summary = (task: Task) =>
  `- ${task.id}: ${task.title} [${task.state}] — ${latestNote(task)} (home ${task.home}, revision ${task.revision})`;

async function readableHome(
  reads: TaskSource,
  home: string,
  signal: AbortSignal,
) {
  if (!reads.snapshotRead || !reads.relayAuthor)
    throw new Error("This community can’t verify the task’s home.");
  const [place] = await reads.snapshotRead(
    [
      {
        kinds: [39000],
        authors: [reads.relayAuthor],
        "#d": [home],
        limit: 1,
      },
    ],
    { signal },
  );
  if (!place || place.pubkey !== reads.relayAuthor)
    throw new Error(
      "You can’t read that home. Ask where the task belongs; nothing was created.",
    );
  const { type } = channelIdentity(place);
  if (
    !type ||
    isHuddleRoom(tag(place, "about")) ||
    !["stream", "forum", "solo"].includes(type) ||
    place.tags.some(([name, value]) => name === "archived" && value === "true")
  )
    throw new Error(
      "Tasks live in an unarchived channel or Solo chat, not a DM or huddle.",
    );
}

async function writableHome(
  session: RelaySession,
  reads: TaskSource,
  home: string,
  agent: string,
  signal: AbortSignal,
) {
  await readableHome(reads, home, signal);
  const place = session.channels.get?.(home);
  if (
    !place ||
    place.pending ||
    place.archived ||
    place.huddle ||
    place.readOnly ||
    !place.channelType ||
    !["stream", "forum", "solo"].includes(place.channelType) ||
    !place.members?.includes(agent)
  )
    throw new Error(
      "Tasks need a home where the owner can write and this agent is a member.",
    );
}

export function addTaskTools(agents: Agents) {
  function sessionOf(client: Client) {
    const relay = agents.relay(client.key)?.snapshot();
    if (relay?.status !== "ready")
      throw new Error("Tasks need this conversation’s community");
    return relay.session;
  }

  async function current(reads: TaskSource, id: string, signal: AbortSignal) {
    const task = await readTask(reads, id, signal);
    if (!task) throw new Error(`No task ${id} that you can read`);
    return task;
  }

  /** Reapply intent over a newer head, never overwrite its newer log entries. */
  async function change(
    session: RelaySession,
    reads: TaskSource,
    id: string,
    edit: (task: Task) => TaskFields,
    agent: string,
    signal: AbortSignal,
  ) {
    let task = await current(reads, id, signal);
    for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
      signal.throwIfAborted();
      await writableHome(session, reads, task.home, agent, signal);
      const result: SaveResult = await saveTask(
        session,
        reads,
        edit(task),
        { op: "update", base: task, via: agent },
        signal,
      );
      if (result.status === "saved") return result.task;
      task = result.current;
    }
    throw new Error("Others keep changing this task. Read it and try again.");
  }

  agents.addTool({
    name: "tasks_find",
    description:
      "Finds Task v2 records you can read, newest first. Default: active (open, waiting). With id, returns the complete why, done condition, links and append-only log. The latest log note is the current summary.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string", description: "Read this one task in full" },
        words: {
          type: "string",
          description: "Words in title, why, done condition or latest note",
        },
        home: {
          type: "string",
          description: "Only tasks in this channel or chat id",
        },
        state: {
          type: "string",
          enum: ["active", "all", ...taskStates],
          description: "active by default; all includes done and dropped",
        },
      },
      additionalProperties: false,
    },
    async call(client, _context, args: Args) {
      const session = sessionOf(client);
      const reads = agentReads(client, session);
      const signal = deadline(client);
      const id = textArg(args, "id");
      if (id) return describe(await current(reads, id, signal));
      const selected = textArg(args, "state") ?? "active";
      const states: readonly TaskState[] | undefined =
        selected === "all"
          ? undefined
          : selected === "active"
            ? activeStates
            : taskStates.filter((state) => state === selected);
      if (!states?.length && selected !== "all")
        throw new Error("state must be active, all, or a Task v2 state");
      const home = textArg(args, "home");
      if (home !== undefined && !isChannelId(home))
        throw new Error("home must be a channel or chat id");
      const { tasks: found, complete } = await readTasks(reads, signal, {
        states,
        ...(home ? { home } : {}),
      });
      const words = (textArg(args, "words") ?? "").trim();
      const tasks = found.filter((task) => matchesWords(task, words));
      if (!tasks.length) return `No tasks match.${complete ? "" : INCOMPLETE}`;
      return (
        tasks
          .slice(0, LIST_LIMIT)
          .map(summary)
          .concat(
            tasks.length > LIST_LIMIT
              ? [`…and ${tasks.length - LIST_LIMIT} more`]
              : [],
          )
          .join("\n") + (complete ? "" : INCOMPLETE)
      );
    },
  });

  agents.addTool({
    name: "tasks_create",
    description:
      "Creates an open Task v2 in this conversation or the named home without an approval step. why must give enough context for judgment calls; done_when must be observable. Set waiting when it already needs input. An exact-title active duplicate in that home is returned instead of creating another; after the person confirms a separate task, set new_anyway.",
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short title" },
        why: {
          type: "string",
          description: "Why this matters and the context for judgment calls",
        },
        done_when: {
          type: "string",
          description: "Observable completion condition",
        },
        state: { type: "string", enum: ["open", "waiting"] },
        home: {
          type: "string",
          description: "Channel or Solo chat id (default: this conversation)",
        },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["pr", "issue", "thread", "doc", "session", "other"],
              },
              url: { type: "string" },
              label: { type: "string" },
            },
            required: ["kind", "url"],
            additionalProperties: true,
          },
        },
        note: { type: "string", description: "First dated log note" },
        new_anyway: {
          type: "boolean",
          description:
            "After the person confirmed an exact-title duplicate is separate",
        },
      },
      required: ["title", "why", "done_when"],
      additionalProperties: false,
    },
    async call(client, context, args: Args) {
      const session = sessionOf(client);
      const reads = agentReads(client, session);
      const signal = deadline(client);
      const home = textArg(args, "home") ?? context.channel;
      if (!isChannelId(home))
        throw new Error("Say which channel or Solo chat the task belongs in");
      await writableHome(session, reads, home, client.pubkey, signal);
      const title = textArg(args, "title") ?? "";
      const requestedState = stateArg(args);
      if (args.state !== undefined && !requestedState)
        throw new Error("state must be open or waiting");
      const { tasks: open } = await readTasks(reads, signal, {
        states: activeStates,
        home,
      });
      const duplicate = open.find(
        (task) =>
          task.title.trim().toLocaleLowerCase() ===
          title.trim().replace(/\s+/g, " ").toLocaleLowerCase(),
      );
      if (duplicate && args.new_anyway !== true)
        return `Not created: active task ${duplicate.id} has the same title in this home. Add a note to it instead, or ask the person before using new_anyway.\n\n${describe(duplicate)}`;
      const id = crypto.randomUUID();
      const fields = createTaskFields(
        {
          title,
          why: textArg(args, "why") ?? "",
          done_when: textArg(args, "done_when") ?? "",
          state: requestedState ?? "open",
          links: linksArg(args) ?? [],
        },
        textArg(args, "note"),
      );
      const result = await saveTask(
        session,
        reads,
        fields,
        { op: "create", home, id, via: client.pubkey },
        signal,
      ).catch((reason: unknown) => {
        throw new Error(
          `${reason instanceof Error ? reason.message : "Couldn’t create the task."} The chosen id is ${id}; read it before creating another.`,
        );
      });
      if (result.status !== "saved")
        throw new Error(`A task with id ${id} already exists.`);
      return `Created task ${id}.\n\n${describe(result.task)}`;
    },
  });

  agents.addTool({
    name: "tasks_update",
    description:
      "Updates title, why, done_when, state or links (the supplied links replace the list), and appends the required note. Omitted fields and earlier log entries stay unchanged. Set open when work starts, waiting when blocked on something named in the note. Set done or dropped only when the note states the evidence. Retries safely over a concurrent revision.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        title: { type: "string" },
        why: { type: "string" },
        done_when: { type: "string" },
        state: { type: "string", enum: [...taskStates] },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["pr", "issue", "thread", "doc", "session", "other"],
              },
              url: { type: "string" },
              label: { type: "string" },
            },
            required: ["kind", "url"],
            additionalProperties: true,
          },
          description:
            "Replace the complete links list; use tasks_note to append links",
        },
        note: {
          type: "string",
          description:
            "Required dated update/evidence note; becomes the summary",
        },
      },
      required: ["id", "note"],
      additionalProperties: false,
    },
    async call(client, _context, args: Args) {
      const session = sessionOf(client);
      const reads = agentReads(client, session);
      const signal = deadline(client);
      const id = textArg(args, "id") ?? "";
      const note = textArg(args, "note") ?? "";
      const changeInput = {
        title: textArg(args, "title"),
        why: textArg(args, "why"),
        done_when: textArg(args, "done_when"),
        state: stateArg(args),
        links: linksArg(args),
      };
      if (args.state !== undefined && !changeInput.state)
        throw new Error(`state must be one of ${taskStates.join(", ")}`);
      if (
        changeInput.title === undefined &&
        changeInput.why === undefined &&
        changeInput.done_when === undefined &&
        changeInput.state === undefined &&
        changeInput.links === undefined
      )
        throw new Error(
          "Give at least one field to update, or use tasks_note.",
        );
      const saved = await change(
        session,
        reads,
        id,
        (base) => {
          const next = reviseTask(
            base,
            Object.fromEntries(
              Object.entries(changeInput).filter(
                ([, value]) => value !== undefined,
              ),
            ),
            note,
          );
          return checkedFields(next);
        },
        client.pubkey,
        signal,
      );
      return `Updated task ${id}.\n\n${describe(saved)}`;
    },
  });

  agents.addTool({
    name: "tasks_note",
    description:
      "Appends a dated progress/evidence note without changing state. Optional links are added to the task, preserving existing links. The new note becomes the summary line.",
    inputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        note: {
          type: "string",
          description: "Progress, evidence, decision or blocker",
        },
        links: {
          type: "array",
          items: {
            type: "object",
            properties: {
              kind: {
                type: "string",
                enum: ["pr", "issue", "thread", "doc", "session", "other"],
              },
              url: { type: "string" },
              label: { type: "string" },
            },
            required: ["kind", "url"],
            additionalProperties: true,
          },
        },
      },
      required: ["id", "note"],
      additionalProperties: false,
    },
    async call(client, _context, args: Args) {
      const session = sessionOf(client);
      const reads = agentReads(client, session);
      const signal = deadline(client);
      const id = textArg(args, "id") ?? "";
      const note = textArg(args, "note") ?? "";
      const added = linksArg(args) ?? [];
      const saved = await change(
        session,
        reads,
        id,
        (base) =>
          reviseTask(
            base,
            {
              links: [...base.links, ...added],
            },
            note,
          ),
        client.pubkey,
        signal,
      );
      return `Added a note to task ${id}.\n\n${describe(saved)}`;
    },
  });
}
