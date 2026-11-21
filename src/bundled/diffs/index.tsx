import type { Context } from "@deepseek-ai/cordis";
import { DiffMessage, diffTargetMessage } from "./DiffMessage";
import { DiffPanel } from "./DiffPanel";

export const inject = ["conversation", "panels", "relay"];
export function apply(ctx: Context) {
  const panels = ctx.panels;
  const relay = ctx.relay;
  ctx.conversation.registerMessage({
    id: "diff",
    title: "Code diff",
    matches: (message) => !!message.diff,
    component: (props) => <DiffMessage {...props} panels={panels} />,
  });
  // Expanded diffs read here, as ordinary panels: over the composer they are
  // answered from, or in a tab that outlives a channel switch.
  ctx.panels.register({
    id: "diff",
    title: "Code diff",
    matches: (target) => !!diffTargetMessage(target),
    addressable: true,
    keepOpen: true,
    // Its layout choice stays while another tab is selected.
    deferUntilShown: true,
    component: (props) => <DiffPanel {...props} relay={relay} />,
  });
}
