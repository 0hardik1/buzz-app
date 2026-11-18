import { useMemo, useSyncExternalStore } from "react";
import type { Context } from "@deepseek-ai/cordis";
import type { GitHubCli } from "./gh";
import type { SidebarSectionEnvironment } from "../../features/channel-navigation/sidebar-section-components";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { Button } from "../../shared/design-system/ui/Button";
import { GitPullRequestIcon } from "../../shared/design-system/icons";

type Pull = {
  title: string;
  url: string;
  number: number;
  repository: { nameWithOwner: string };
};
type Snapshot = {
  pulls: readonly Pull[];
  pending: boolean;
  error?: string | undefined;
  more?: boolean;
};
const QUERY = `query SidebarPulls($query: String!) {
  search(query: $query, type: ISSUE, first: 50) {
    pageInfo { hasNextPage }
    nodes { ... on PullRequest { title url number repository { nameWithOwner } } }
  }
}`;

/** One read per visible query, even when its card and expanded list coexist.
 * Refresh only while observed and visible. Stopping retires in-flight results. */
export function createLivePullSearch(gh: GitHubCli | undefined) {
  const queries = new Map<string, ReturnType<typeof make>>();
  function make(query: string) {
    let snapshot: Snapshot = { pulls: [], pending: true };
    const listeners = new Set<() => void>();
    let request: AbortController | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const publish = (next: Snapshot) => {
      snapshot = next;
      for (const notify of listeners) notify();
    };
    const pause = () => {
      clearTimeout(timer);
      request?.abort();
      request = undefined;
    };
    const refresh = async () => {
      pause();
      if (!listeners.size || document.hidden) return;
      const controller = new AbortController();
      request = controller;
      publish({ ...snapshot, pending: true, error: undefined });
      try {
        if (!gh)
          throw new Error(
            "GitHub search needs the desktop app and gh sign-in.",
          );
        const result = await gh<{
          search: {
            nodes: (Pull | Record<string, never>)[];
            pageInfo: { hasNextPage: boolean };
          };
        }>(
          QUERY,
          { query: `is:pr ${query} sort:updated-desc` },
          controller.signal,
        );
        if (controller.signal.aborted) return;
        const pulls = result.search.nodes.filter(
          (pull): pull is Pull =>
            typeof pull?.title === "string" &&
            typeof pull.url === "string" &&
            /^https:\/\/github\.com\/[^/]+\/[^/]+\/pull\/\d+$/.test(pull.url) &&
            typeof pull.repository?.nameWithOwner === "string",
        );
        publish({
          pulls,
          pending: false,
          more: result.search.pageInfo.hasNextPage,
        });
      } catch (error) {
        if (controller.signal.aborted) return;
        publish({
          ...snapshot,
          pending: false,
          error:
            error instanceof Error
              ? error.message
              : "Couldn’t search GitHub. Try again.",
        });
      } finally {
        if (!controller.signal.aborted && listeners.size)
          timer = setTimeout(() => void refresh(), 60_000);
      }
    };
    const visibility = () => (document.hidden ? pause() : void refresh());
    const store = {
      snapshot: () => snapshot,
      refresh: () => void refresh(),
      subscribe(notify: () => void) {
        listeners.add(notify);
        if (listeners.size === 1) {
          queries.set(query, store);
          document.addEventListener("visibilitychange", visibility);
          void refresh();
        }
        return () => {
          listeners.delete(notify);
          if (!listeners.size) {
            pause();
            document.removeEventListener("visibilitychange", visibility);
            if (queries.get(query) === store) queries.delete(query);
          }
        };
      },
      dispose() {
        pause();
        document.removeEventListener("visibilitychange", visibility);
      },
    };
    return store;
  }
  return {
    for(query: string) {
      let store = queries.get(query);
      if (!store) {
        store = make(query);
        queries.set(query, store);
      }
      return store;
    },
    dispose() {
      for (const store of queries.values()) store.dispose();
      queries.clear();
    },
  };
}

/** The shell supplies the card, title and scrolling. GitHub owns reads and its
 * existing object panel; no new host access or navigation target is needed. */
export function registerLivePullSections(
  ctx: Context,
  gh: GitHubCli | undefined,
) {
  const searches = createLivePullSearch(gh);
  ctx.effect(() => () => searches.dispose());
  ctx.inject(["sidebarSections"], (scope) => {
    scope.sidebarSections?.registerSource?.({
      version: 2,
      id: "live-pulls",
      context: "rail-live-github",
      component: function LivePullSource({ target, active, render }) {
        const query =
          target.kind === "plugin" ? target.params?.query : undefined;
        return render(
          query
            ? [
                {
                  id: "pulls",
                  defaultPosition: 0,
                  element: (
                    <LivePullRows
                      key={query}
                      query={query}
                      expanded={
                        target.kind === "plugin" &&
                        target.params?.expanded === "true"
                      }
                      active={active}
                    />
                  ),
                },
              ]
            : [],
        );
      },
    });
  });
  function LivePullRows({
    query,
    expanded,
    active,
  }: {
    query: string;
    expanded: boolean;
    active: SidebarSectionEnvironment["active"];
  }) {
    const store = useMemo(() => searches.for(query), [query]);
    const state = useSyncExternalStore(store.subscribe, store.snapshot);
    return (
      <>
        {state.pulls.slice(0, expanded ? 50 : 4).map((pull) => (
          <NavigationItem
            key={pull.url}
            icon={<GitPullRequestIcon size={18} />}
            label={pull.title}
            aria-label={`${pull.title}, ${pull.repository.nameWithOwner} #${pull.number}`}
            nativeButton={false}
            role="link"
            render={<a href={pull.url} target="_blank" rel="noreferrer" />}
            onClick={(event) => {
              if (!active()) event.preventDefault();
            }}
          />
        ))}
        {state.pending && !state.pulls.length && (
          <p role="status" className="text-caption text-secondary">
            Searching GitHub…
          </p>
        )}
        {!state.pending && !state.error && !state.pulls.length && (
          <p className="text-caption text-secondary">
            No matching pull requests yet.
          </p>
        )}
        {state.error && (
          <div role="alert">
            <p className="text-caption text-secondary">{state.error}</p>
            <Button size="sm" onClick={store.refresh}>
              Retry GitHub search
            </Button>
          </div>
        )}
        {expanded && state.more && (
          <p className="text-caption text-secondary">
            Showing the latest 50 matches.
          </p>
        )}
      </>
    );
  }
}
