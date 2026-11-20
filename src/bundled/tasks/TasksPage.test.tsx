// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { expect, it, vi, afterEach } from "vitest";
import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ArtifactEntry } from "../../features/artifact-storage/types";
import type { ArtifactStorage } from "../../features/artifact-storage/service";
import type { RelayData } from "../../features/relay/service";
import type { RelayEvent } from "../../features/relay/events";
import type { RelaySession } from "../../features/relay/session";
import { createTaskFields, taskOf, type TaskFields } from "./model";
import { TasksPage } from "./TasksPage";
import { parseLinks } from "./TaskEditor";

const viewer = "a".repeat(64);
const id = "11111111-1111-4111-8111-111111111111";
const home = "22222222-2222-4222-8222-222222222222";
const base = createTaskFields({
  title: "Build the tracker",
  why: "Agents need durable context.",
  done_when: "The workflow is tested.",
});

afterEach(() => cleanup());

function event(fields: TaskFields, revision = "d".repeat(64)) {
  return {
    id: revision,
    pubkey: viewer,
    sig: "",
    created_at: 100,
    kind: 45010,
    content: JSON.stringify({ version: 4, ...fields }),
    tags: [
      ["ar", "1"],
      ["d", id],
      ["h", home],
      ["type", "buzz.task"],
      ["title", fields.title],
      ["state", fields.state],
    ],
  };
}

function entry(fields: TaskFields): ArtifactEntry {
  const revision = event(fields);
  return {
    record: {
      id: revision.id,
      channelId: home,
      type: "buzz.task",
      current: {
        id: revision.id,
        content: revision.content,
        event: revision as unknown as RelayEvent,
      },
      availability: { state: "available" },
    },
  };
}

function setup(rows: ArtifactEntry[] = [], writable = true) {
  const collection = {
    subscribe: () => () => {},
    page: vi.fn(async () => ({ entries: rows })),
    refreshError: vi.fn(async () => null),
    close: vi.fn(),
  };
  const storage = {
    open: vi.fn(() => collection),
  } as unknown as ArtifactStorage;
  const sign = vi.fn(async (template: object) => ({
    ...template,
    id: "f".repeat(64),
    pubkey: viewer,
    sig: "",
  }));
  const publish = vi.fn(async () => "");
  const session = {
    viewer,
    relayAuthor: "e".repeat(64),
    snapshotRead: vi.fn(async () => []),
    ...(writable ? { configArtifactWriter: { sign, publish } } : {}),
    channels: {
      ensureList: () => () => {},
      subscribeList: () => () => {},
      list: () => ({
        status: "ready",
        channels: [{ id: home, name: "agents", channelType: "stream" }],
      }),
    },
  } as unknown as RelaySession;
  const connection = {
    status: "ready",
    scope: `https://community:${viewer}`,
    generation: "one",
    session,
  };
  const relay = {
    snapshot: () => connection,
    subscribe: () => () => {},
  } as unknown as RelayData;
  return { storage, relay, collection, sign, publish };
}

function parseLinksShape(text: string) {
  return parseLinks(text).map(({ kind, url, label }) => ({ kind, url, label }));
}

it("renders the task table and filters by its latest evidence", async () => {
  const app = setup([entry(base)]);
  render(<TasksPage relay={app.relay} storage={app.storage} />);
  expect(
    await screen.findByRole("button", { name: "Build the tracker" }),
  ).toBeInTheDocument();
  expect(screen.getByRole("table")).toHaveTextContent(
    "Agents need durable context.",
  );
  expect(screen.getByRole("table")).toHaveTextContent("Created task.");
  expect(screen.getByRole("table")).toHaveTextContent("agents");
  await userEvent.type(
    screen.getByRole("searchbox", { name: "Search tasks" }),
    "no-match",
  );
  expect(
    screen.getByRole("heading", { name: "No matching tasks" }),
  ).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Clear filters" }));
  expect(
    screen.getByRole("button", { name: "Build the tracker" }),
  ).toBeInTheDocument();
});

it("creates a Task v2 from the dialog", async () => {
  const app = setup();
  render(<TasksPage relay={app.relay} storage={app.storage} />);
  expect(
    await screen.findByRole("heading", { name: "No tasks yet" }),
  ).toBeInTheDocument();
  const createButtons = screen.getAllByRole("button", { name: "New task" });
  const firstCreate = createButtons[0];
  if (!firstCreate) throw new Error("Missing create button");
  await userEvent.click(firstCreate);
  const dialog = screen.getByRole("dialog", { name: "New task" });
  await userEvent.type(
    within(dialog).getByLabelText("Title"),
    "Track an incident",
  );
  await userEvent.type(
    within(dialog).getByLabelText("Why"),
    "The agent must know the impact.",
  );
  await userEvent.type(
    within(dialog).getByLabelText("Done when"),
    "Service is healthy and the PR is linked.",
  );
  await userEvent.type(
    within(dialog).getByLabelText(/Links/),
    "https://github.com/block/buzz-app/issues/42",
  );
  await userEvent.type(
    within(dialog).getByLabelText(/First note/),
    "Started from the incident report.",
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Create task" }),
  );
  await waitFor(() => expect(app.publish).toHaveBeenCalledOnce());
  const signed = app.sign.mock.calls[0]?.[0] as {
    content: string;
    tags: string[][];
  };
  expect(JSON.parse(signed.content)).toMatchObject({
    version: 4,
    title: "Track an incident",
    why: "The agent must know the impact.",
    done_when: "Service is healthy and the PR is linked.",
    state: "open",
    links: [
      { kind: "issue", url: "https://github.com/block/buzz-app/issues/42" },
    ],
  });
  expect(signed.tags).toContainEqual(["h", home]);
  expect(
    await screen.findByRole("button", { name: "Track an incident" }),
  ).toBeInTheDocument();
});

it("requires a note before an update and appends it on save", async () => {
  const app = setup([entry(base)]);
  render(<TasksPage relay={app.relay} storage={app.storage} />);
  await userEvent.click(
    await screen.findByRole("button", { name: "Build the tracker" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Edit task" });
  expect(
    within(dialog).getByRole("heading", { name: "Log" }),
  ).toBeInTheDocument();
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save update" }),
  );
  expect(within(dialog).getByRole("alert")).toHaveTextContent("Add a note");
  expect(app.publish).not.toHaveBeenCalled();
  await userEvent.type(
    within(dialog).getByLabelText("Update note"),
    "Implementation is ready for review.",
  );
  await userEvent.click(
    within(dialog).getByRole("button", { name: "Save update" }),
  );
  await waitFor(() => expect(app.publish).toHaveBeenCalledOnce());
  const signed = app.sign.mock.calls[0]?.[0] as {
    content: string;
    tags: string[][];
  };
  const body = JSON.parse(signed.content) as TaskFields;
  expect(body.log).toHaveLength(2);
  expect(body.log.at(-1)?.note).toBe("Implementation is ready for review.");
  expect(signed.tags).toContainEqual(["prev", "d".repeat(64)]);
});

it("shows a read-only record without edit actions when no writer is available", async () => {
  const app = setup([entry(base)], false);
  render(<TasksPage relay={app.relay} storage={app.storage} />);
  expect(
    await screen.findByRole("button", { name: "Build the tracker" }),
  ).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "New task" })).toBeNull();
  await userEvent.click(
    screen.getByRole("button", { name: "Build the tracker" }),
  );
  const dialog = screen.getByRole("dialog", { name: "Build the tracker" });
  expect(within(dialog).getByLabelText("Title")).toBeDisabled();
  expect(
    within(dialog).queryByRole("button", { name: "Save update" }),
  ).toBeNull();
  expect(within(dialog).getAllByRole("button", { name: "Close" })).toHaveLength(
    2,
  );
});

it("parses optional typed links and rejects malformed lines", () => {
  expect(
    parseLinksShape(
      "https://github.com/block/buzz-app/pull/1\nthread | buzz://message?channel=a&id=b | Source",
    ),
  ).toEqual([
    {
      kind: "pr",
      url: "https://github.com/block/buzz-app/pull/1",
      label: undefined,
    },
    { kind: "thread", url: "buzz://message?channel=a&id=b", label: "Source" },
  ]);
  expect(() => parseLinks("issue | not-a-url")).toThrow("Link 1");
});

// Keep the fixture decoder in this UI suite too: a bad persisted record must
// not render as a false task.
it("ignores persisted records whose tag and content state disagree", () => {
  const bad = event(base);
  bad.tags = bad.tags.filter(([name]) => name !== "state");
  expect(taskOf(bad)).toBeUndefined();
});

// Base UI uses a pointer media query when choosing dialog focus.
if (!window.matchMedia) {
  Object.defineProperty(window, "matchMedia", {
    value: () => ({
      matches: false,
      addEventListener: () => {},
      removeEventListener: () => {},
    }),
  });
}

// jsdom does not implement native scrollIntoView used by Select's popup.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
