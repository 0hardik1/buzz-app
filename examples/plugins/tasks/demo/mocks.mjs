// Demo-only host boundary: task artifacts remain in browser memory.
// The real Buzz shell and plugin run unchanged; no relay delivery is depicted.
const patched = new WeakMap();
export function wrapRelay(service) {
  if (service?.snapshot && !patched.has(service)) {
    const originalService = service;
    service = { ...service };
    patched.set(originalService, service);
    const snapshot = service.snapshot.bind(service);
    const sessions = new WeakMap();
    service.snapshot = () => {
      const state = snapshot();
      if (!state.session || state.status !== "ready") return state;
      if (!sessions.has(state.session)) {
        const scenario = (globalThis.__BUZZ_VISUAL_STATE__ || "").replace(
          /^(page|channel)-/,
          "",
        );
        if (scenario.startsWith("corrupt"))
          localStorage.setItem(
            `buzz-task-list-pending:${state.session.scope}`,
            "{fictional damaged journal",
          );
        const records = new Map(),
          listeners = new Set();
        let sequence = 0;
        const home = {
          id: "10000000-0000-4000-8000-000000000001",
          name: "Personal tasks",
          channelType: "system",
          visibility: "private",
          creator: state.viewer,
          members: [state.viewer],
        };
        const channel = state.session.channels
          .list()
          .channels.find((item) => item.name === "launch-room");
        const count =
          scenario === "long-list"
            ? 40
            : scenario === "partial"
              ? 500
              : [
                    "one",
                    "long-title",
                    "keyboard",
                    "editing",
                    "saving",
                    "host-unavailable",
                    "offline",
                    "forbidden",
                    "server-error",
                  ].includes(scenario)
                ? 1
                : 0;
        for (let i = 0; i < count; i++) {
          const id = `20000000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`;
          const title =
            scenario === "long-title"
              ? "A".repeat(80) +
                " https://example.invalid/" +
                "release-notes/".repeat(12)
              : `Review launch checklist ${i + 1}`;
          records.set(id, {
            kind: 45010,
            id: String(i + 100).padStart(64, "0"),
            pubkey: state.viewer,
            created_at: 1795000000,
            tags: [
              ["ar", "1"],
              ["op", "create"],
              ["d", id],
              [
                "h",
                globalThis.__BUZZ_VISUAL_STATE__?.startsWith("channel-")
                  ? channel.id
                  : home.id,
              ],
              ["type", "com.squareup.task-list.task"],
              ["p", state.viewer],
            ],
            content: JSON.stringify({
              version: 1,
              title,
              done: false,
              assignees: [state.viewer],
              createdAt: 1795000000000 + i,
              dueDate: "2026-11-19",
            }),
          });
        }
        const channels = new Proxy(
          { ...state.session.channels },
          {
            get(target, key) {
              if (key === "findLabeled") return async () => [home];
              if (key === "get")
                return (id) => (id === home.id ? home : target.get(id));
              if (key === "refreshRoster")
                return async (id) =>
                  id === home.id ? true : target.refreshRoster(id);
              if (key === "resolve") return async () => {};
              return Reflect.get(target, key);
            },
          },
        );
        const session = new Proxy(
          { ...state.session },
          {
            get(target, key) {
              if (key === "channels") return channels;
              // Fake artifacts use the in-memory live listeners below, never host relay follows.
              if (key === "artifacts") return { follow: () => () => {} };
              if (
                key === "configArtifactWriter" &&
                scenario === "host-unavailable"
              )
                return undefined;
              if (key === "configArtifactWriter")
                return {
                  sign: async (event) => ({
                    ...event,
                    pubkey: state.viewer,
                    sig: "c".repeat(128),
                    id: (++sequence).toString(16).padStart(64, "0"),
                  }),
                  publish: async (event) => {
                    if (scenario === "saving") return new Promise(() => {});
                    if (["uncertain", "set-aside"].includes(scenario))
                      throw new Error("Save delivery is unconfirmed");
                    records.set(
                      event.tags.find(([key]) => key === "d")[1],
                      event,
                    );
                    for (const listener of listeners)
                      listener({ events: [event] });
                  },
                };
              if (key === "snapshotRead")
                return async (filters, options) => {
                  if (scenario === "loading") return new Promise(() => {});
                  if (
                    ["offline", "forbidden", "server-error"].includes(scenario)
                  )
                    throw new Error(
                      {
                        offline: "Offline: could not load tasks",
                        forbidden: "Forbidden: cannot read this list",
                        "server-error": "Server error: could not load tasks",
                      }[scenario],
                    );
                  if (!filters.every((filter) => filter.kinds?.includes(45010)))
                    return target.snapshotRead(filters, options);
                  return [...records.values()].filter((event) =>
                    filters.some(
                      (filter) =>
                        (!filter.ids || filter.ids.includes(event.id)) &&
                        Object.entries(filter)
                          .filter(([key]) => key.startsWith("#"))
                          .every(([key, values]) =>
                            event.tags.some(
                              ([tag, value]) =>
                                tag === key.slice(1) && values.includes(value),
                            ),
                          ),
                    ),
                  );
                };
              if (key === "subscribeLive")
                return (listener) => {
                  listeners.add(listener);
                  const stop = target.subscribeLive(listener);
                  return () => {
                    listeners.delete(listener);
                    stop();
                  };
                };
              return Reflect.get(target, key);
            },
          },
        );
        sessions.set(state.session, { ...state, session });
      }
      return sessions.get(state.session);
    };
  }
  return patched.get(service) || service;
}
