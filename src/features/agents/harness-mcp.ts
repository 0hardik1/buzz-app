import type { Context } from "@deepseek-ai/cordis";
import type { AgentKey } from "./membership";
import type { Agent, AgentHandle, RegisteredAgentType } from "./service";

/** One server's override. `false`: off. `true`: on. An object: on without
 * the `off` tools. `known` is every tool the control knows the server has,
 * for a harness that can only name the tools it allows. */
export type HarnessMcpServerChoice =
  | boolean
  | Readonly<{ off: readonly string[]; known: readonly string[] }>;
/** Overrides for one agent. A name it leaves out keeps the harness's default. */
export type HarnessMcpChoice = Readonly<Record<string, HarnessMcpServerChoice>>;
export type HarnessMcpTool = Readonly<{
  name: string;
  description?: string;
}>;
export type HarnessMcpServer = Readonly<{
  name: string;
  /** Whether this agent's sessions load it when no control chooses. */
  default: boolean;
  /** "disabled": turned off in the harness's own configuration. */
  state?: "connected" | "failed" | "needs-auth" | "disabled";
  /** Why the harness can't load it, in the harness's own words. */
  reason?: string;
}>;
export type HarnessMcpReport = Readonly<{
  /** Whether a choice may leave out single tools. */
  tools: boolean;
  /** Whether `inspectHarnessMcp` can list a server's tools. */
  inspect: boolean;
  /** Agent hooks see native MCP calls before they run, so a plugin can stop one. */
  calls?: true;
  servers: readonly HarnessMcpServer[];
}>;
/** What a harness lists as loaded in a session. */
export type HarnessMcpLoaded = readonly Readonly<{
  name: string;
  state?: "connected" | "failed" | "needs-auth";
  tools?: readonly HarnessMcpTool[];
}>[];
export type HarnessMcpControl = Readonly<{
  choose(agent: Agent): HarnessMcpChoice | undefined;
  /** What a session of `agent` loaded, once it passed the check. Core keeps
   * none of it. */
  loaded?(agent: Agent, servers: HarnessMcpLoaded): void;
}>;

type Who = Pick<AgentHandle, "key" | "protection">;
function names(value: unknown) {
  return Array.isArray(value) && value.every((tool) => typeof tool === "string")
    ? Object.freeze([...value])
    : undefined;
}
function normalize(raw: unknown) {
  if (raw === undefined) return {};
  if (Object.prototype.toString.call(raw) !== "[object Object]") return "none";
  const choice: Record<string, HarnessMcpServerChoice> = Object.create(null);
  for (const [name, value] of Object.entries(raw as object)) {
    if (typeof value === "boolean") {
      choice[name] = value;
      continue;
    }
    const off = names((value as { off?: unknown } | null)?.off);
    const known = names((value as { known?: unknown } | null)?.known);
    choice[name] = off && known ? Object.freeze({ off, known }) : false;
  }
  return Object.freeze(choice);
}
/** undefined: the harness keeps its default. "none": no native server. */
export type HarnessMcpAnswer = HarnessMcpChoice | "none" | undefined;
/** For adapters, bundled or not, through the harness kit. */
export type HarnessMcpKit = Readonly<{
  choice(agent: Who): Promise<HarnessMcpAnswer>;
  /** After start and before the first prompt, with what the harness lists as
   * loaded and the answer `choice` gave this session. Throws when the choice
   * is not in effect: stop the session. */
  started(
    agent: Who,
    session: string,
    loaded: HarnessMcpLoaded,
    choice: HarnessMcpAnswer,
  ): void;
}>;

type Control = "absent" | "waiting" | "down" | "controlled";

export function createHarnessMcp(
  status: () => Context["pluginStatus"],
  running: (key: AgentKey) => Agent | undefined,
  types: () => readonly Pick<
    RegisteredAgentType,
    "key" | "pluginId" | "harnessMcp"
  >[],
) {
  let control:
    | Readonly<{ value: HarnessMcpControl; id: string; revision: string }>
    | undefined;
  const state = () =>
    (control && status().isActive(control.id, control.revision)
      ? "controlled"
      : !status().unavailable?.("agentMcp")
        ? "absent"
        : (status().settled?.() ?? true)
          ? "down"
          : "waiting") satisfies Control;
  const settle = () =>
    new Promise<void>((resolve) => {
      const finish = () => {
        off();
        clearTimeout(timer);
        resolve();
      };
      const done = () => {
        if (state() !== "waiting") finish();
      };
      const off = status().subscribe(done);
      const timer = setTimeout(finish, 30_000);
      done();
    });
  async function answer(agent: Agent) {
    if (agent.protection) return "none";
    if (state() === "waiting") await settle();
    switch (state()) {
      case "absent":
        return undefined;
      case "controlled": {
        try {
          return control ? normalize(control.value.choose(agent)) : "none";
        } catch {
          return "none";
        }
      }
      default:
        return "none";
    }
  }
  const typeOf = (agent: Pick<Agent, "type">) =>
    types().find((type) => type.key === agent.type);
  const declared = (ctx: Context) => {
    const owner = ctx.pluginOwner;
    if (!owner?.agentMcp) throw new Error("Declare host.agentMcp access");
    return owner;
  };
  function reporter(key: AgentKey) {
    const agent = running(key);
    const mcp = agent && typeOf(agent)?.harnessMcp;
    return agent && mcp && "report" in mcp ? { agent, mcp } : undefined;
  }

  function owned(ctx: Context, key: AgentKey) {
    const agent = running(key);
    const type = agent && typeOf(agent);
    if (!agent || !type) throw new Error("This agent is not running here");
    if (type.pluginId !== ctx.pluginOwner?.id)
      throw new Error(
        "Only the plugin that runs this agent's harness uses its MCP kit",
      );
    return agent;
  }

  const kitFor = (ctx: Context) =>
    Object.freeze({
      async choice(who) {
        return answer(owned(ctx, who.key));
      },
      started(who, session, loaded, given) {
        started(owned(ctx, who.key), session, loaded, given);
      },
    } satisfies HarnessMcpKit);

  function started(
    agent: Agent,
    session: string,
    loaded: HarnessMcpLoaded,
    given: HarnessMcpAnswer,
  ) {
    const choice = agent.protection ? "none" : given;
    const extra = choice
      ? loaded.filter(({ name, tools }) => {
          const picked =
            choice === "none"
              ? false
              : Object.hasOwn(choice, name)
                ? choice[name]
                : undefined;
          return (
            picked === false ||
            (typeof picked === "object" &&
              tools?.some((tool) => picked.off.includes(tool.name)))
          );
        })
      : [];
    if (extra.length)
      throw new Error(
        `Session ${session} loaded MCP servers that were turned off: ${extra.map(({ name }) => name).join(", ")}`,
      );
    if (!agent.protection) tell(agent, loaded);
  }
  function tell(agent: Agent, loaded: HarnessMcpLoaded) {
    const entry = control;
    if (!entry?.value.loaded) return;
    void Promise.resolve()
      .then(() => {
        if (control === entry && state() === "controlled")
          return entry.value.loaded?.(agent, loaded);
      })
      .catch(() => undefined);
  }

  return {
    kitFor,
    control(ctx: Context, next: HarnessMcpControl) {
      const owner = declared(ctx);
      if (control)
        throw new Error("A harness MCP control is already registered");
      const entry = Object.freeze({
        value: next,
        id: owner.id,
        revision: owner.revision,
      });
      ctx.effect(() => {
        control = entry;
        return () => {
          if (control === entry) control = undefined;
        };
      });
    },
    async report(ctx: Context, key: AgentKey) {
      declared(ctx);
      const found = reporter(key);
      const report = found && (await found.mcp.report(found.agent));
      if (!found || !report) return undefined;
      const { calls, ...rest } = report;
      return {
        ...rest,
        ...(calls === true && !found.agent.protection && { calls }),
        inspect: !!found.mcp.inspect,
      } satisfies HarnessMcpReport;
    },
    async inspect(ctx: Context, key: AgentKey, server: string) {
      const owner = declared(ctx);
      const found = reporter(key);
      if (!found?.mcp.inspect)
        throw new Error("This agent cannot list MCP tools");
      if (found.agent.protection)
        throw new Error("A protected agent loads no MCP server");
      if (!status().isActive(owner.id, owner.revision))
        throw new Error("The plugin that asked is not running");
      return found.mcp.inspect(found.agent, server);
    },
  };
}
