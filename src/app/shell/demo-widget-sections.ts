import { readView, writeView } from "../../shared/view-state";
import {
  isDemoWidgetKind,
  type DemoWidgetKind,
} from "../../features/sidebar-widget-demos/kinds";

const key = "navigation-demo-widgets:v1";
const selections = (scope: string): Record<string, unknown> => {
  const value = readView<unknown>(scope, key, {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
};

/** Only the ordinary section shell syncs; its simulated widget stays device-local. */
export function demoWidgetKind(scope: string, section: string) {
  const kind = selections(scope)[section];
  return isDemoWidgetKind(kind) ? kind : undefined;
}

export function createDemoWidgetSection(
  scope: string,
  section: string,
  kind: DemoWidgetKind,
  create: () => boolean,
) {
  if (!isDemoWidgetKind(kind)) return false;
  const previous = selections(scope);
  if (!writeView(scope, key, { ...previous, [section]: kind })) return false;
  let saved = false;
  try {
    saved = create();
    return saved;
  } finally {
    if (!saved) writeView(scope, key, previous);
  }
}

export function forgetDemoWidgetSection(scope: string, section: string) {
  const current = selections(scope);
  if (Object.hasOwn(current, section))
    writeView(
      scope,
      key,
      Object.fromEntries(
        Object.entries(current).filter(([id]) => id !== section),
      ),
    );
}
