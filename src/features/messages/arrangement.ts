import {
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useMemo,
  useSyncExternalStore,
} from "react";
import type {
  ConversationPresentation,
  PresentationLimits,
} from "../conversation/contracts";
import { listByteSize } from "../relay/budget";
import type { ChannelMessage } from "../relay/contracts";
import type { EventData, RelayEvent } from "../relay/events";
import type { LiveBatch } from "../relay/incoming";
import { channelRowKind } from "../relay/membership";
import { shareMessageRows } from "../relay/row-identity";
import type { RelaySession } from "../relay/session";
import { threadReference } from "../relay/thread-reference";
import { AUX, growAux, inChannel } from "../relay/threads";

/** A reader accessory, by identity. */
export type ArrangementLane = object;
/** The rows a reader shows in place of the host's, while a lane is shown. */
export type Display = Readonly<{
  /** The rows named by `ids` that fold, in `ids` order. */
  rows: readonly ChannelMessage[];
  /** Display parents; a reader nests with `replyTree(rows, rootId, parents.get)`.
   * Absent: the reader's own branches; an empty map: every row at the top level. */
  parents: ReadonlyMap<string, string> | undefined;
  open: readonly string[];
  complete: boolean;
  place: NonNullable<ConversationPresentation["place"]>;
  /** Changes with each presentation, not with live updates of its rows. */
  revision: number;
}>;
/** Pure evidence state for one presentation. `root` and visibility
 * `dependencies` stay outside `tracked` so live auxiliaries on the header or
 * unpresented targets never grow the presentation's budget. */
export type EvidenceState = Readonly<{
  ids: readonly string[];
  tracked: ReadonlyMap<string, EventData>;
  dependencies: ReadonlyMap<string, EventData>;
  root: EventData | undefined;
  live: ReadonlyMap<string, RelayEvent>;
}>;
type Scope = Readonly<{
  channelId: string;
  rootId?: string | undefined;
  limits: PresentationLimits;
}>;
const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const exceeds = (
  events: ReadonlyMap<string, EventData>,
  l: PresentationLimits,
) => events.size > l.events || listByteSize([...events.values()]) > l.bytes;

/** Canonical event set passed to `session.retain().set(...)` and `foldRows`. */
export function allEvidence(state: EvidenceState) {
  const all = new Map<string, EventData>(state.tracked);
  for (const [id, event] of state.dependencies)
    if (!all.has(id)) all.set(id, event);
  if (state.root && !all.has(state.root.id)) all.set(state.root.id, state.root);
  return all;
}

function collectDependencies(
  tracked: ReadonlyMap<string, EventData>,
  pool: ReadonlyMap<string, EventData>,
  rootId: string | undefined,
  initial?: ReadonlyMap<string, EventData>,
) {
  const dependencies = new Map(initial);
  let frontier = [...tracked.values()].filter((event) => AUX.has(event.kind));
  for (let hop = 0; hop < 2 && frontier.length; hop++) {
    const next: EventData[] = [];
    for (const event of frontier)
      for (const [name, targetId] of event.tags) {
        if (
          name !== "e" ||
          !targetId ||
          targetId === rootId ||
          tracked.has(targetId) ||
          dependencies.has(targetId)
        )
          continue;
        const target = pool.get(targetId);
        if (!target) continue;
        dependencies.set(targetId, target);
        if (AUX.has(target.kind)) next.push(target);
      }
    frontier = next;
  }
  return dependencies;
}

function inReaderScope(
  event: EventData,
  channelId: string,
  rootId: string | undefined,
) {
  if (
    !channelRowKind(event.kind) ||
    event.id === rootId ||
    !inChannel(event, channelId)
  )
    return false;
  const ref = threadReference(event);
  return rootId !== undefined
    ? ref?.rootId === rootId
    : !ref ||
        event.tags.some(
          ([name, value]) => name === "broadcast" && value === "1",
        );
}

/** Validate a presentation and build its pure evidence closure. */
export function selectEvidence(
  presentation: ConversationPresentation,
  priorLive: ReadonlyMap<string, RelayEvent>,
  { channelId, rootId, limits }: Scope,
) {
  if (!isObject(presentation)) return "invalid" as const;
  const { ids, events, parents, open, complete, place } = presentation;
  if (
    !Array.isArray(ids) ||
    !Array.isArray(events) ||
    ids.some((id) => typeof id !== "string") ||
    new Set(ids).size !== ids.length ||
    (parents !== undefined && !isObject(parents)) ||
    (open !== undefined && !Array.isArray(open)) ||
    (complete !== undefined && typeof complete !== "boolean") ||
    (place !== undefined &&
      place !== "keep" &&
      place !== "start" &&
      !(isObject(place) && typeof place.id === "string"))
  )
    return "invalid" as const;
  if (ids.length > limits.rows) return "limit" as const;
  const wanted = new Set(ids);
  const pool = new Map<string, EventData>();
  for (const event of [...events, ...priorLive.values()])
    if (AUX.has(event.kind) || inChannel(event, channelId))
      pool.set(event.id, event);
  const tracked = new Map<string, EventData>();
  for (const event of pool.values())
    if (
      wanted.has(event.id) &&
      event.id !== rootId &&
      !AUX.has(event.kind) &&
      event.kind !== 39007
    )
      tracked.set(event.id, event);
  growAux([...pool.values()], tracked);
  const evidence: EvidenceState = {
    ids: [...ids],
    tracked,
    dependencies: collectDependencies(tracked, pool, rootId),
    root: rootId ? pool.get(rootId) : undefined,
    live: new Map([...priorLive].filter(([id]) => tracked.has(id))),
  };
  const all = allEvidence(evidence);
  if (exceeds(all, limits)) return "limit" as const;
  return {
    evidence,
    all,
    parents: parents
      ? new Map(
          Object.entries(parents).filter(
            ([, parent]) => typeof parent === "string",
          ),
        )
      : undefined,
    open: [...(open ?? [])],
    complete: complete === true,
    place: place ?? "keep",
  };
}

/** Admit live events into an active presentation: verified echoes of named
 * pending rows, two-hop auxiliaries of tracked rows only (never `root`), their
 * multi-target dependencies, and completeness downgrade on new unpresented rows. */
export function applyLiveEvents(
  state: EvidenceState,
  complete: boolean,
  batch: readonly RelayEvent[],
  replay: boolean,
  { channelId, rootId, limits }: Scope,
) {
  const wanted = new Set(state.ids);
  const tracked = new Map(state.tracked);
  const live = new Map(state.live);
  let nextComplete = complete;
  let trackedChanged = false;
  for (const event of batch) {
    if (
      wanted.has(event.id) &&
      event.id !== rootId &&
      !tracked.has(event.id) &&
      !AUX.has(event.kind) &&
      event.kind !== 39007 &&
      inChannel(event, channelId)
    ) {
      tracked.set(event.id, event);
      live.set(event.id, event);
      trackedChanged = true;
    } else if (
      nextComplete &&
      !replay &&
      !wanted.has(event.id) &&
      inReaderScope(event, channelId, rootId)
    )
      nextComplete = false;
  }
  const addedAux = growAux(batch, tracked);
  for (const event of addedAux) live.set(event.id, event);
  const dependencies = addedAux.length
    ? collectDependencies(
        tracked,
        new Map(batch.map((event) => [event.id, event])),
        rootId,
        state.dependencies,
      )
    : state.dependencies;
  const refold =
    trackedChanged ||
    addedAux.length > 0 ||
    dependencies.size !== state.dependencies.size;
  if (!refold && nextComplete === complete) return { kind: "noop" as const };
  const evidence: EvidenceState = { ...state, tracked, dependencies, live };
  const all = allEvidence(evidence);
  if (refold && exceeds(all, limits)) return { kind: "exceeded" as const };
  return {
    kind: "updated" as const,
    evidence,
    all,
    complete: nextComplete,
    refold,
  };
}

/** Derived host-behavior switches for a reader while a presentation shows. */
export function readerMode(display: Display | undefined) {
  const presented = display !== undefined;
  return {
    presented,
    chronologicalChrome: !presented,
    hostNavigation: !presented,
    partialReading: presented && !display.complete,
  } as const;
}

type Hold = ReturnType<RelaySession["retain"]>;
type ActivePresentation = {
  readonly hold: Hold;
  evidence: EvidenceState;
  rows: readonly ChannelMessage[];
};

export type Arrangement = ReturnType<typeof createArrangement>;
export function createArrangement({
  session,
  channelId,
  rootId,
  limits,
}: Readonly<{
  session: RelaySession;
  channelId: string;
  rootId?: string | undefined;
  limits: PresentationLimits;
}>) {
  const scope: Scope = { channelId, rootId, limits };
  let phase: "live" | "leaving" | "retired" = "live";
  const lanes = new Map<ArrangementLane, "held" | "ended">();
  let shown: ArrangementLane | undefined;
  let active: ActivePresentation | undefined;
  let display: Display | undefined;
  let revision = 0;
  let stopWatching: (() => void) | undefined;
  let cancelFrame: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const emit = () => {
    for (const listener of [...listeners]) listener();
  };
  function fold(
    current: ActivePresentation,
    all = allEvidence(current.evidence),
  ) {
    const folded = new Map(
      session
        .foldRows(channelId, [...all.values()], rootId)
        .map((row) => [row.id, row]),
    );
    const rows = current.evidence.ids.flatMap((id) =>
      id === rootId ? [] : (folded.get(id) ?? []),
    );
    return shareMessageRows(current.rows, rows);
  }
  function watch() {
    if (stopWatching) return;
    const stops = [
      session.subscribeLive(onLive, { replay: true }),
      session.outbox?.subscribe(refold),
      session.profiles.subscribe(refold),
    ];
    stopWatching = () => {
      for (const stop of stops) stop?.();
    };
  }
  function release() {
    active?.hold.dispose();
    active = undefined;
    shown = undefined;
    display = undefined;
    stopWatching?.();
    stopWatching = undefined;
    cancelFrame?.();
    cancelFrame = undefined;
  }
  function show(lane: ArrangementLane, presentation: ConversationPresentation) {
    const picked = selectEvidence(
      presentation,
      active?.evidence.live ?? new Map(),
      scope,
    );
    if (typeof picked === "string") return picked;
    let hold = active?.hold;
    try {
      hold ??= session.retain();
      hold.set([...picked.all.values()]);
    } catch {
      if (!active) hold?.dispose();
      return "limit";
    }
    const next: ActivePresentation = {
      hold,
      evidence: picked.evidence,
      rows: active?.rows ?? [],
    };
    next.rows = fold(next, picked.all);
    active = next;
    cancelFrame?.();
    cancelFrame = undefined;
    shown = lane;
    revision += 1;
    display = Object.freeze({
      rows: next.rows,
      parents: picked.parents,
      open: picked.open,
      complete: picked.complete,
      place: picked.place,
      revision,
    });
    watch();
    return picked;
  }
  function free(ended?: ArrangementLane) {
    for (const [lane, state] of lanes) if (state === "held") lanes.delete(lane);
    if (ended) lanes.set(ended, "ended");
    release();
    emit();
  }
  const end = () => free(shown);
  function onLive({ events, replay }: LiveBatch) {
    const current = active;
    if (!current || !display) return;
    const result = applyLiveEvents(
      current.evidence,
      display.complete,
      events,
      replay === true,
      scope,
    );
    if (result.kind === "noop") return;
    if (result.kind === "exceeded") return end();
    if (result.refold) {
      try {
        current.hold.set([...result.all.values()]);
      } catch {
        return end();
      }
    }
    current.evidence = result.evidence;
    if (result.complete !== display.complete) {
      display = Object.freeze({ ...display, complete: result.complete });
      emit();
    }
    if (result.refold) refold();
  }
  function refold() {
    const current = active;
    if (!current || cancelFrame) return;
    const id = requestAnimationFrame(() => {
      cancelFrame = undefined;
      const rows = fold(current);
      if (current !== active || !display || rows === current.rows) return;
      current.rows = rows;
      display = Object.freeze({ ...display, rows });
      emit();
    });
    cancelFrame = () => cancelAnimationFrame(id);
  }
  return {
    limits,
    present(
      lane: ArrangementLane,
      presentation: ConversationPresentation | null,
    ) {
      if (phase === "retired") return "retired";
      if (presentation === null) {
        const had = lanes.delete(lane);
        if (shown === lane) free();
        else if (had) emit();
        return "shown";
      }
      const held = shown !== undefined && shown !== lane;
      const picked = held
        ? selectEvidence(
            presentation,
            active?.evidence.live ?? new Map(),
            scope,
          )
        : show(lane, presentation);
      if (typeof picked === "string") return picked;
      if (held) lanes.set(lane, "held");
      else lanes.delete(lane);
      emit();
      return held ? "held" : "shown";
    },
    withdraw() {
      if (shown) free();
    },
    status: (lane: ArrangementLane) =>
      shown === lane ? "shown" : (lanes.get(lane) ?? "none"),
    snapshot: () => display,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    attach() {
      if (phase === "leaving") phase = "live";
    },
    retire() {
      if (phase !== "live") return;
      phase = "leaving";
      queueMicrotask(() => {
        if (phase !== "leaving") return;
        phase = "retired";
        lanes.clear();
        release();
        emit();
      });
    },
  };
}

const noSubscription = () => () => {};
/** A reader's host and what it shows now. A thread's host exists once its root
 * does: until then no row could fold beside it. A channel's (`channel`) needs
 * no root. */
export function useArrangement(
  options: Readonly<{
    session: RelaySession;
    channelId: string;
    rootId: string | undefined;
    limits: PresentationLimits;
    channel?: boolean;
  }>,
) {
  const { session, channelId, rootId, limits, channel } = options;
  const arrangement = useMemo(
    () =>
      rootId || channel
        ? createArrangement({ session, channelId, rootId, limits })
        : undefined,
    [session, channelId, rootId, limits, channel],
  );
  useEffect(() => {
    arrangement?.attach();
    return () => arrangement?.retire();
  }, [arrangement]);
  const display = useSyncExternalStore(
    arrangement?.subscribe ?? noSubscription,
    () => arrangement?.snapshot(),
  );
  return [arrangement, display] as const;
}

/** Where a reader's view was: the row at its top, `top` px below the edge, among
 * the rows in view order. */
export type PlaceAnchor = Readonly<{
  id: string;
  top: number;
  order: readonly string[];
}>;
/** SM4, the one pending place for a reader: none (`undefined`), or one of
 * these, captured synchronously at commit and consumed once in the layout
 * effect. A new capture replaces it; a user scroll or key input cancels it. */
export type PlaceIntent =
  | Readonly<{ kind: "keep" } & PlaceAnchor>
  | Readonly<{ kind: "start" }>
  | Readonly<{ kind: "end" }>
  | Readonly<{ kind: "reveal"; id: string }>;
/** What to do: put row `id` `top` px below the edge, or go to an end. */
export type Placement = Readonly<{ id: string; top: number }> | "start" | "end";

/** The nearest row to the anchor that is still shown, preferring the row below on a tie. */
export function nearestShown(
  anchor: PlaceAnchor,
  shown: (id: string) => boolean,
) {
  const index = anchor.order.indexOf(anchor.id);
  if (index < 0) return undefined;
  for (let distance = 0; distance < anchor.order.length; distance++)
    for (const at of [index + distance, index - distance]) {
      const id = anchor.order[at];
      if (id !== undefined && shown(id)) return id;
    }
  return undefined;
}

/** The intent a presentation's `place` asks for, given where the view was. A
 * withdraw is `"keep"`. With no anchor there is nothing to keep: the start. */
export function placeIntent(
  place: Display["place"],
  anchor: PlaceAnchor | undefined,
): PlaceIntent {
  if (place === "start") return { kind: "start" };
  if (place === "keep")
    return anchor ? { kind: "keep", ...anchor } : { kind: "start" };
  return { kind: "reveal", id: place.id };
}

/** SM4's holder: `none -> intent -> placement -> none`. A capture replaces
 * whatever is held; `take` resolves the intent once into a placement that stays
 * until `done` (a row in a closed branch needs another commit); input cancels. */
export function createPlace() {
  let pending: PlaceIntent | undefined;
  let held: Placement | undefined;
  return {
    capture(intent: PlaceIntent) {
      pending = intent;
      held = undefined;
    },
    cancel() {
      pending = undefined;
      held = undefined;
    },
    take(shown: (id: string) => boolean, fallback: "start" | "end" = "start") {
      const intent = pending;
      pending = undefined;
      if (!intent) return held;
      if (intent.kind === "start" || intent.kind === "end") held = intent.kind;
      else if (intent.kind === "reveal")
        held = shown(intent.id) ? { id: intent.id, top: 0 } : undefined;
      else {
        const id = nearestShown(intent, shown);
        held = id === undefined ? fallback : { id, top: intent.top };
      }
      return held;
    },
    done() {
      held = undefined;
    },
  };
}

/** A reader's place keeper. The anchor is read from the rows being replaced:
 * `anchor` runs as the host announces a change, before the commit. A withdraw
 * with nothing in view follows the end, as an opening does. */
export function usePlace(
  arrangement: Arrangement | undefined,
  anchor: () => PlaceAnchor | undefined,
) {
  const place = useMemo(createPlace, []);
  const read = useEffectEvent(anchor);
  useLayoutEffect(() => {
    if (!arrangement) return;
    let seen: number | undefined;
    const capture = (at: PlaceAnchor | undefined) => {
      const next = arrangement.snapshot();
      if (next?.revision === seen) return;
      seen = next?.revision;
      place.capture(
        next || at ? placeIntent(next?.place ?? "keep", at) : { kind: "end" },
      );
    };
    capture(undefined);
    return arrangement.subscribe(() => capture(read()));
  }, [arrangement, place]);
  return place;
}
