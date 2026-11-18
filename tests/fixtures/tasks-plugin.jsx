// Local visual fixture only. No real identity, relay requests or writes.
import * as React from "react";
import { pluginUi } from "../../src/plugins/ui";
import { createRoot } from "react-dom/client";
import { PanelHeader } from "../../src/shared/design-system/ui/PanelHeader";
import { Tabs } from "../../src/shared/design-system/ui/Tabs";
import { apply, taskTemplate } from "../../examples/plugins/tasks/plugin.js";
import "../../src/shared/styles/globals.css";
const viewer = "a".repeat(64),
  other = "b".repeat(64);
const home = "10000000-0000-4000-8000-000000000001",
  design = "10000000-0000-4000-8000-000000000002",
  launch = "10000000-0000-4000-8000-000000000003";
const channels = [
  {
    id: home,
    name: "Personal tasks",
    channelType: "system",
    visibility: "private",
    creator: viewer,
    members: [viewer],
  },
  {
    id: design,
    name: "Design",
    channelType: "stream",
    visibility: "public",
    members: [viewer, other],
  },
  {
    id: launch,
    name: "Launch",
    channelType: "stream",
    visibility: "private",
    members: [viewer, other],
  },
];
const records = new Map();
let sequence = 10;
for (const [index, [channel, title, assignees, done]] of [
  [home, "Book a dentist appointment", [viewer], false],
  [home, "Plan the weekend", [viewer], false],
  [design, "Review the updated onboarding screens", [viewer], false],
  [design, "Check the new icon set", [viewer], false],
  [design, "Explore the colour palette", [other], false],
  [design, "Unassigned channel task", [], false],
  [launch, "Write the release notes", [viewer], false],
  [launch, "Share the first preview", [viewer], true],
].entries()) {
  const id = `20000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
  records.set(id, {
    ...taskTemplate({
      id,
      channel,
      title,
      assignees,
      done,
      ...(index === 0
        ? { dueDate: "2026-11-20" }
        : index === 2
          ? { dueAt: "2026-11-18T16:00:00.000Z" }
          : index === 5
            ? { dueAt: "2026-11-19T09:30:00.000Z" }
            : {}),
    }),
    pubkey: viewer,
    id: String(index).padStart(64, "0"),
  });
}
const subscribers = new Set();
const session = {
  viewer,
  scope: "tasks-preview",
  media: () => "/tests/fixtures/design-system/assets/avatar.png",
  channels: {
    get: (id) => channels.find((c) => c.id === id),
    list: () => ({ channels: channels.slice(1) }),
    subscribeList: () => () => {},
    resolve: async () => {},
    refreshRoster: async () => true,
    findLabeled: async () => [channels[0]],
  },
  profiles: {
    snapshot: () =>
      new Map([
        [viewer, { name: "You", picture: "https://example.test/viewer.png" }],
        [
          other,
          {
            name: "Alex",
            username: "awalker",
            verified: {
              displayName: "Alex",
              fullName: "Alex Walker",
              username: "alex.w",
            },
            picture: "https://example.test/alex.png",
          },
        ],
      ]),
  },
  snapshotRead: async ([filter]) =>
    [...records.values()].filter((e) => {
      const tag = (key) => e.tags.find(([name]) => name === key)?.[1];
      return (
        (!filter.ids || filter.ids.includes(e.id)) &&
        (!filter["#p"] ||
          e.tags.some(
            ([key, value]) => key === "p" && filter["#p"].includes(value),
          )) &&
        (!filter["#h"] ? tag("h") !== home : filter["#h"].includes(tag("h"))) &&
        (!filter["#d"] || filter["#d"].includes(tag("d")))
      );
    }),
  subscribeLive: (listener) => {
    subscribers.add(listener);
    return () => subscribers.delete(listener);
  },
  configArtifactWriter: {
    sign: async (event) => ({
      ...event,
      pubkey: viewer,
      id: (++sequence).toString(16).padStart(64, "0"),
    }),
    publish: async (event) => {
      records.set(event.tags.find(([key]) => key === "d")[1], event);
      for (const listener of subscribers) listener({ events: [event] });
    },
  },
};
const state = { session, viewer, scope: session.scope, status: "ready" };
let panel = null;
const effects = [];
apply({
  react: React,
  ui: pluginUi,
  relay: { snapshot: () => state, subscribe: () => () => {} },
  pages: { register() {} },
  panels: {
    register: (value) => {
      panel = value;
    },
  },
  effect: (effect) => {
    effects.push(effect());
  },
});
function App() {
  const [channel, setChannel] = React.useState(false);
  const [open, setOpen] = React.useState(true);
  const [accent, setAccent] = React.useState("cobalt");
  React.useEffect(() => {
    document.documentElement.dataset.accent = accent;
  }, [accent]);
  return (
    <div
      style={{
        height: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--surface-base)",
        padding: "var(--space-3)",
        gap: "var(--space-3)",
      }}
    >
      <nav
        style={{
          display: "flex",
          gap: "var(--space-3)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span className="text-body-sm">Sample data preview</span>
        <label className="text-body-sm">
          Accent{" "}
          <select
            aria-label="Accent colour"
            value={accent}
            onChange={(event) => setAccent(event.target.value)}
          >
            {[
              ["bee", "Honey"],
              ["magenta", "Magenta"],
              ["iris", "Iris"],
              ["cobalt", "Cobalt"],
              ["citrus", "Citrus"],
              ["mono", "Mono"],
            ].map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          className="buzz-button"
          data-variant="subtle"
          data-size="sm"
          onClick={() => {
            setChannel(false);
            setOpen(true);
          }}
        >
          My tasks
        </button>
        <button
          type="button"
          className="buzz-button"
          data-variant="subtle"
          data-size="sm"
          onClick={() => {
            setChannel(true);
            setOpen(true);
          }}
        >
          Design channel
        </button>
        <button
          type="button"
          className="buzz-button"
          data-variant="subtle"
          data-size="sm"
          onClick={() => {
            const root = document.documentElement;
            root.dataset.colorMode =
              root.dataset.colorMode === "dark" ? "light" : "dark";
          }}
        >
          Theme
        </button>
      </nav>
      {open && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            flex: 1,
            minHeight: 0,
            width: "min(100%, 420px)",
            alignSelf: "flex-end",
            borderLeft: "1px solid var(--border-standard)",
          }}
        >
          <PanelHeader
            title={
              <Tabs
                label="Task pane"
                variant="navigation"
                value="tasks"
                onValueChange={() => {}}
                items={[
                  {
                    value: "tasks",
                    label: "To-do",
                    icon: <panel.tabIcon />,
                    onClose: () => setOpen(false),
                  },
                ]}
              />
            }
          />
          <div style={{ flex: 1, minHeight: 0 }}>
            {channel ? (
              <panel.component
                target={`buzz-tasks:${design}`}
                channelContext={{ channelId: design, scope: session.scope }}
              />
            ) : (
              <panel.component target="buzz-tasks:personal" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
const root = document.getElementById("root");
if (root) createRoot(root).render(<App />);
