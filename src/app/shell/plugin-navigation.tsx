import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type {
  AdminAccessReader,
  AdminAccessState,
} from "../../bundled/admin-access";
import { bundledIcons } from "../../bundled/icons";
import type { RegisteredPage } from "../../features/pages/service";
import { SquaresFourIcon } from "../../shared/design-system/icons/index";
import type { PluginManager } from "../../plugins/manager";
import {
  accessMessage,
  isRequiredPlugin,
  listedPlugin,
  pluginAccess,
  pluginToggleDisabled,
  RESTRICTED_PLUGINS,
  restrictedPlugin,
  togglePlugin,
} from "../plugin-rules";
import { AllPlugins } from "./AllPlugins";
import type { AllPluginsEntry } from "./all-plugins";
import { PageIcon } from "./PageIcon";
import { savePluginPins, useSavedPluginPins } from "./plugin-pins";
import {
  orderPages,
  pagePlacement,
  pagePresentation,
  resolvePluginPins,
} from "./presentation";

const noSubscription = () => () => {};

/** The Plugins card's pins and its All plugins row. Plugins switch on and off
 * through the same rules as Settings → Plugins. */
export function usePluginNavigation({
  plugins,
  adminAccess,
  pages,
  selected,
  onSelect,
}: {
  plugins: PluginManager;
  adminAccess?: AdminAccessReader | undefined;
  pages: readonly RegisteredPage[];
  selected: string;
  onSelect: (key: string) => void;
}) {
  const { configuration, busy } = useSyncExternalStore(
    plugins.subscribe,
    plugins.snapshot,
  );
  const catalog =
    configuration.status === "ready"
      ? configuration.catalog.plugins
      : undefined;
  const saved = useSavedPluginPins();
  // Access is checked only while a restricted plugin is off, since that is
  // the only time it decides anything here.
  const checksAccess = !!catalog?.some(
    (plugin) => !plugin.enabled && restrictedPlugin(plugin),
  );
  useEffect(
    () => (checksAccess ? adminAccess?.ensure() : undefined),
    [adminAccess, checksAccess],
  );
  const accessKey = useSyncExternalStore(
    adminAccess?.subscribe ?? noSubscription,
    () =>
      RESTRICTED_PLUGINS.map(
        (id) => adminAccess?.status(id) ?? "unavailable",
      ).join(" "),
  );
  const access = useMemo(() => {
    const states = accessKey.split(" ") as AdminAccessState[];
    return new Map<string, AdminAccessState | undefined>(
      RESTRICTED_PLUGINS.map((id, index) => [id, states[index]]),
    );
  }, [accessKey]);

  const sidebarPages = useMemo(
    () => orderPages(pages.filter((page) => pagePlacement(page) === "sidebar")),
    [pages],
  );
  const pins = useMemo(() => {
    const builtIn = catalog
      ? new Set(
          catalog
            .filter((plugin) => plugin.source === "bundled")
            .map((plugin) => plugin.manifest.id),
        )
      : undefined;
    return resolvePluginPins(
      saved,
      sidebarPages,
      builtIn && ((id) => builtIn.has(id)),
    );
  }, [catalog, saved, sidebarPages]);

  const entries = useMemo((): readonly AllPluginsEntry[] => {
    if (!catalog) return [];
    const pinned = new Map((pins ?? []).map((id, index) => [id, index]));
    return catalog
      .filter((plugin) => listedPlugin(plugin) && !isRequiredPlugin(plugin))
      .map((plugin) => {
        const id = plugin.manifest.id;
        const page = plugin.enabled
          ? sidebarPages.find((page) => page.pluginId === id)
          : undefined;
        const presentation = page && pagePresentation(page);
        const state = restrictedPlugin(plugin)
          ? (access.get(id) ?? "unavailable")
          : "allowed";
        // Settings retries from a plugin's details; this list has none.
        const reason = !restrictedPlugin(plugin)
          ? null
          : state === "error"
            ? "Couldn’t check access. Try again in Settings → Plugins."
            : accessMessage(plugin, state);
        return {
          key: id,
          label: presentation?.label ?? plugin.manifest.name,
          icon: (
            <PageIcon
              icon={presentation?.icon ?? SquaresFourIcon}
              image={
                presentation
                  ? presentation.image
                  : plugin.source === "bundled"
                    ? bundledIcons.get(id)
                    : undefined
              }
              size={16}
              strokeWidth={2.5}
            />
          ),
          enabled: plugin.enabled,
          pinned: pinned.has(id),
          pinnable: !!page,
          active: !!page && page.key === selected,
          toggle: {
            disabled: pluginToggleDisabled(plugin, state, busy),
            ...(reason ? { reason } : {}),
          },
        };
      })
      .sort(
        (a, b) =>
          (pinned.get(a.key) ?? Number.POSITIVE_INFINITY) -
          (pinned.get(b.key) ?? Number.POSITIVE_INFINITY),
      );
  }, [catalog, pins, sidebarPages, selected, busy, access]);

  const pin = useCallback(
    (id: string, on: boolean) => {
      const current = pins ?? [];
      savePluginPins(
        on
          ? [...current.filter((pinned) => pinned !== id), id]
          : current.filter((pinned) => pinned !== id),
      );
    },
    [pins],
  );
  const reorder = useCallback(
    (ids: readonly string[]) => {
      // The popover reorders the pins it shows; pins of plugins that are off
      // or not installed keep their places after them.
      const shown = new Set(ids);
      savePluginPins([...ids, ...(pins ?? []).filter((id) => !shown.has(id))]);
    },
    [pins],
  );
  const open = useCallback(
    (id: string) => {
      const page = sidebarPages.find((page) => page.pluginId === id);
      if (page) onSelect(page.key);
    },
    [sidebarPages, onSelect],
  );
  const toggle = useCallback(
    (id: string, on: boolean) => {
      const plugin = catalog?.find((plugin) => plugin.manifest.id === id);
      if (!plugin || plugin.enabled === on) return;
      togglePlugin(plugins, plugin, pluginAccess(plugin, adminAccess), busy);
    },
    [catalog, plugins, adminAccess, busy],
  );

  const allPlugins = useMemo(
    () =>
      catalog ? (
        <AllPlugins
          plugins={entries}
          onOpen={open}
          onEnabledChange={toggle}
          onPinnedChange={pin}
          onPinnedOrderChange={reorder}
        />
      ) : undefined,
    [catalog, entries, open, toggle, pin, reorder],
  );
  return { pins, allPlugins };
}
