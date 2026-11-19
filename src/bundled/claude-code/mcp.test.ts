// @vitest-environment node
import { expect, it, vi } from "vitest";
import { ClaudeProcess, type Spawn } from "./claude";
import {
  configuredMcp,
  inspectMcpConfig,
  mcpSettings,
  type ClaudeMcp,
} from "./mcp";
import { fakeSpawn, flush } from "./claude-testing";
import { AgentSessions } from "./sessions";
import { ClaudeRuntime } from "./runtime";
import type {
  Agent,
  AgentHandle,
  Delivery,
} from "../../features/agents/service";
import { localStore } from "../../features/agents/state";

function native(
  servers = ["alpha"],
  admitted = ["read_echo"],
  catalog: Record<string, string[]> = {},
  context?: { name: string; serverName: string }[],
  beforeStatus?: () => Promise<void>,
  description?: string,
  mode?: { pending?: ReadonlySet<string>; beforeContext?: () => void },
) {
  const fake = fakeSpawn();
  const spawn: Spawn = async (id, options) => {
    const inspecting = id === "claude-inspect";
    const process = await fake.spawn(inspecting ? "claude" : id, options);
    const running = fake.processes.at(-1);
    let installed = !inspecting;
    return {
      ...process,
      write: async (data) => {
        const message = JSON.parse(data);
        const subtype = message.request?.subtype;
        if (inspecting && message.mcpServers) {
          installed = true;
          running?.received.push(message);
          return;
        }
        if (subtype !== "mcp_status" && subtype !== "get_context_usage")
          return process.write(data);
        if (subtype === "mcp_status") await beforeStatus?.();
        else mode?.beforeContext?.();
        running?.received.push(message);
        running?.emit({
          type: "control_response",
          response: {
            subtype: "success",
            request_id: message.request_id,
            response:
              subtype === "mcp_status"
                ? {
                    mcpServers: (installed ? servers : []).map((name) => ({
                      name,
                      status: mode?.pending?.has(name)
                        ? "pending"
                        : "connected",
                      config: { env: { SECRET: "never report" } },
                      tools: (mode?.pending?.has(name)
                        ? []
                        : (catalog[name] ?? ["read_echo", "write_marker"])
                      ).map((name) => ({
                        name,
                        ...(description && { description }),
                      })),
                    })),
                  }
                : {
                    mcpTools:
                      context ??
                      admitted.map((name) => ({
                        serverName: "alpha",
                        name: `mcp__alpha__${name}`,
                      })),
                  },
          },
        });
      },
    };
  };
  return { ...fake, spawn };
}
const settings = () => {
  const mcp: ClaudeMcp = {
    choice: {
      alpha: { off: ["write_marker"], known: ["read_echo", "write_marker"] },
      beta: false,
    },
    servers: [
      { name: "alpha", default: true },
      { name: "beta", default: true },
    ],
    started: vi.fn(),
  };
  return mcp;
};

it.each([
  {
    label: "dotted tool names",
    servers: ["alpha"],
    catalog: { alpha: ["search.docs"] },
    context: [{ name: "mcp__alpha__search_docs", serverName: "alpha" }],
    name: "mcp__alpha__search_docs",
    identity: { mcp_server: "alpha", mcp_tool: "search.docs" },
  },
  {
    label: "Claude connector display names",
    servers: ["claude.ai Weather (Preview)"],
    catalog: { "claude.ai Weather (Preview)": ["search.docs"] },
    context: [
      {
        name: "mcp__claude_ai_Weather_Preview__search_docs",
        serverName: "claude_ai_Weather_Preview",
      },
    ],
    name: "mcp__claude_ai_Weather_Preview__search_docs",
    identity: {
      mcp_server: "claude.ai Weather (Preview)",
      mcp_tool: "search.docs",
    },
  },
  {
    label: "dotted server names",
    servers: ["fix n1.dot"],
    catalog: { "fix n1.dot": ["n_echo"] },
    context: [{ name: "mcp__fix_n1_dot__n_echo", serverName: "fix_n1_dot" }],
    name: "mcp__fix_n1_dot__n_echo",
    identity: { mcp_server: "fix n1.dot", mcp_tool: "n_echo" },
  },
  {
    label: "overlapping server prefixes",
    servers: ["alpha", "alpha__beta"],
    catalog: { alpha__beta: ["write.marker"] },
    context: [],
    name: "mcp__alpha__beta__write_marker",
    identity: { mcp_server: "alpha__beta", mcp_tool: "write.marker" },
  },
  {
    label: "authoritative admitted server amid catalog collisions",
    servers: ["alpha", "alpha__beta"],
    catalog: { alpha: ["beta__read_echo"], alpha__beta: ["read_echo"] },
    context: [
      { name: "mcp__alpha__beta__read_echo", serverName: "alpha__beta" },
    ],
    name: "mcp__alpha__beta__read_echo",
    identity: { mcp_server: "alpha__beta", mcp_tool: "read_echo" },
  },
])(
  "projects raw MCP identity to native hooks: $label",
  async ({ servers, catalog, context, name, identity }) => {
    const f = native(servers, [], catalog, context);
    const hook = vi.fn(async () => ({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
      },
    }));
    const process = await ClaudeProcess.start(f.spawn, {
      cwd: "/work",
      systemPrompt: "",
      mcp: settings(),
      hook,
    });
    const fake = f.processes[0];
    for (const event of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) {
      fake?.emit({
        type: "control_request",
        request_id: event,
        request: {
          subtype: "hook_callback",
          callback_id: `buzz:${event}`,
          input: {
            tool_name: name,
            tool_input: { text: "fixture" },
            mcp_server: "forged",
            mcp_tool: "forged",
          },
        },
      });
      await flush();
      expect(hook).toHaveBeenLastCalledWith(
        "",
        event,
        {
          tool_name: name,
          tool_input: { text: "fixture" },
          ...identity,
        },
        undefined,
      );
    }
    expect(fake?.received).toContainEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: "PreToolUse",
        response: {
          hookSpecificOutput: {
            hookEventName: "PreToolUse",
            permissionDecision: "deny",
          },
        },
      },
    });
    await process.kill();
  },
);

it("refuses admitted tool names that collide after native normalization", async () => {
  const f = native(["alpha"], ["search_docs"], {
    alpha: ["search.docs", "search_docs"],
  });
  await expect(
    ClaudeProcess.start(f.spawn, {
      cwd: "/work",
      systemPrompt: "",
      mcp: settings(),
    }),
  ).rejects.toThrow("Claude could not verify an admitted MCP tool");
  expect(f.processes[0]?.killed).toBe(true);
  expect(f.processes[0]?.prompts).toEqual([]);
});

it.each([
  "mcp__unknown__read",
  "mcp__alpha_beta__read_echo",
  "mcp__buzz__send",
  "Bash",
])(
  "leaves unresolved, ambiguous and Buzz identities unnamed in hooks: %s",
  async (name) => {
    const f = native(
      ["alpha.beta", "alpha_beta", "buzz"],
      [],
      {
        "alpha.beta": ["read.echo"],
        alpha_beta: ["read_echo"],
        buzz: ["send"],
      },
      [],
    );
    const hook = vi.fn(async () => ({}));
    const process = await ClaudeProcess.start(f.spawn, {
      cwd: "/work",
      systemPrompt: "",
      mcp: settings(),
      hook,
    });
    const fake = f.processes[0];
    fake?.emit({
      type: "control_request",
      request_id: "hook",
      request: {
        subtype: "hook_callback",
        callback_id: "buzz:PreToolUse",
        input: { tool_name: name, mcp_server: "forged", mcp_tool: "forged" },
      },
    });
    await flush();
    expect(hook).toHaveBeenCalledWith(
      "",
      "PreToolUse",
      {
        tool_name: name,
        ...(name !== "mcp__buzz__send" && name !== "Bash"
          ? { mcp_unresolved: true }
          : {}),
      },
      undefined,
    );
    expect(fake?.killed).toBe(false);
    await process.kill();
  },
);

it("recognizes only SDK tools actually listed by the Buzz bridge without MCP control", async () => {
  const f = fakeSpawn();
  const hook = vi.fn(async () => ({}));
  const process = await ClaudeProcess.start(f.spawn, {
    cwd: "/work",
    systemPrompt: "",
    sessionId: "owned",
    hook,
    tools: async (_conversation, message) => ({
      jsonrpc: "2.0",
      id: (message as { id: number }).id,
      result: { tools: [{ name: "send" }] },
    }),
  });
  const fake = f.processes[0];
  fake?.emit({
    type: "control_request",
    request_id: "list",
    request: {
      subtype: "mcp_message",
      server_name: "buzz",
      message: { jsonrpc: "2.0", id: 1, method: "tools/list" },
    },
  });
  await flush();
  for (const event of ["PreToolUse", "PostToolUse", "PostToolUseFailure"]) {
    for (const name of [
      "mcp__buzz__send",
      "mcp__buzz__unlisted",
      "mcp__unknown__tool",
    ]) {
      fake?.emit({
        type: "control_request",
        request_id: `${event}-${name}`,
        request: {
          subtype: "hook_callback",
          callback_id: `buzz:${event}`,
          input: {
            tool_name: name,
            mcp_server: "forged",
            mcp_tool: "forged",
            mcp_unresolved: false,
          },
        },
      });
      await flush();
      expect(hook).toHaveBeenLastCalledWith(
        "owned",
        event,
        {
          tool_name: name,
          ...(name !== "mcp__buzz__send" ? { mcp_unresolved: true } : {}),
        },
        undefined,
      );
    }
  }
  await process.kill();
});

const agent = {
  key: "native-agent",
  pubkey: "a".repeat(64),
  relay: "wss://relay.example",
  config: { workspace: "/work" },
} as Agent;

it("delivers live session inventory to the control without retaining it in static reports", async () => {
  const f = native();
  const runtime = new ClaudeRuntime(
    { spawn: f.spawn, readFile: async () => new TextEncoder().encode("{}") },
    () => undefined,
    async () => undefined,
    localStore(),
  );
  runtime.mcp = {
    choice: async () => ({}),
    started: vi.fn(),
  };
  const delivery = {
    agent: { ...agent } as unknown as AgentHandle,
    config: agent.config,
  } as Delivery;
  try {
    await expect(
      runtime.runOnce({
        delivery,
        key: "seen",
        signal: new AbortController().signal,
        prompt: async () => undefined,
      }),
    ).resolves.toEqual({ ok: true });
    expect(f.processes).toHaveLength(1);
    expect(runtime.mcp.started).toHaveBeenCalledWith(
      expect.objectContaining({ key: agent.key }),
      expect.any(String),
      [{ name: "alpha", state: "connected", tools: [{ name: "read_echo" }] }],
      { alpha: true },
    );
    expect(await runtime.harnessMcp(agent)).toMatchObject({
      calls: true,
      servers: [],
    });
    expect(
      await runtime.harnessMcp({ ...agent, protection: {} } as Agent),
    ).not.toHaveProperty("calls");
    expect(
      f.processes.every((process) => process.killed && !process.prompts.length),
    ).toBe(true);
  } finally {
    runtime.dispose();
  }
});

it("requires native approval and isolates each Claude inspection from its siblings", async () => {
  const names = ["alpha"];
  const context = [{ name: "mcp__alpha__read_echo", serverName: "alpha" }];
  const f = native(names, [], {}, context);
  const definitions = {
    alpha: { command: "fixture-mcp", args: ["a"], env: { FIXTURE: "test" } },
    beta: { command: "fixture-mcp", args: ["b"] },
  };
  let approved = false;
  let configured = true;
  const runtime = new ClaudeRuntime(
    {
      spawn: f.spawn,
      readFile: async (path) =>
        new TextEncoder().encode(
          JSON.stringify(
            !configured
              ? {}
              : path === ".mcp.json"
                ? { mcpServers: { alpha: definitions.alpha } }
                : path === "~/.claude.json"
                  ? {
                      mcpServers: { beta: definitions.beta, buzz: {} },
                      projects: approved
                        ? { "/work": { enabledMcpjsonServers: ["alpha"] } }
                        : {},
                    }
                  : path === ".claude/settings.json"
                    ? { enableAllProjectMcpServers: true }
                    : {},
          ),
        ),
    },
    () => undefined,
    async () => undefined,
    localStore(),
  );
  try {
    await expect(runtime.inspectMcp(agent, "alpha")).rejects.toThrow(
      "Claude inspection could not verify this server's project approval",
    );
    expect(f.processes).toHaveLength(0);
    approved = true;
    for (const selected of ["alpha", "beta"] as const) {
      names[0] = selected;
      context[0] = {
        name: `mcp__${selected}__read_echo`,
        serverName: selected,
      };
      expect(await runtime.inspectMcp(agent, selected)).toEqual([
        { name: "read_echo" },
        { name: "write_marker" },
      ]);
      const process = f.processes.at(-1);
      expect(process?.options.args).toContain("--strict-mcp-config");
      expect(process?.options.args).not.toContain("--mcp-config");
      expect(process?.received[0]).toEqual({
        mcpServers: { [selected]: definitions[selected] },
      });
    }
    configured = false;
    expect(await runtime.harnessMcp(agent)).toEqual({
      tools: true,
      servers: [],
    });
    expect(f.processes).toHaveLength(2);
    expect(
      f.processes.every((process) => process.killed && !process.prompts.length),
    ).toBe(true);
  } finally {
    await runtime.dispose();
  }
});

it.each(["retire", "dispose"] as const)(
  "does not start an inspection after %s while its configuration is pending",
  async (stop) => {
    let read!: () => void;
    let resume!: () => void;
    const reading = new Promise<void>((resolve) => {
      read = resolve;
    });
    const release = new Promise<void>((resolve) => {
      resume = resolve;
    });
    const f = native();
    const runtime = new ClaudeRuntime(
      {
        spawn: f.spawn,
        readFile: async (path) => {
          if (path === "~/.claude.json") {
            read();
            await release;
          }
          return new TextEncoder().encode(
            JSON.stringify(
              path === "~/.claude.json" ? { mcpServers: { alpha: {} } } : {},
            ),
          );
        },
      },
      () => undefined,
      async () => undefined,
      localStore(),
    );
    const inspection = runtime.inspectMcp(agent, "alpha").then(
      (tools) => ({ tools }),
      (error) => ({ error }),
    );
    let stopping: Promise<unknown> | undefined;
    try {
      await reading;
      stopping =
        stop === "retire" ? runtime.retire(agent.key) : runtime.dispose();
      resume();
      await expect(inspection).resolves.toMatchObject({
        error: expect.objectContaining({
          message:
            stop === "retire" ? "Claude is retired" : "Claude was stopped",
        }),
      });
      await stopping;
      expect(f.processes).toHaveLength(0);
    } finally {
      resume();
      await inspection;
      await stopping;
      await runtime.dispose();
    }
  },
);

it("retires a live inspection only after its native process has exited", async () => {
  let read!: () => void;
  let resume!: () => void;
  const reading = new Promise<void>((resolve) => {
    read = resolve;
  });
  const release = new Promise<void>((resolve) => {
    resume = resolve;
  });
  const f = native(["alpha"], ["read_echo"], {}, undefined, async () => {
    read();
    await release;
  });
  const runtime = new ClaudeRuntime(
    {
      spawn: f.spawn,
      readFile: async (path) =>
        new TextEncoder().encode(
          JSON.stringify(
            path === "~/.claude.json" ? { mcpServers: { alpha: {} } } : {},
          ),
        ),
    },
    () => undefined,
    async () => undefined,
    localStore(),
  );
  const inspection = runtime.inspectMcp(agent, "alpha").catch((error) => error);
  let stopping: Promise<void> | undefined;
  let retired = false;
  try {
    await reading;
    const process = f.processes[0];
    if (!process) throw new Error("The inspection did not spawn");
    process.exitOnKill = false;
    stopping = runtime.retire(agent.key).then(() => {
      retired = true;
    });
    await vi.waitFor(() => expect(process.killed).toBe(true));
    expect(retired).toBe(false);
    resume();
    process.exit(0);
    await stopping;
    expect(retired).toBe(true);
  } finally {
    resume();
    f.processes[0]?.exit(0);
    await inspection;
    await stopping;
    await runtime.dispose();
  }
});

it("reports the bounded native config union with native project approvals and metadata only", async () => {
  const files: Record<string, unknown> = {
    "~/.claude.json": {
      mcpServers: { user: { env: { SECRET: "hidden" } }, buzz: {} },
      projects: {
        "/work": {
          mcpServers: { local: {} },
          enabledMcpjsonServers: ["approved"],
          disabledMcpjsonServers: ["rejected"],
          disabledMcpServers: ["user"],
        },
        "/elsewhere": { mcpServers: { other: {} } },
      },
    },
    ".mcp.json": { mcpServers: { approved: {}, rejected: {}, unapproved: {} } },
  };
  const read = vi.fn(async (path: string, _options?: { cwd?: string }) =>
    new TextEncoder().encode(JSON.stringify(files[path] ?? {})),
  );
  const rows = await configuredMcp(read, "/work");
  expect(rows).toEqual([
    { name: "user", default: false, state: "disabled" },
    { name: "local", default: true },
    { name: "approved", default: true },
    { name: "rejected", default: false, state: "disabled" },
    { name: "unapproved", default: false, state: "disabled" },
  ]);
  expect(
    read.mock.calls.every(
      ([, options]) =>
        (options as { cwd?: string } | undefined)?.cwd === "/work",
    ),
  ).toBe(true);
});

it("honors enable-all without overriding a normalized project rejection", async () => {
  const files: Record<string, unknown> = {
    ".mcp.json": { mcpServers: { on: {}, "weather.v2": {} } },
    ".claude/settings.local.json": {
      enableAllProjectMcpServers: true,
      disabledMcpjsonServers: ["weather_v2"],
    },
  };
  const read = async (path: string) =>
    new TextEncoder().encode(JSON.stringify(files[path] ?? {}));
  expect(await configuredMcp(read, "/work")).toEqual([
    { name: "on", default: true },
    { name: "weather.v2", default: false, state: "disabled" },
  ]);
  await expect(inspectMcpConfig(read, "/work", "weather.v2")).rejects.toThrow(
    "Enable this MCP server in Claude before inspecting its tools",
  );
});

it("reports project servers when the config path probe fails", async () => {
  const files: Record<string, unknown> = {
    ".mcp.json": { mcpServers: { maps: {} } },
    ".claude/settings.json": { enableAllProjectMcpServers: true },
    "~/.claude.json": { mcpServers: { elsewhere: {} } },
  };
  const runtime = new ClaudeRuntime(
    {
      mcpConfigPaths: async () => {
        throw new Error("Config path probe failed");
      },
      readFile: async (path) =>
        new TextEncoder().encode(JSON.stringify(files[path] ?? {})),
    },
    () => undefined,
    async () => undefined,
    localStore(),
  );
  try {
    expect(await runtime.harnessMcp(agent)).toEqual({
      tools: true,
      servers: [{ name: "maps", default: false, state: "disabled" }],
    });
  } finally {
    await runtime.dispose();
  }
});

it("reports and inspects against the effective config home", async () => {
  const paths = {
    user: "/alternate/.claude.json",
    settings: "/alternate/settings.json",
  };
  const weather = { command: "fixture-weather" };
  const files: Record<string, unknown> = {
    "~/.claude.json": { mcpServers: { old: {} } },
    [paths.user]: { mcpServers: { weather } },
    [paths.settings]: { enabledMcpjsonServers: ["maps"] },
    ".mcp.json": { mcpServers: { maps: {} } },
  };
  const read = async (path: string) =>
    new TextEncoder().encode(JSON.stringify(files[path] ?? {}));
  expect(await configuredMcp(read, "/work", paths)).toEqual([
    { name: "weather", default: true },
    { name: "maps", default: true },
  ]);
  expect(await inspectMcpConfig(read, "/work", "weather", paths)).toEqual(
    weather,
  );
  const conflicting = { ...paths, user: null };
  const servers = await configuredMcp(read, "/work", conflicting);
  expect(servers).toEqual([
    { name: "maps", default: false, state: "disabled" },
  ]);
  expect(
    mcpSettings({ ...settings(), servers, choice: {} }).deniedMcpServers,
  ).toEqual([{ serverName: "maps" }]);
  await expect(
    inspectMcpConfig(read, "/work", "weather", conflicting),
  ).rejects.toThrow("could not identify its global MCP configuration");
});

it("verifies admitted tools rather than the catalog and retains every configured applied choice", async () => {
  const f = native(
    ["alpha"],
    ["read_echo"],
    {
      alpha: ["read_echo", "write.marker"],
    },
    undefined,
    undefined,
    "Native tool description",
  );
  const mcp = {
    ...settings(),
    choice: {
      alpha: { off: ["write.marker"], known: ["read_echo", "write.marker"] },
      beta: false,
    },
  };
  const process = await ClaudeProcess.start(f.spawn, {
    cwd: "/work",
    systemPrompt: "",
    mcp,
  });
  expect(mcp.started).toHaveBeenCalledWith(
    "initial",
    [
      {
        name: "alpha",
        state: "connected",
        tools: [{ name: "read_echo", description: "Native tool description" }],
      },
    ],
    {
      alpha: { off: ["write.marker"], known: ["read_echo", "write.marker"] },
      beta: false,
    },
  );
  const args = f.processes[0]?.options.args ?? [];
  expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "{}")).toEqual({
    deniedMcpServers: [{ serverName: "beta" }],
    permissions: { deny: ["mcp__alpha__write_marker"] },
  });
  expect(f.processes[0]?.prompts).toEqual([]);
  await process.kill();
});

it.each(["unexpected", "buzz"])(
  "stops and awaits an inspection that reports %s before exposing tools",
  async (unexpected) => {
    const f = native(["alpha", unexpected], [], {}, []);
    const runtime = new ClaudeRuntime(
      {
        spawn: f.spawn,
        readFile: async (path) =>
          new TextEncoder().encode(
            JSON.stringify(
              path === "~/.claude.json"
                ? { mcpServers: { alpha: { command: "fixture-mcp" } } }
                : {},
            ),
          ),
      },
      () => undefined,
      async () => undefined,
      localStore(),
    );
    try {
      await expect(runtime.inspectMcp(agent, "alpha")).rejects.toThrow(
        "unexpected MCP server",
      );
      expect(f.processes[0]?.killed).toBe(true);
      expect(f.processes[0]?.prompts).toEqual([]);
    } finally {
      await runtime.dispose();
    }
  },
);

it.each(["unique", "ambiguous"] as const)(
  "starts with a connecting server and checks its first late tool hook: %s",
  async (identity) => {
    vi.useFakeTimers();
    const ambiguous = identity === "ambiguous";
    const delayed = ambiguous ? "alpha__beta" : "alpha";
    const toolName = `mcp__${delayed}__search_docs`;
    const pending = new Set([delayed]);
    let statusRead!: () => void;
    const firstStatus = new Promise<void>((resolve) => {
      statusRead = resolve;
    });
    const context: { name: string; serverName: string }[] = ambiguous
      ? [{ name: toolName, serverName: "alpha" }]
      : [];
    const f = native(
      ambiguous ? ["alpha", delayed] : [delayed],
      [],
      ambiguous
        ? { alpha: ["beta__search.docs"], [delayed]: ["search.docs"] }
        : { [delayed]: ["search.docs"] },
      context,
      async () => statusRead(),
      undefined,
      { pending },
    );
    const launch = settings();
    let hookInput!: (input: unknown) => void;
    const hookSeen = new Promise<unknown>((resolve) => {
      hookInput = resolve;
    });
    const opening = ClaudeProcess.start(f.spawn, {
      cwd: "/work",
      systemPrompt: "",
      mcp: launch,
      hook: async (_session, _event, input) => {
        hookInput(input);
        return {};
      },
    });
    let process: ClaudeProcess | undefined;
    void opening.then(
      (opened) => {
        process = opened;
      },
      () => undefined,
    );
    try {
      await firstStatus;
      await vi.advanceTimersByTimeAsync(15_000);
      expect(process?.running).toBe(true);
      expect(launch.started).toHaveBeenCalledWith(
        "initial",
        expect.arrayContaining([{ name: delayed, tools: [] }]),
        expect.objectContaining({ [delayed]: expect.anything() }),
      );
      expect(f.processes[0]?.killed).toBe(false);

      pending.delete(delayed);
      f.processes[0]?.emit({
        type: "control_request",
        request_id: "late-tool",
        request: {
          subtype: "hook_callback",
          callback_id: "buzz:PreToolUse",
          input: { tool_name: toolName },
        },
      });
      expect(await hookSeen).toEqual({
        tool_name: toolName,
        ...(ambiguous
          ? { mcp_unresolved: true }
          : { mcp_server: delayed, mcp_tool: "search.docs" }),
      });
    } finally {
      pending.clear();
      await vi.advanceTimersByTimeAsync(50);
      await process?.kill();
      vi.useRealTimers();
    }
  },
);

it.each([
  { server: "alpha", context: undefined, applied: undefined },
  {
    server: "fix n1.dot",
    context: [
      { name: "mcp__fix_n1_dot__write_marker", serverName: "fix_n1_dot" },
    ],
    applied: {
      alpha: { off: ["write_marker"], known: ["read_echo", "write_marker"] },
      beta: false,
      "fix n1.dot": true,
    },
  },
])(
  "verifies tools already admitted as a server connects during startup: $server",
  async ({ server, context, applied }) => {
    const pending = new Set([server]);
    const f = native(
      [server],
      ["write_marker"],
      {},
      context,
      undefined,
      undefined,
      { pending, beforeContext: () => pending.clear() },
    );
    const mcp = settings();
    const process = await ClaudeProcess.start(f.spawn, {
      cwd: "/work",
      systemPrompt: "",
      mcp,
    });
    try {
      expect(mcp.started).toHaveBeenCalledWith(
        "initial",
        [
          {
            name: server,
            state: "connected",
            tools: [{ name: "write_marker" }],
          },
        ],
        applied ?? mcp.choice,
      );
    } finally {
      await process.kill();
    }
  },
);

it("never prompts after core rejects readback, and strict-none keeps the SDK server out of the listing", async () => {
  const f = native();
  await expect(
    ClaudeProcess.start(f.spawn, {
      cwd: "/work",
      systemPrompt: "",
      mcp: {
        ...settings(),
        started: () => {
          throw new Error("choice did not apply");
        },
      },
    }),
  ).rejects.toThrow("choice did not apply");
  expect(f.processes[0]?.killed).toBe(true);
  expect(f.processes[0]?.prompts).toEqual([]);
  const empty = native(["buzz"], []);
  const started = vi.fn();
  const process = await ClaudeProcess.start(empty.spawn, {
    cwd: "/work",
    systemPrompt: "",
    mcp: { choice: "none", servers: [], started },
  });
  expect(empty.processes[0]?.options.args).toContain("--strict-mcp-config");
  expect(started).toHaveBeenCalledWith("initial", [], "none");
  await process.kill();
});

it("keeps ordinary permission fallback and tool exclusions without installing the old native gate", async () => {
  const f = native();
  const process = await ClaudeProcess.start(f.spawn, {
    cwd: "/work",
    systemPrompt: "",
    mcp: settings(),
  });
  const fake = f.processes[0];
  expect(fake?.options.args).not.toContain("--permission-prompt-tool");
  for (const name of ["Bash", "mcp__alpha__read_echo", "mcp__unknown__read"]) {
    fake?.emit({
      type: "control_request",
      request_id: name,
      request: {
        subtype: "can_use_tool",
        tool_name: name,
        input: { text: "fixture" },
      },
    });
    await flush();
    expect(fake?.received).toContainEqual({
      type: "control_response",
      response: {
        subtype: "success",
        request_id: name,
        response: { behavior: "allow", updatedInput: { text: "fixture" } },
      },
    });
  }
  await process.kill();
});

it("replaces idle sessions when the MCP choice changes and never borrows the spare", async () => {
  const f = native();
  let choice = "first";
  const take = vi.fn();
  const pool = new AgentSessions({
    spawn: f.spawn,
    store: { get: () => undefined, set: () => {}, delete: () => {} },
    fingerprint: () => choice,
    spare: { take } as never,
    launch: async () => ({ cwd: "/work", systemPrompt: "", mcp: settings() }),
  });
  await pool.deliver("thread", "first", 1);
  choice = "second";
  await pool.deliver("thread", "second", 2);
  expect(take).not.toHaveBeenCalled();
  expect(
    f.processes
      .filter((process) => process.prompts.length)
      .map((process) => process.prompts),
  ).toEqual([["first"], ["second"]]);
  expect(f.processes[0]?.killed).toBe(true);
  await pool.shutdown();
});

it("applies explicit exclusions for native names absent from static discovery", async () => {
  const f = native([], []);
  const process = await ClaudeProcess.start(f.spawn, {
    cwd: "/work",
    systemPrompt: "",
    mcp: {
      choice: {
        managed: false,
        "claude.ai Weather (Preview)": {
          off: ["write.marker"],
          known: ["read_echo", "write.marker"],
        },
      },
      servers: [],
      started: vi.fn(),
    },
  });
  try {
    const args = f.processes[0]?.options.args ?? [];
    expect(JSON.parse(args[args.indexOf("--settings") + 1] ?? "{}")).toEqual({
      deniedMcpServers: [{ serverName: "managed" }],
      permissions: { deny: ["mcp__claude_ai_Weather_Preview__write_marker"] },
    });
    expect(f.processes[0]?.prompts).toEqual([]);
  } finally {
    await process.kill();
  }
});
