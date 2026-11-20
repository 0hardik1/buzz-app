export type SidebarSortMode = "alpha" | "recent" | `plugin:${string}`;

export function isSidebarSortMode(value: unknown): value is SidebarSortMode {
  return (
    value === "alpha" ||
    value === "recent" ||
    (typeof value === "string" &&
      value.length <= 512 &&
      /^plugin:[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/.test(
        value,
      ))
  );
}

/** Sidebar-placed pages, such as Activity, ordered among the sections. */
export const SIDEBAR_PAGES_SECTION = "pages";

/** Cards list newest first; the Plugins card stays A–Z. Saved preferences
 * store the default as absence, so explicit choices stick. */
export function defaultSidebarSort(group: string): SidebarSortMode {
  return group === SIDEBAR_PAGES_SECTION ? "alpha" : "recent";
}

export function sidebarSortNeedsActivity(mode: SidebarSortMode): boolean {
  return mode === "recent" || mode.startsWith("plugin:");
}
