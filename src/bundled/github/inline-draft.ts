/** Drafts and delivery locks outlive panel remounts within one plugin session. */
export type InlineTarget = {
  viewer: string;
  path: string;
  side: "LEFT" | "RIGHT";
  line: number;
  head: string;
  base: string;
  replyTo?: number | undefined;
};
export type InlineDraft = {
  body: string;
  operation: string;
  target?: InlineTarget | undefined;
  busy: boolean;
  unknown: boolean;
  attempt?: string | undefined;
  stale?: boolean | undefined;
  error?: string | undefined;
  sentUrl?: string | undefined;
};
export function createInlineDraft() {
  let state: InlineDraft = {
    body: "",
    operation: crypto.randomUUID(),
    busy: false,
    unknown: false,
  };
  const listeners = new Set<() => void>();
  const update = (change: Partial<InlineDraft>) => {
    state = { ...state, ...change };
    for (const listener of listeners) listener();
  };
  return {
    get: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    update,
    /** A synchronous lock also covers clicks before React commits disabled UI. */
    begin() {
      if (state.busy || state.unknown || !state.body.trim() || !state.target)
        return undefined;
      const captured = {
        body: state.body,
        target: state.target,
        operation: state.operation,
      };
      update({ busy: true, error: undefined, sentUrl: undefined });
      return captured;
    },
  };
}
export type InlineDraftStore = ReturnType<typeof createInlineDraft>;
