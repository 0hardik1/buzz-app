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
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
const strings = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
export const mcpName = (name: string) => name.replace(/[^a-zA-Z0-9_-]/g, "_");

async function readMcpConfig(read: Host["readFile"], cwd: string) {
  const json = async (path: string) => {
    if (!read) return {};
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
      json("~/.claude.json"),
      json(".mcp.json"),
      json("~/.claude/settings.json"),
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
      // Claude's local definition wins over the workspace project file.
      if (needsApproval && Object.hasOwn(object(local.mcpServers), name))
        continue;
      const approvedProject =
        !needsApproval ||
        (!rejected.has(name) &&
          (approved.has(name) ||
            approves(userSettings, name) ||
            (local.hasTrustDialogAccepted === true &&
              approves(projectSettings, name))));
      const off =
        disabled.has(name) ||
        (needsApproval && (rejected.has(name) || (!all && !approvedProject)));
      rows.set(name, {
        server: { name, default: !off, ...(off && { state: "disabled" }) },
        definition: object(definition),
        // Dynamic entries do not carry Claude's project approval checks.
        inspectable: approvedProject,
      });
    }
  return rows;
}

/** Reports expose metadata only. */
export async function configuredMcp(read: Host["readFile"], cwd: string) {
  return [...(await readMcpConfig(read, cwd)).values()].map(
    ({ server }) => server,
  );
}

export async function inspectMcpConfig(
  read: Host["readFile"],
  cwd: string,
  name: string,
) {
  const entry = (await readMcpConfig(read, cwd)).get(name);
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
  // Claude varies helper cwd and credential access by source. An inspection
  // registers its server dynamically, so source-sensitive helpers stay native.
  if (definition.headersHelper != null)
    throw new Error(
      "Claude inspection cannot run this server's headers helper",
    );
  return definition;
}

export function mcpChoice(
  mcp: ClaudeMcp,
  names: readonly HarnessMcpServer[] = mcp.servers,
): HarnessMcpChoice | "none" {
  const choice = mcp.choice;
  if (choice === "none") return "none";
  return Object.fromEntries(
    Object.entries({
      ...Object.fromEntries(
        names.map((server) => [server.name, server.default]),
      ),
      ...choice,
    }).map(([name, pick]) => [name, pick ?? false]),
  );
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
