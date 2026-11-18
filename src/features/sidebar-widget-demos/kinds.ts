export const demoWidgetKinds = [
  "pr-tracker",
  "bestie",
  "calendar",
  "system-usage",
  "agent-usage",
  "sticky-note",
  "mini-kanban",
  "focus-aperture",
  "golden-hour",
  "build-departures",
  "snippet-shelf",
  "decision-desk",
  "context-capsule",
  "meeting-runway",
  "read-later",
  "signal-tuner",
  "tiny-wins",
] as const;

export type DemoWidgetKind = (typeof demoWidgetKinds)[number];

export function isDemoWidgetKind(id: unknown): id is DemoWidgetKind {
  return demoWidgetKinds.some((kind) => kind === id);
}
