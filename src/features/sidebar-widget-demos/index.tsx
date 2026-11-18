import type { CardDefinition } from "./card-types";
import { agentUsage } from "./cards/agent-usage";
import { bestie } from "./cards/bestie";
import { miniCalendar } from "./cards/calendar";
import { freshIdeas } from "./cards/fresh-ideas";
import { miniKanban } from "./cards/kanban";
import { prTracker } from "./cards/pr-tracker";
import { stickyNote } from "./cards/sticky-note";
import { systemUsage } from "./cards/system-usage";
import { type FrameValues, WidgetFrame } from "./frame";
import type { DemoWidgetKind } from "./kinds";

export {
  demoWidgetKinds,
  type DemoWidgetKind,
  isDemoWidgetKind,
} from "./kinds";

export const demoWidgets: readonly CardDefinition[] = [
  prTracker,
  bestie,
  miniCalendar,
  systemUsage,
  agentUsage,
  stickyNote,
  miniKanban,
  ...freshIdeas,
];

const previewFrame: FrameValues = { inset: 12, radius: 16, gap: 8 };

export function getDemoWidget(id: string): CardDefinition | undefined {
  return demoWidgets.find((card) => card.id === id);
}

export function DemoWidgetBody({ kind }: { kind: DemoWidgetKind }) {
  const Component = getDemoWidget(kind)?.component;
  return Component ? <Component variant="visual" /> : null;
}

export function DemoWidgetPreview({
  kind,
  title,
}: {
  kind: DemoWidgetKind;
  title?: string;
}) {
  const card = getDemoWidget(kind);
  if (!card) return null;

  return (
    <WidgetFrame kind={kind} title={title ?? card.title} values={previewFrame}>
      <DemoWidgetBody kind={kind} />
    </WidgetFrame>
  );
}
