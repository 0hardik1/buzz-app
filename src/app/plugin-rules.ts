import type {
  AdminAccessReader,
  AdminAccessState,
} from "../bundled/admin-access";
import performanceDiagnosticsManifest from "../bundled/performance-diagnostics/manifest.json";
import type { PluginManager } from "../plugins/manager";
import type { PluginInfo } from "../plugins/types";

// The rules for listing and switching plugins, shared by Settings → Plugins
// and the sidebar's All plugins popover so the two never disagree.

/** Channels is the app's sidebar; it has no enable/disable control. */
export function isRequiredPlugin(plugin: PluginInfo) {
  return plugin.manifest.id === "buzz.channels";
}

/** Plugins people choose to turn on. Diagnostics are offered through agent
 * requests instead. */
export function listedPlugin(plugin: PluginInfo) {
  return !(
    plugin.source === "bundled" &&
    plugin.manifest.id === performanceDiagnosticsManifest.id
  );
}

/** Bundled plugins that need community or relay access to turn on. */
export const RESTRICTED_PLUGINS = ["buzz.moderation", "buzz.relay-staff"];
export function restrictedPlugin(plugin: PluginInfo) {
  return (
    plugin.source === "bundled" &&
    RESTRICTED_PLUGINS.includes(plugin.manifest.id)
  );
}

export function accessMessage(plugin: PluginInfo, state: AdminAccessState) {
  switch (state) {
    case "allowed":
      return null;
    case "checking":
      return "Checking access…";
    case "no-community":
      return "Select a community to check access.";
    case "error":
      return "Could not check access. Open details to try again.";
    case "unavailable":
      return "Access is unavailable in this build or on this relay.";
    case "denied":
      return plugin.manifest.id === "buzz.moderation"
        ? "Select a community where you’re an owner or admin."
        : "Select a community on a relay where you have staff access.";
  }
}

export function pluginToggleDisabled(
  plugin: PluginInfo,
  access: AdminAccessState,
  busy: boolean,
) {
  return (
    busy ||
    (!plugin.enabled && restrictedPlugin(plugin) && access !== "allowed")
  );
}

/** The access a restricted plugin needs; others are always allowed. */
export function pluginAccess(
  plugin: PluginInfo,
  adminAccess: Pick<AdminAccessReader, "status"> | undefined,
): AdminAccessState {
  return restrictedPlugin(plugin)
    ? (adminAccess?.status(plugin.manifest.id) ?? "unavailable")
    : "allowed";
}

/** Turn a plugin on or off, unless the rules above block it. Returns whether
 * a change was requested. */
export function togglePlugin(
  plugins: Pick<PluginManager, "change">,
  plugin: PluginInfo,
  access: AdminAccessState,
  busy: boolean,
) {
  if (isRequiredPlugin(plugin) || pluginToggleDisabled(plugin, access, busy))
    return false;
  void plugins.change(
    plugin.enabled ? "disable" : "enable",
    plugin.manifest.id,
  );
  return true;
}
