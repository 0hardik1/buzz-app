import type {
  JsonValue,
  NavigationScope,
  OpenTarget,
} from "../navigation/targets";

export function isSidebarSectionRoute(
  value: JsonValue | undefined,
): value is { kind: "sidebar-section"; section: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const params = value as { readonly [key: string]: JsonValue };
  return (
    params.kind === "sidebar-section" &&
    typeof params.section === "string" &&
    params.section.length > 0 &&
    params.section.length <= 256 &&
    Object.keys(params).every((key) => key === "kind" || key === "section")
  );
}

export function sidebarSectionTarget(
  scope: NavigationScope,
  section: string,
): OpenTarget {
  return {
    version: 1,
    kind: "page",
    pluginId: "buzz.channels",
    pageId: "channels",
    scope,
    route: { version: 1, params: { kind: "sidebar-section", section } },
  };
}

/** Preserve saved collection addresses using the rail sheet presentation. */
export function routedSidebarSection(target: OpenTarget): string | undefined {
  if (target.kind !== "page") return;
  if (target.pluginId === "buzz.inbox" && target.pageId === "inbox")
    return "team";
  if (target.pluginId !== "buzz.channels" || target.pageId !== "channels")
    return;
  if (!target.route) return "team";
  const params = target.route.params;
  if (isSidebarSectionRoute(params))
    return params.section === "messages" ? "team" : params.section;
}
