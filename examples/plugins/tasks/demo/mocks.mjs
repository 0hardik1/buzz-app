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
              if (key === "configArtifactWriter")
                return {
                  sign: async (event) => ({
                    ...event,
                    pubkey: state.viewer,
                    id: (++sequence).toString(16).padStart(64, "0"),
                  }),
                  publish: async (event) => {
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
