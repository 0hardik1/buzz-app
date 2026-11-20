import { expect, it, vi } from "vitest";
import { PublishRejected } from "../../features/relay/outbox";
import type { RelaySession } from "../../features/relay/session";
import {
  createTaskFields,
  reviseTask,
  TASK_TYPE,
  type TaskFields,
} from "./model";
import { addTaskTools } from "./tools";

const viewer = "a".repeat(64);
const agent = "9".repeat(64);
const relayAuthor = "e".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
const home = "22222222-2222-4222-8222-222222222222";
const huddle = "44444444-4444-4444-8444-444444444444";
const secret = "33333333-3333-4333-8333-333333333333";

type Event = {
  id: string;
  pubkey: string;
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
};
type Filter = Record<string, unknown>;
type Signed = {
  kind: number;
  created_at: number;
  content: string;
  tags: string[][];
};

const fields = createTaskFields({
  title: "Ship task tracking",
  why: "Work needs continuity.",
  done_when: "A new session can resume it.",
});

function head(
  value: TaskFields = fields,
  revision = "d".repeat(64),
  taskId = id,
  atHome = home,
): Event {
  return {
    id: revision,
    pubkey: viewer,
    created_at: 10,
    kind: 45010,
    content: JSON.stringify({
      version: 4,
      title: value.title,
      why: value.why,
      done_when: value.done_when,
      state: value.state,
      links: value.links,
      log: value.log,
    }),
    tags: [
      ["ar", "1"],
      ["d", taskId],
      ["h", atHome],
      ["type", TASK_TYPE],
      ["title", value.title],
      ["state", value.state],
    ],
  };
}

function place(channel: string, type = "stream", isHuddle = false): Event {
  return {
    id: channel.replace(/-/g, "").padEnd(64, "0"),
    pubkey: relayAuthor,
    created_at: 1,
    kind: 39000,
    content: "",
    tags: [
      ["d", channel],
      ["name", "work"],
      ["t", type],
      ...(isHuddle
        ? [["about", `Buzz Huddle (buzz.huddles/v1)\nparent:${home}`]]
        : []),
    ],
  };
}

function answer(events: Event[], filters: Filter[]) {
  const filter = filters[0] ?? {};
  return events.filter((event) => {
    if (!(filter.kinds as number[]).includes(event.kind)) return false;
    if (Array.isArray(filter.authors) && !filter.authors.includes(event.pubkey))
      return false;
    for (const [key, values] of Object.entries(filter)) {
      if (
        key.startsWith("#") &&
        !event.tags.some(
          ([name, value]) =>
            name === key.slice(1) && (values as string[]).includes(value ?? ""),
        )
      )
        return false;
    }
    return true;
  });
}

function setup(
  heads: Event[] | ((signed: Signed[]) => Event[]) = [],
  publishImpl?: (event: Event) => Promise<string>,
) {
  const signed: Signed[] = [];
  const currentHeads = () =>
    typeof heads === "function" ? heads(signed) : heads;
  const places = [place(home), place(secret), place(huddle, "stream", true)];
  const session = {
    viewer,
    relayAuthor,
    snapshotRead: vi.fn(async (filters: Filter[]) =>
      answer([...currentHeads(), ...places], filters),
    ),
    configArtifactWriter: {
      sign: vi.fn(async (template: Signed) => {
        signed.push(template);
        return {
          ...template,
          id: `${signed.length}`.padStart(64, "f"),
          pubkey: viewer,
          sig: "",
        } as Event;
      }),
      publish: vi.fn(publishImpl ?? (async () => "")),
    },
  } as unknown as RelaySession;
  const client = {
    key: agent,
    pubkey: agent,
    signal: new AbortController().signal,
    query: vi.fn(async (filters: Filter[]) =>
      answer(
        [
          ...currentHeads(),
          ...places.filter(
            (item) => !item.tags.some(([, value]) => value === secret),
          ),
        ],
        filters,
      ),
    ),
  };
  const tools = new Map<
    string,
    (args: Record<string, unknown>) => Promise<string>
  >();
  addTaskTools({
    relay: () => ({ snapshot: () => ({ status: "ready", session }) }) as never,
    addTool: (tool) => {
      tools.set(
        tool.name,
        (args) =>
          tool.call(
            client as never,
            { channel: home } as never,
            args,
          ) as Promise<string>,
      );
    },
  });
  const call = (name: string, args: Record<string, unknown>) => {
    const tool = tools.get(name);
    if (!tool) throw new Error(`No ${name}`);
    return tool(args);
  };
  return { call, signed, client, session };
}

it("registers the Task v2 workflow tools", () => {
  const names: string[] = [];
  addTaskTools({
    relay: () => undefined as never,
    addTool: (tool) => void names.push(tool.name),
  });
  expect(names).toEqual([
    "tasks_find",
    "tasks_create",
    "tasks_update",
    "tasks_note",
  ]);
});

it("creates with why and done_when through the owner, using agent reads", async () => {
  const { call, signed, client, session } = setup();
  const reply = await call("tasks_create", {
    title: "New tracker",
    why: "The user wants work to survive handoff.",
    done_when: "The PR has been reviewed and tested.",
    state: "open",
    links: [{ kind: "thread", url: "buzz://message?channel=home&id=start" }],
    note: "Requested in the planning thread.",
  });
  expect(reply).toContain("Created task");
  expect(client.query).toHaveBeenCalled();
  expect(session.snapshotRead).not.toHaveBeenCalled();
  expect(signed).toHaveLength(1);
  const saved = signed[0];
  expect(saved?.tags).toContainEqual(["via", agent]);
  expect(saved?.tags).toContainEqual(["state", "open"]);
  expect(JSON.parse(saved?.content ?? "")).toMatchObject({
    version: 4,
    why: "The user wants work to survive handoff.",
    done_when: "The PR has been reviewed and tested.",
    state: "open",
  });
});

it("returns an active exact-title duplicate unless explicitly overridden", async () => {
  const { call, signed } = setup([head()]);
  const reply = await call("tasks_create", {
    title: "ship   task tracking",
    why: "Another reason.",
    done_when: "Separate acceptance.",
  });
  expect(reply).toContain("Not created");
  expect(reply).toContain(id);
  expect(signed).toHaveLength(0);
  await call("tasks_create", {
    title: "Ship task tracking",
    why: "Confirmed separate.",
    done_when: "Separate acceptance.",
    new_anyway: true,
  });
  expect(signed).toHaveLength(1);
});

it("never creates in a home the agent cannot read", async () => {
  const { call, signed } = setup();
  await expect(
    call("tasks_create", {
      home: secret,
      title: "Private work",
      why: "Hidden from the agent.",
      done_when: "Anything.",
    }),
  ).rejects.toThrow("can’t read that home");
  await expect(
    call("tasks_create", {
      home: huddle,
      title: "Huddle work",
      why: "A huddle is not a task home.",
      done_when: "Anything.",
    }),
  ).rejects.toThrow("not a DM or huddle");
  expect(signed).toHaveLength(0);
});

it("requires a note and evidence for an update, then appends it", async () => {
  const { call, signed } = setup([head()]);
  await expect(
    call("tasks_update", { id, state: "done", note: " " }),
  ).rejects.toThrow("Add a note");
  expect(signed).toHaveLength(0);
  const reply = await call("tasks_update", {
    id,
    state: "done",
    note: "Merged PR 42 and verified the task table.",
    links: [{ kind: "pr", url: "https://github.com/block/buzz-app/pull/42" }],
  });
  expect(reply).toContain("Updated task");
  const saved = JSON.parse(signed[0]?.content ?? "") as TaskFields;
  expect(saved.state).toBe("done");
  expect(saved.log).toHaveLength(2);
  expect(saved.log[1]).toMatchObject({
    note: "Merged PR 42 and verified the task table.",
    state: "done",
  });
});

it("reapplies an update over a conflict without losing the other log note", async () => {
  const theirs = head(
    reviseTask(fields, { state: "open" }, "Started in another session.", 11),
    "c".repeat(64),
  );
  const { call, signed } = setup(
    (signed) => (signed.length ? [theirs] : [head()]),
    async () => {
      if (signed.length === 1)
        throw new PublishRejected("rejected", "conflict: stale prev");
      return "";
    },
  );
  await call("tasks_update", {
    id,
    state: "waiting",
    note: "Waiting on a review.",
  });
  expect(signed).toHaveLength(2);
  const second = JSON.parse(signed[1]?.content ?? "") as TaskFields;
  expect(second.log.map((entry) => entry.note)).toEqual([
    "Created task.",
    "Started in another session.",
    "Waiting on a review.",
  ]);
  expect(second.log.map((entry) => entry.note)).toContain(
    "Started in another session.",
  );
  expect(signed[1]?.tags).toContainEqual(["prev", "c".repeat(64)]);
});

it("appends a note and links without changing state", async () => {
  const { call, signed } = setup([head()]);
  await call("tasks_note", {
    id,
    note: "Found the implementation branch.",
    links: [{ kind: "session", url: "buzz://agent/session/work-1" }],
  });
  const saved = JSON.parse(signed[0]?.content ?? "") as TaskFields;
  expect(saved.state).toBe("open");
  expect(saved.log.at(-1)?.note).toBe("Found the implementation branch.");
  expect(saved.links[0]).toMatchObject({ kind: "session" });
});
