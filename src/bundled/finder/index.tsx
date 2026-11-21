import { lazy, Suspense, useRef, useSyncExternalStore } from "react";
import type { PluginModule } from "../../plugins/api";
import type { RelaySession } from "../../features/relay/session";
import { relayPartition } from "../../features/relay/partition";
import { activeModal } from "../../shared/design-system/overlayLayer";
import { createCorpus } from "./corpus.ts";
import { noteInterest, topInterest } from "./interest";
import { type FinderOpenOptions, provideFinder } from "./service";
import { builtinSources } from "./sources";
import type { FinderScope } from "./FinderDialog";
import {
  type FinderSync,
  type FinderSyncStatus,
  startFinderSync,
} from "./sync";

// Loaded on first open, so the plugin list doesn't pull the dialog and its
// styles into every page that imports it.
const FinderDialog = lazy(() =>
  import("./FinderDialog").then((m) => ({ default: m.FinderDialog })),
);

export const inject = ["pages", "relay", "navigation", "shortcuts"];

type State = Readonly<{
  open: boolean;
  revision: number;
  session?: RelaySession | undefined;
  status?: FinderSyncStatus | undefined;
  sync?: FinderSync | undefined;
  scope: FinderScope;
  openCount: number;
  /** The key of an open source other than the two scopes. */
  source?: string | undefined;
  initialQuery?: string | undefined;
}>;

export const apply: PluginModule["apply"] = (ctx) => {
  const relay = ctx.relay;
  const corpus = createCorpus();
  const listeners = new Set<() => void>();
  let state: State = {
    open: false,
    revision: 0,
    scope: "buzz",
    openCount: 0,
  };
  const set = (patch: Partial<State>) => {
    state = { ...state, ...patch };
    for (const listener of listeners) listener();
  };
  const store = {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    snapshot: () => state,
  };

  // Interest in the conversation on screen: 1 per visit, and more when you
  // search in it or open a message from Finder.
  const interested = (weight: number) => {
    const { entry } = ctx.navigation.snapshot();
    if (entry.target.kind !== "conversation") return;
    const { viewer, communityOrigin } = entry.target.scope;
    noteInterest(
      relayPartition(communityOrigin, viewer),
      entry.target.channelId,
      weight,
    );
  };
  const inConversation = () =>
    ctx.navigation.snapshot().entry.target.kind === "conversation";
  /** Opens Finder, or switches scope while it's open, keeping the text. */
  const show = (
    scope: FinderScope,
    { source, query }: { source?: string; query?: string } = {},
  ) => {
    if (scope === "channel" && !source) interested(2);
    set({
      open: true,
      scope,
      source,
      // Text from the caller starts a fresh opening even while open.
      ...((!state.open || query !== undefined) && {
        openCount: state.openCount + 1,
        initialQuery: query,
      }),
    });
  };
  const here = (): FinderScope => (inConversation() ? "channel" : "buzz");
  const sources = provideFinder(ctx, ({ source, query }: FinderOpenOptions) => {
    const options = query === undefined ? {} : { query };
    if (!source) return show(here(), options);
    if (source === "buzz.finder/channel") return show(here(), options);
    if (source === "buzz.finder/all") return show("buzz", options);
    if (!sources.snapshot().some((entry) => entry.key === source))
      return show("buzz", options);
    show("buzz", { ...options, source });
  });
  /** Opens a conversation in the connected community, optionally with a
   * detail (such as a profile) beside it. */
  const openConversation = (
    channelId: string,
    extra: { messageId?: string; threadRootId?: string; detail?: string } = {},
  ) => {
    const { viewer, scope } = relay.snapshot();
    if (!viewer || !scope?.endsWith(`:${viewer}`)) return;
    void ctx.navigation.open({
      version: 1,
      kind: "conversation",
      scope: { viewer, communityOrigin: scope.slice(0, -(viewer.length + 1)) },
      channelId,
      ...(extra.messageId && { messageId: extra.messageId }),
      ...(extra.threadRootId && { threadRootId: extra.threadRootId }),
      ...(extra.detail && { detail: { target: extra.detail } }),
    });
  };
  for (const source of builtinSources({
    session: () => state.session,
    current: () => {
      const { target } = ctx.navigation.snapshot().entry;
      return target.kind === "conversation" ? target.channelId : undefined;
    },
    open: (channelId, detail) =>
      openConversation(channelId, detail ? { detail } : {}),
  }))
    sources.register(ctx, source);
  ctx.effect(() => {
    let visit: string | undefined;
    const visited = () => {
      const { entry } = ctx.navigation.snapshot();
      if (entry.id === visit) return;
      visit = entry.id;
      interested(1);
    };
    visited();
    return ctx.navigation.subscribe(visited);
  });

  // One index per connected session: a new community, account, reconnect
  // generation or Clear cache starts over, and the old one is dropped.
  ctx.effect(() => {
    let current: { key: string; dispose(): void } | undefined;
    const sync = () => {
      const snapshot = relay.snapshot();
      const key =
        snapshot.status === "ready" && !snapshot.cached
          ? `${snapshot.scope}:${snapshot.generation}`
          : "";
      if (key === current?.key) return;
      current?.dispose();
      current = undefined;
      if (!key)
        return set({
          session: undefined,
          status: undefined,
          sync: undefined,
          revision: state.revision + 1,
        });
      const running = startFinderSync({
        session: snapshot.session,
        corpus,
        changed: () =>
          set({ revision: state.revision + 1, status: running.status() }),
        warm: () => (snapshot.scope ? topInterest(snapshot.scope, 24) : []),
      });
      current = { key, dispose: running.dispose };
      set({
        session: snapshot.session,
        status: running.status(),
        sync: running,
        revision: state.revision + 1,
      });
    };
    const stop = relay.subscribe(sync);
    sync();
    return () => {
      stop();
      current?.dispose();
    };
  });

  // Both work while Finder is open, so either key switches scope there.
  const available = () => state.open || !activeModal(document);
  ctx.shortcuts.register({
    id: "open",
    title: "Find in this channel",
    binding: { key: "p", mod: true },
    order: 10,
    allowInEditable: true,
    allowInModal: true,
    when: available,
    run: () => show(here()),
  });

  // Not while typing: the composer keeps ⌘⇧P for Spoiler.
  ctx.shortcuts.register({
    id: "all",
    title: "Find in all of Buzz",
    binding: { key: "p", mod: true, shift: true },
    order: 11,
    allowInModal: true,
    when: available,
    run: () => show("buzz"),
  });

  ctx.pages.registerOverlay({
    id: "finder",
    component: function Finder() {
      const {
        open,
        revision,
        session,
        status,
        sync,
        scope,
        openCount,
        source,
        initialQuery,
      } = useSyncExternalStore(store.subscribe, store.snapshot);
      const registered = useSyncExternalStore(
        sources.subscribe,
        sources.snapshot,
      );
      const target = useSyncExternalStore(
        ctx.navigation.subscribe,
        ctx.navigation.snapshot,
      ).entry.target;
      const currentChannelId =
        target.kind === "conversation" ? target.channelId : undefined;
      const opened = useRef(false);
      if (open) opened.current = true;
      if (!opened.current) return null;
      const count = corpus.size.toLocaleString();
      return (
        <Suspense fallback={null}>
          <FinderDialog
            open={open}
            onOpenChange={(next) => set({ open: next })}
            corpus={corpus}
            revision={revision}
            session={session}
            sync={sync}
            currentChannelId={currentChannelId}
            scope={scope === "channel" && !currentChannelId ? "buzz" : scope}
            onScopeChange={show}
            openCount={openCount}
            initialQuery={initialQuery}
            source={registered.find((entry) => entry.key === source)}
            onSourceClose={() => set({ source: undefined, scope: "buzz" })}
            status={
              !session ? (
                <p className="px-3 text-body-sm text-subtle">
                  Connect to a community to search your conversations.
                </p>
              ) : status?.phase === "error" ? (
                <p className="px-3 text-body-sm text-subtle" role="alert">
                  Indexing stopped: {status.error}. {count} messages searchable.
                </p>
              ) : status?.phase !== "ready" ? (
                <p className="px-3 text-body-sm text-subtle" aria-live="polite">
                  Indexing your last 90 days… {count} messages so far.
                </p>
              ) : (
                <p className="px-3 text-body-sm text-subtle">
                  {count} messages indexed. Channels you open add theirs.
                </p>
              )
            }
            openMessage={(doc) => {
              const { viewer, scope } = relay.snapshot();
              // The visit adds 1; finding it here is worth more.
              if (viewer && scope?.endsWith(`:${viewer}`))
                noteInterest(scope, doc.channelId, 2);
              openConversation(doc.channelId, {
                messageId: doc.id,
                ...(doc.threadRootId && { threadRootId: doc.threadRootId }),
              });
            }}
          />
        </Suspense>
      );
    },
  });
};
