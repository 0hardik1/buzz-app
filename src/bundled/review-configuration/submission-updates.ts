import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { RelaySession } from "../../features/relay/session";
import type { EventData } from "../../features/relay/events";
import {
  REVIEW_REPORT,
  REVIEW_SUBMISSION,
} from "../../features/agents/pr-review";
import {
  applyReviewReports,
  loadSubmissions,
  type SavedSubmission,
} from "./submissions";

const selectionFallback = new Map<string, string>();
const selectionListeners = new Set<() => void>();
const selectionKey = (scope: string) => `buzz.review.channel:${scope}`;
export function useReviewChannel(scope: string) {
  const channel = useSyncExternalStore(
    (listener) => {
      selectionListeners.add(listener);
      window.addEventListener("storage", listener);
      return () => {
        selectionListeners.delete(listener);
        window.removeEventListener("storage", listener);
      };
    },
    () => {
      try {
        return (
          selectionFallback.get(scope) ??
          localStorage.getItem(selectionKey(scope)) ??
          ""
        );
      } catch {
        return selectionFallback.get(scope) ?? "";
      }
    },
  );
  const select = useCallback(
    (value: string) => {
      try {
        localStorage.setItem(selectionKey(scope), value);
        selectionFallback.delete(scope);
      } catch {
        selectionFallback.set(scope, value);
      }
      for (const listener of selectionListeners) listener();
    },
    [scope],
  );
  return [channel, select] as const;
}

/** Preferences only: every consumer checks current membership and configuration. */
export const useReviewRepository = (scope: string) =>
  useReviewChannel(`repository:${scope}`);
export const useRepositoryDefault = (scope: string, repository: string) =>
  useReviewChannel(`default:${scope}:${repository}`);

export function reviewVersion(row: SavedSubmission) {
  return JSON.stringify([
    row.value.generation ?? row.value.submittedAt ?? "",
    row.value.triage?.state,
    row.value.threads.map((thread) => thread.request),
    (row.reviewReports ?? []).map((event) => event.id).sort(),
  ]);
}
type Snapshot = {
  rows: SavedSubmission[];
  loading: boolean;
  error: string;
  warning: string;
  seen: Record<string, string>;
  hasMore: boolean;
};
const empty = (): Snapshot => ({
  rows: [],
  loading: true,
  error: "",
  warning: "",
  seen: {},
  hasMore: false,
});

/** One bounded snapshot (plus report batches) for the selected channel, shared
 * by the dock and table. Live events refresh it; there is no polling. A new
 * relay session performs a jittered bounded repair after access is confirmed. */
export function createSubmissionUpdates(
  session: RelaySession,
  selection: string | readonly string[],
  artifact?: string,
) {
  const channels = typeof selection === "string" ? [selection] : [...selection];
  const keyFor = (channel: string) =>
    `buzz.review.seen:${session.scope}:${channel}`;
  const keys = channels.map(keyFor);
  const rowChannel = (row: SavedSubmission) => row.channel ?? channels[0] ?? "";
  const listeners = new Set<() => void>();
  let state = empty();
  let controller: AbortController | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopLive: (() => void) | undefined;
  let pending: EventData[] = [];
  let refreshDelay = 100;
  const emit = (next: Snapshot) => {
    state = next;
    for (const listener of listeners) listener();
  };
  const readSeen = () => {
    const seen: Record<string, string> = { ...state.seen };
    for (const key of keys) {
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? "{}");
        if (value && typeof value === "object" && !Array.isArray(value))
          Object.assign(
            seen,
            Object.fromEntries(
              Object.entries(value).filter(([, v]) => typeof v === "string"),
            ),
          );
      } catch {
        /* Damaged preferences must not hide updates. */
      }
    }
    return seen;
  };
  const storage = (event: StorageEvent) => {
    if (event.key === null || keys.includes(event.key))
      emit({ ...state, seen: readSeen() });
  };
  let offset = 0;
  const load = (append = false) => {
    if (!listeners.size) return;
    clearTimeout(timer);
    controller?.abort();
    const current = new AbortController();
    controller = current;
    pending = [];
    const nextOffset = append ? offset + 500 : 0;
    emit({ ...state, loading: true, error: "" });
    void loadSubmissions(
      session,
      selection,
      AbortSignal.any([current.signal, AbortSignal.timeout(20_000)]),
      { offset: nextOffset, ...(artifact ? { artifact } : {}) },
    )
      .then((next) => {
        if (current.signal.aborted) return;
        refreshDelay = 100;
        offset = nextOffset;
        const incoming = new Set(next.rows.map((row) => row.artifactId));
        emit({
          ...state,
          ...next,
          rows: [
            ...(append
              ? state.rows.filter((row) => !incoming.has(row.artifactId))
              : []),
            ...next.rows,
          ].map((row) => applyReviewReports(row, rowChannel(row), pending)),
          loading: false,
        });
        pending = [];
      })
      .catch((reason: unknown) => {
        if (!current.signal.aborted) {
          refreshDelay = Math.min(30_000, refreshDelay * 2);
          emit({
            ...state,
            loading: false,
            error:
              reason instanceof Error
                ? reason.message
                : "Could not load previous submissions.",
          });
        }
      });
  };
  const reload = () => load();
  return {
    snapshot: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener);
      if (listeners.size === 1) {
        state = { ...state, seen: readSeen() };
        window.addEventListener("storage", storage);
        timer = setTimeout(reload, Math.random() * 250);
        stopLive = session.subscribeLive?.(
          ({ events }) => {
            const scoped = events.filter((event) =>
              event.tags.some(
                (tag) => tag[0] === "h" && channels.includes(tag[1] ?? ""),
              ),
            );
            if (
              scoped.some(
                (event) =>
                  event.kind === 45010 &&
                  (state.loading ||
                    typeof selection === "string" ||
                    event.pubkey === session.viewer ||
                    state.rows.some((row) =>
                      event.tags.some(
                        ([name, value]) =>
                          name === "d" && value === row.artifactId,
                      ),
                    ) ||
                    (() => {
                      try {
                        const value = JSON.parse(event.content);
                        return (
                          Array.isArray(value.config?.lanes) &&
                          value.config.lanes.some(
                            (lane: { humanReviewers?: unknown }) =>
                              Array.isArray(lane.humanReviewers) &&
                              lane.humanReviewers.includes(session.viewer),
                          )
                        );
                      } catch {
                        return false;
                      }
                    })()) &&
                  event.tags.some(
                    (tag) => tag[0] === "type" && tag[1] === REVIEW_SUBMISSION,
                  ),
              )
            ) {
              clearTimeout(timer);
              timer = setTimeout(reload, refreshDelay + Math.random() * 250);
            }
            const reports = scoped.filter(
              (event) =>
                event.kind === 9 &&
                event.tags.some(
                  (tag) => tag[0] === "t" && tag[1] === REVIEW_REPORT,
                ),
            );
            if (!reports.length) return;
            if (state.loading) pending.push(...reports);
            else
              emit({
                ...state,
                rows: state.rows.map((row) =>
                  applyReviewReports(row, rowChannel(row), reports),
                ),
              });
          },
          { replay: true },
        );
      }
      return () => {
        listeners.delete(listener);
        if (listeners.size) return;
        stopLive?.();
        controller?.abort();
        clearTimeout(timer);
        window.removeEventListener("storage", storage);
        state = empty();
      };
    },
    reload,
    loadMore: () => {
      if (!state.loading && state.hasMore) load(true);
    },
    setRows(update: (rows: SavedSubmission[]) => SavedSubmission[]) {
      emit({ ...state, rows: update(state.rows) });
    },
    unread(row: SavedSubmission) {
      const seen = state.seen[row.artifactId];
      return seen
        ? seen !== reviewVersion(row)
        : !!(row.reviewReports?.length || row.value.triage?.decision);
    },
    unreadLane(row: SavedSubmission, index: number | "triage") {
      if (index === "triage" && !row.value.triage) return false;
      const report = row.reviewReports?.find((event) =>
        event.tags.some(
          (tag) => tag[0] === "review" && tag[2] === String(index),
        ),
      );
      const encoded = state.seen[row.artifactId];
      if (encoded === reviewVersion(row)) return false;
      if (encoded) {
        try {
          const previous: unknown = JSON.parse(encoded);
          if (
            Array.isArray(previous) &&
            Array.isArray(previous[2]) &&
            Array.isArray(previous[3])
          ) {
            if (
              previous[0] !==
              (row.value.generation ?? row.value.submittedAt ?? "")
            )
              return true;
            return index === "triage"
              ? previous[1] !== row.value.triage?.state
              : (previous[2][index] ?? "") !==
                  (row.value.threads[index]?.request ?? "") ||
                  (!!report && !previous[3].includes(report.id));
          }
        } catch {
          /* Old or damaged preferences must not hide current reports. */
        }
      }
      return index === "triage" ? !!row.value.triage?.decision : !!report;
    },
    markSeen(input: SavedSubmission | SavedSubmission[]) {
      // Acknowledge exactly the rendered version; a newer report stays unread.
      const seen = {
        ...readSeen(),
        ...state.seen,
        ...Object.fromEntries(
          (Array.isArray(input) ? input : [input]).map((row) => [
            row.artifactId,
            reviewVersion(row),
          ]),
        ),
      };
      try {
        const rows = Array.isArray(input) ? input : [input];
        for (const channel of new Set(rows.map(rowChannel))) {
          const channelSeen = rows.filter((row) => rowChannel(row) === channel);
          const existing: Record<string, string> = JSON.parse(
            localStorage.getItem(keyFor(channel)) ?? "{}",
          );
          localStorage.setItem(
            keyFor(channel),
            JSON.stringify({
              ...existing,
              ...Object.fromEntries(
                channelSeen.map((row) => [
                  row.artifactId,
                  seen[row.artifactId],
                ]),
              ),
            }),
          );
        }
      } catch {
        /* Acknowledgment still works for this session. */
      }
      emit({ ...state, seen });
    },
  };
}
const stores = new WeakMap<
  RelaySession,
  Map<string, ReturnType<typeof createSubmissionUpdates>>
>();
const idle = empty();
const noSubscribe = () => () => {};
export function useSubmissionUpdates(
  session: RelaySession,
  channel: string,
  enabled: boolean,
  historyChannels?: readonly string[],
  artifact?: string,
) {
  const signature = historyChannels
    ? [...historyChannels].sort().join(":")
    : undefined;
  const storeKey =
    signature === undefined
      ? `${channel}${artifact ? `:${artifact}` : ""}`
      : `mine:${signature}`;
  const store = useMemo(() => {
    let channels = stores.get(session);
    if (!channels) {
      channels = new Map();
      stores.set(session, channels);
    }
    let value = channels.get(storeKey);
    if (!value) {
      value = createSubmissionUpdates(
        session,
        signature === undefined
          ? channel
          : signature
            ? signature.split(":")
            : [],
        artifact,
      );
      channels.set(storeKey, value);
    }
    return value;
  }, [session, signature, storeKey, channel, artifact]);
  const snapshot = useSyncExternalStore(
    enabled ? store.subscribe : noSubscribe,
    enabled ? store.snapshot : () => idle,
  );
  return { ...snapshot, store };
}
