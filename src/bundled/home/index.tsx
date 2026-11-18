import type { PluginModule } from "../../plugins/api";
import { HomeCanvas } from "./HomeCanvas";
import { validHomeRoute } from "./route";

export const inject = [
  "pages",
  "relay",
  "navigation",
  "conversation",
  "panels",
];
export const apply: PluginModule["apply"] = (ctx) => {
  ctx.pages.register({
    id: "home",
    title: "Home",
    layout: "workspace",
    primary: true,
    placement: "dock",
    route: { version: 1, validate: validHomeRoute },
    component: ({ navigation }) => (
      <HomeCanvas
        relay={ctx.relay}
        host={ctx}
        extensions={ctx.conversation}
        navigation={navigation}
      />
    ),
  });
};
