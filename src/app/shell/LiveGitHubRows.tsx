import { useMemo, useSyncExternalStore } from "react";
import type { SidebarSections } from "../../features/channel-navigation/sidebar-sections-service";
import type { NavigationScope } from "../../features/navigation/targets";
import { OwnedContribution } from "../../plugins/OwnedContribution";
import { useDebounced } from "../../shared/search-debounce";

const none = () => [] as const;
const noSubscribe = () => () => {};

/** Reuse the source contribution boundary; only GitHub's bundled reader owns
 * GitHub search. The rail supplies its saved query as presentation data. */
export function LiveGitHubRows({
  registry,
  scope,
  query,
  expanded = false,
  enabled = true,
  editing = false,
}: {
  registry: SidebarSections | undefined;
  scope: NavigationScope;
  query: string;
  expanded?: boolean;
  enabled?: boolean;
  editing?: boolean;
}) {
  const settled = useDebounced(query);
  const search = editing ? settled : query;
  const sources = useSyncExternalStore(
    registry?.sourceSubscribe ?? noSubscribe,
    registry?.sourceSnapshot ?? none,
  );
  const owner = sources.find(
    (source) =>
      source.pluginId === "buzz.github" &&
      source.context === "rail-live-github",
  );
  const sourceRegistry = useMemo(
    () => ({ snapshot: registry?.sourceSnapshot ?? none }),
    [registry],
  );
  if (!enabled) return null;
  if (editing && (query !== settled || search.trim().length < 2))
    return (
      <p role="status" className="text-caption text-secondary">
        Updating preview…
      </p>
    );
  if (!owner)
    return (
      <p className="text-caption text-secondary">
        Enable the GitHub plugin to see these pull requests.
      </p>
    );
  return (
    <OwnedContribution entry={owner} registry={sourceRegistry}>
      {({ component: Component }, active) => (
        <Component
          active={active}
          target={{
            version: 1,
            kind: "plugin",
            pluginId: "buzz.github",
            scope,
            params: { query: search, expanded: String(expanded) },
          }}
          render={(sections) =>
            sections.map((section) => (
              <div key={section.id}>{section.element}</div>
            ))
          }
        />
      )}
    </OwnedContribution>
  );
}
