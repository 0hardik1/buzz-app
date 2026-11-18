import type {
  HarnessMcpAnswer,
  HarnessMcpKit,
  HarnessMcpChoice,
  HarnessMcpLoaded,
  HarnessMcpServer,
  HarnessMcpTool,
} from "../../features/agents/harness-mcp";
import type { AgentHandle } from "../../features/agents/service";
import {
  type AcpProcess,
  REQUEST_TIMEOUT_MS,
} from "../../features/agent-harness/acp/process";
import { abortable } from "../../features/agent-harness/acp/agent-sessions";
import type { AcpHooks } from "../../features/agent-harness/acp/types";

type Who = Pick<AgentHandle, "key" | "protection">;
type Extension = {
  type: "mcp";
  server: { name: string };
  available_tools?: readonly string[];
};
type Configured = {
  name: string;
  key: string;
  enabled: boolean;
  extension: Extension;
  unavailable?: string;
};
const request = (
  p: AcpProcess,
  method: string,
  params: Record<string, unknown> = {},
  timeout: number | null = REQUEST_TIMEOUT_MS,
) => p.request(`_goose/unstable/${method}`, params, timeout ?? undefined);
const INSPECTION_CLEANUP_MS = 5_000;
const mcp = (e: { extension?: Extension }) =>
  e.extension?.type === "mcp" && e.extension.server?.name !== "buzz";

export class GooseMcp {
  constructor(
    private readonly kit: HarnessMcpKit,
    private readonly who: () => Who | undefined,
  ) {}

  private async configured(p: AcpProcess) {
    const { extensions } = (await request(p, "config/extensions/list")) as {
      extensions: {
        configKey: string;
        enabled: boolean;
        extension: Extension;
      }[];
    };
    if (!Array.isArray(extensions))
      throw new Error("Goose did not list its configured extensions");
    type Saved = {
      name?: string;
      envs?: object | null;
      env?: object | null;
      cwd?: unknown;
    };
    let saved: Record<string, Saved> | undefined;
    try {
      ({ value: saved } = (await request(p, "config/read", {
        key: "extensions",
        isSecret: false,
      })) as { value: Record<string, Saved> });
    } catch {}
    const settings = Object.entries(saved ?? {});
    const listed: Configured[] = extensions
      .filter((e) => mcp(e) && e.configKey !== "buzz")
      .map((e) => {
        if (
          typeof e.configKey !== "string" ||
          typeof e.extension.server.name !== "string"
        )
          throw new Error("Goose returned invalid extension metadata");
        const name = e.extension.server.name;
        const matches = settings.filter(
          ([key, value]) =>
            value && typeof value === "object" && (value.name ?? key) === name,
        );
        const lost = [];
        if (
          matches.some(
            ([, value]) =>
              Object.keys(value.envs ?? {}).length ||
              Object.keys(value.env ?? {}).length,
          )
        )
          lost.push("environment values");
        if (matches.some(([, value]) => value.cwd != null))
          lost.push("working directory");
        const reason = !matches.length
          ? "its saved launch settings could not be verified"
          : lost.length
            ? `the API doesn't carry over its saved ${lost.join(" and ")}`
            : undefined;
        return {
          name,
          key: e.configKey,
          enabled: e.enabled,
          extension: e.extension,
          ...(reason && {
            unavailable: `Goose can't start ${name} for one session: ${reason}.`,
          }),
        };
      });
    return listed;
  }
  async report(p: AcpProcess) {
    const configured = await this.configured(p);
    const servers: HarnessMcpServer[] = configured.map(
      ({ name, enabled, unavailable }) => {
        return {
          name,
          default: false,
          ...(unavailable
            ? { state: "failed" as const, reason: unavailable }
            : !enabled && { state: "disabled" as const }),
        };
      },
    );
    return {
      tools: true,
      servers,
    };
  }
  async inspect(p: AcpProcess, cwd: string, name: string, signal: AbortSignal) {
    signal.throwIfAborted();
    const configured = (await abortable(this.configured(p), signal)).find(
      (e) => e.name === name,
    );
    if (!configured)
      throw new Error(`Goose has no configured MCP server named ${name}`);
    if (configured.unavailable) throw new Error(configured.unavailable);
    signal.throwIfAborted();
    const cleanup = new AbortController();
    let deadline: ReturnType<typeof setTimeout> | undefined;
    const cancelling = () => {
      deadline = setTimeout(
        () => cleanup.abort(signal.reason),
        INSPECTION_CLEANUP_MS,
      );
    };
    signal.addEventListener("abort", cancelling, { once: true });
    try {
      const { sessionId } = (await abortable(
        p.request(
          "session/new",
          {
            cwd,
            mcpServers: [],
            _meta: { enabledExtensions: [configured.extension], hidden: true },
          },
          REQUEST_TIMEOUT_MS,
        ),
        cleanup.signal,
      )) as { sessionId: string };
      if (typeof sessionId !== "string" || !sessionId)
        throw new Error("Goose did not return an inspection session ID");
      let tools: HarnessMcpTool[];
      try {
        signal.throwIfAborted();
        ({ tools } = await this.tools(
          p,
          sessionId,
          configured,
          AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
        ));
      } finally {
        await abortable(
          p.request("session/delete", { sessionId }, INSPECTION_CLEANUP_MS),
          cleanup.signal,
        ).catch(() => {
          console.warn("Goose did not delete its temporary MCP session");
        });
      }
      signal.throwIfAborted();
      return tools;
    } finally {
      signal.removeEventListener("abort", cancelling);
      clearTimeout(deadline);
    }
  }
  private async tools(
    p: AcpProcess,
    sessionId: string,
    entry: Pick<Configured, "name" | "key">,
    signal?: AbortSignal,
  ) {
    const listed = request(
      p,
      "tools/list",
      { sessionId, extensionName: entry.key },
      signal ? null : REQUEST_TIMEOUT_MS,
    );
    const { tools } = (await abortable(listed, signal)) as {
      tools: {
        name: string;
        description?: string;
        permission?: string | null;
      }[];
    };
    if (!Array.isArray(tools))
      throw new Error("Goose did not list its MCP tools");
    const prefix = `${entry.key}__`;
    const own = tools.map((t) => ({
      name: t.name.startsWith(prefix) ? t.name.slice(prefix.length) : t.name,
      ...(typeof t.description === "string" && { description: t.description }),
    }));
    return { tools: own };
  }

  private selection(configured: Configured[], choice: HarnessMcpAnswer) {
    const selected: Configured[] = [];
    const applied: Record<string, HarnessMcpChoice[string]> =
      Object.create(null);
    for (const entry of configured) {
      const pick =
        choice && choice !== "none" && Object.hasOwn(choice, entry.name)
          ? (choice[entry.name] ?? false)
          : false;
      applied[entry.name] = pick;
      if (pick === true) selected.push(entry);
      else if (pick && typeof pick === "object") {
        const available = pick.known.filter(
          (name) =>
            !pick.off.includes(name) &&
            (!entry.extension.available_tools?.length ||
              entry.extension.available_tools.includes(name)),
        );
        if (available?.length)
          selected.push({
            ...entry,
            extension: { ...entry.extension, available_tools: available },
          });
      }
    }
    for (const entry of selected)
      if (entry.unavailable) throw new Error(entry.unavailable);
    return { selected, applied };
  }
  hooks(base: AcpHooks) {
    const hooks: AcpHooks = {
      ...base,
      prepareSession: async (buzz, open, process) => {
        const setup = await base.prepareSession?.(buzz, open, process);
        const meta = setup?.meta ?? {};
        const agent = this.who();
        const choice =
          agent && !agent.protection ? await this.kit.choice(agent) : "none";
        const owner = !!buzz && !open.platform;
        let managed = choice !== undefined;
        if (choice !== undefined && owner) {
          const { selected } = this.selection(
            await this.configured(process),
            choice,
          );
          meta.enabledExtensions = [
            ...(meta.enabledExtensions as unknown[]),
            ...selected.map((entry) => entry.extension),
          ];
        }
        return {
          meta,
          beforePrompt: async (sessionId, signal) => {
            const agent = this.who();
            if (!agent) throw new Error("The Goose agent is unavailable");
            const supplied = agent.protection
              ? "none"
              : await this.kit.choice(agent);
            const next = supplied === undefined || owner ? supplied : "none";
            signal.throwIfAborted();
            if (next === undefined && !managed) return;

            const configured = await this.configured(process);
            const { selected, applied: verifiedChoice } = this.selection(
              configured,
              next,
            );
            const params = { sessionId };
            const list = async () => {
              const { extensions } = (await request(
                process,
                "session/extensions/list",
                params,
              )) as {
                extensions: { extensionKey: string; extension: Extension }[];
              };
              return extensions.filter(mcp);
            };
            const current = await list();
            const wanted = new Set(selected.map((entry) => entry.key));
            const removed = current.filter(
              (entry) => !wanted.has(entry.extensionKey),
            );
            for (const { extensionKey } of removed)
              await request(process, "session/extensions/remove", {
                ...params,
                extensionKey,
              });
            for (const { extension } of selected)
              await request(process, "session/extensions/add", {
                ...params,
                extension,
              });
            const actual =
              removed.length || selected.length ? await list() : current;
            const loaded: HarnessMcpLoaded[number][] = [];
            for (const { extensionKey } of actual) {
              const known = configured.find(
                (entry) => entry.key === extensionKey,
              );
              if (!known)
                throw new Error("Goose loaded an unconfigured MCP server");
              const { tools } = await this.tools(process, sessionId, known);
              loaded.push({ name: known.name, state: "connected", tools });
            }
            this.kit.started(
              agent,
              sessionId,
              loaded,
              next === undefined ? "none" : verifiedChoice,
            );
            signal.throwIfAborted();
            managed = next !== undefined;
          },
        };
      },
    };
    return hooks;
  }
}
