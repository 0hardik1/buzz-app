import type { PluginModule } from "../../plugins/api";
import { TasksPage } from "./TasksPage";
import { addTaskTools } from "./tools";

export const inject = ["pages", "relay", "agents", "artifactStorage"];

export const apply: PluginModule["apply"] = (ctx) => {
  ctx.pages.register({
    id: "tasks",
    title: "Tasks",
    layout: "workspace",
    primary: true,
    placement: "dock",
    component: () => (
      <TasksPage relay={ctx.relay} storage={ctx.artifactStorage} />
    ),
  });
  addTaskTools(ctx.agents);
};
