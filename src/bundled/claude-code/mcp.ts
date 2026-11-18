import type {
  HarnessMcpAnswer,
  HarnessMcpChoice,
  HarnessMcpLoaded,
  HarnessMcpServer,
} from "../../features/agents/harness-mcp";
import type { Host } from "../../features/host/service";

export type ClaudeMcp = Readonly<{
  choice: HarnessMcpAnswer;
  servers: readonly HarnessMcpServer[];
  started(
    session: string,
    loaded: HarnessMcpLoaded,
    applied: HarnessMcpChoice | "none",
  ): void;
}>;
const object = (value: unknown) => {
  const record: Record<string, unknown> =
    value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  return record;
};
const strings = (value: unknown) =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
export function mcpName(name: string) {
  const normalized = name.replace(/[^a-zA-Z0-9_-]/g, "_");
  return name.startsWith("claude.ai ")
    ? normalized.replace(/_+/g, "_").replace(/^_|_$/g, "")
    : normalized;
}

export type McpConfigPaths = { user: string | null; settings: string };
const defaultPaths: McpConfigPaths = {
  user: "~/.claude.json",
  settings: "~/.claude/settings.json",
};

async function readMcpConfig(
  read: Host["readFile"],
  cwd: string,
  paths: McpConfigPaths | null = defaultPaths,
) {
  const json = async (path: string | null | undefined) => {
    if (!read || !path) return {};
    try {
      return object(
        JSON.parse(new TextDecoder().decode(await read(path, { cwd }))),
      );
    } catch {
      return {};
    }
  };
  const [user, project, userSettings, projectSettings, localSettings] =
    await Promise.all([
      json(paths?.user),
      json(".mcp.json"),
      json(paths?.settings),
      json(".claude/settings.json"),
      json(".claude/settings.local.json"),
    ]);
  const local = object(object(user.projects)[cwd]);
  const disabled = new Set([
    ...strings(user.disabledMcpServers),
    ...strings(local.disabledMcpServers),
  ]);
  const approved = new Set(strings(local.enabledMcpjsonServers));
  const rejected = new Set(
    [local, userSettings, projectSettings, localSettings].flatMap((settings) =>
      strings(settings.disabledMcpjsonServers),
    ),
  );
  const normalizedRejected = new Set(
    [...rejected].filter((name) => !name.startsWith("plugin:")).map(mcpName),
  );
  const all =
    { ...userSettings, ...projectSettings, ...localSettings }
      .enableAllProjectMcpServers === true;
  const rows = new Map<
    string,
    {
      server: HarnessMcpServer;
      definition: Record<string, unknown>;
      inspectable: boolean;
    }
  >();
  const approves = (settings: Record<string, unknown>, name: string) =>
    settings.enableAllProjectMcpServers === true ||
    strings(settings.enabledMcpjsonServers).includes(name);
  for (const [servers, needsApproval] of [
    [user.mcpServers, false],
    [local.mcpServers, false],
    [project.mcpServers, true],
  ] as const)
    for (const [name, definition] of Object.entries(object(servers))) {
      if (name === "buzz") continue;
      if (needsApproval && Object.hasOwn(object(local.mcpServers), name))
        continue;
      const rejectedProject =
        needsApproval &&
        (rejected.has(name) ||
          (!name.startsWith("plugin:") &&
            normalizedRejected.has(mcpName(name))));
      const approvedProject =
        !needsApproval ||
        (!rejectedProject &&
          (approved.has(name) ||
            approves(userSettings, name) ||
            (local.hasTrustDialogAccepted === true &&
              approves(projectSettings, name))));
      const off =
        !paths?.user ||
        disabled.has(name) ||
        (needsApproval && (rejectedProject || (!all && !approvedProject)));
      rows.set(name, {
        server: { name, default: !off, ...(off && { state: "disabled" }) },
        definition: object(definition),
        inspectable: approvedProject,
      });
    }
  return rows;
}

/** Reports expose metadata only. */
export async function configuredMcp(
  read: Host["readFile"],
  cwd: string,
  paths?: McpConfigPaths | null,
) {
  return [...(await readMcpConfig(read, cwd, paths)).values()].map(
    ({ server }) => server,
  );
}

export async function inspectMcpConfig(
  read: Host["readFile"],
  cwd: string,
  name: string,
  paths?: McpConfigPaths,
) {
  if (paths?.user === null)
    throw new Error(
      "Claude inspection could not identify its global MCP configuration",
    );
  const entry = (await readMcpConfig(read, cwd, paths)).get(name);
  if (!entry) throw new Error("This agent cannot inspect that MCP server");
  if (!entry.server.default)
    throw new Error(
      "Enable this MCP server in Claude before inspecting its tools",
    );
  if (!entry.inspectable)
    throw new Error(
      "Claude inspection could not verify this server's project approval",
    );
  const { definition } = entry;
  if (definition.headersHelper != null)
    throw new Error(
      "Claude inspection cannot run this server's headers helper",
    );
  return definition;
}

export function mcpChoice(
  mcp: ClaudeMcp,
  names: readonly HarnessMcpServer[] = mcp.servers,
) {
  const choice = mcp.choice;
  if (choice === "none") return "none";
  const picked: HarnessMcpChoice = Object.fromEntries(
    Object.entries({
      ...Object.fromEntries(
        names.map((server) => [server.name, server.default]),
      ),
      ...choice,
    }).map(([name, pick]) => [name, pick ?? false]),
  );
  return picked;
}
export function mcpSettings(mcp: ClaudeMcp) {
  const choice = mcpChoice(mcp);
  return {
    deniedMcpServers: [
      ...(choice === "none"
        ? mcp.servers.map(({ name }) => ({ serverName: name }))
        : Object.entries(choice)
            .filter(([, pick]) => pick === false)
            .map(([name]) => ({ serverName: name }))),
    ],
    permissions: {
      deny:
        choice === "none"
          ? []
          : Object.entries(choice).flatMap(([server, tools]) =>
              typeof tools === "object"
                ? tools.off.map(
                    (tool) => `mcp__${mcpName(server)}__${mcpName(tool)}`,
                  )
                : [],
            ),
    },
  };
}
