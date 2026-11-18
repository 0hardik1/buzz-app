import { Context } from "@deepseek-ai/cordis";
import { expect, it, vi } from "vitest";
import {
  createHarnessMcp,
  type HarnessMcpControl,
  type HarnessMcpReport,
} from "./harness-mcp";
import type { Agent } from "./service";
import { createPluginManager } from "../../plugins/manager";
import type { PluginStorage } from "../../plugins/storage";
import type { PluginInfo, StorageResult } from "../../plugins/types";

const key = "agent-key" as Agent["key"];
const agent = {
  key,
  type: "third/type",
  name: "Ampy",
  owner: "owner-key",
} as Agent;
const handle = { key } as never;

function setup(options: { harnessMcp?: unknown } = {}) {
  const status = {
    unavailable: false,
    settled: true,
    active: true,
    listeners: new Set<() => void>(),
    change(
      next: Partial<{
        unavailable: boolean;
        settled: boolean;
        active: boolean;
      }>,
    ) {
      Object.assign(status, next);
      for (const listener of [...status.listeners]) listener();
    },
  };
  const root = new Context();
  const live = { agent };
  const created = createHarnessMcp(
    () =>
      ({
        isActive: (id: string, revision: string) =>
          status.active && id === "policy" && revision === "1",
        subscribe: (listener: () => void) => {
          status.listeners.add(listener);
          return () => status.listeners.delete(listener);
        },
        unavailable: () => status.unavailable,
        settled: () => status.settled,
      }) as never,
    (found) => (found === key ? live.agent : undefined),
    () => [
      {
        key: "third/type",
        pluginId: "third",
        ...(options.harnessMcp ? { harnessMcp: options.harnessMcp } : {}),
      } as never,
    ],
  );
  const kitOf = (id = "third") =>
    created.kitFor(
      root.extend({ pluginOwner: { id, revision: "1" } } as never),
    );
  const mcp = { ...created, kit: kitOf() };
  const scope = (agentMcp = true) =>
    root.extend({
      pluginOwner: {
        id: "policy",
        revision: "1",
        ...(agentMcp && { agentMcp }),
      },
    } as never);
  async function install(control: HarnessMcpControl) {
    const fiber = scope().plugin((ctx) => mcp.control(ctx, control));
    await fiber.await();
    return fiber;
  }
  return { mcp, status, scope, install, root, live, kitOf };
}

const loaded = (...names: string[]) => names.map((name) => ({ name }));

it("leaves the harness's default alone while no control or declaring plugin exists", async () => {
  const { mcp, status } = setup();
  status.settled = false;
  await expect(mcp.kit.choice(handle)).resolves.toBeUndefined();
});

const ready = (plugins: PluginInfo[] = [], paused = false) =>
  ({
    status: "ready",
    externalPluginsPaused: paused,
    catalog: { profile: "test", location: "test", plugins },
  }) satisfies StorageResult;
const declaring = (source: PluginInfo["source"] = "bundled") =>
  ({
    manifest: {
      id: "policy",
      name: "Policy",
      apiVersion: 1,
      host: { agentMcp: true },
    },
    source,
    enabled: true,
    revision: "1",
    previous: null,
    reloadable: source === "external",
    error: null,
  }) satisfies PluginInfo;
function startup(getCatalog: PluginStorage["getCatalog"]) {
  const root = new Context();
  const plugins = createPluginManager(root, {
    storage: {
      getCatalog,
      changePlugin: vi.fn(),
      recoverSettings: vi.fn(),
      readModule: async () => "",
      reloadPlugin: vi.fn(),
    },
    bundled: [
      {
        manifest: { id: "policy", name: "Policy", apiVersion: 1 },
        module: {
          apply() {
            throw new Error("Policy failed");
          },
        },
      },
    ],
  });
  const { kitFor } = createHarnessMcp(
    () => root.pluginStatus,
    (found) => (found === key ? agent : undefined),
    () => [{ key: "third/type", pluginId: "third" } as never],
  );
  const kit = kitFor(
    root.extend({ pluginOwner: { id: "third", revision: "1" } } as never),
  );
  let answer: unknown = "pending";
  void kit.choice(handle).then((value) => {
    answer = value;
  });
  return {
    answer: () => answer,
    async dispose() {
      await plugins.dispose();
      await root.fiber.dispose();
    },
  };
}

it.each([
  ["no plugin declares choosing: the harness's default", ready(), undefined],
  [
    "the plugin that declares it fails to start: none",
    ready([declaring()]),
    "none",
  ],
  [
    "it is external and external plugins are paused: none",
    ready([declaring("external")], true),
    "none",
  ],
  [
    "the settings need the user to reset them: none",
    { status: "recovery", reason: "Unreadable", canReset: true },
    "none",
  ],
] as [string, StorageResult, unknown][])(
  "waits for the plugin settings at startup, then answers as they say; when %s",
  async (_, result, expected) => {
    vi.useFakeTimers();
    let read!: (result: StorageResult) => void;
    const app = startup(
      () => new Promise<StorageResult>((resolve) => (read = resolve)),
    );
    try {
      await vi.advanceTimersByTimeAsync(0);
      expect(app.answer()).toBe("pending");
      read(result);
      await vi.advanceTimersByTimeAsync(0);
      expect(app.answer()).toBe(expected);
    } finally {
      await app.dispose();
      vi.useRealTimers();
    }
  },
);

it("loads nothing when the plugin settings still can't be read after 30 seconds", async () => {
  vi.useFakeTimers();
  const app = startup(async () => {
    throw new Error("Storage offline");
  });
  try {
    await vi.advanceTimersByTimeAsync(29_000);
    expect(app.answer()).toBe("pending");
    await vi.advanceTimersByTimeAsync(1_000);
    expect(app.answer()).toBe("none");
  } finally {
    await app.dispose();
    vi.useRealTimers();
  }
});

it("keeps only booleans and lists of off and known tool names from a control's answer", async () => {
  const { mcp, install } = setup();
  let answer: unknown;
  await install({ choose: () => answer as never });
  answer = {
    alpha: true,
    beta: { off: ["write"], known: ["read", "write"] },
    gamma: "yes",
    delta: { off: [1], known: [] },
    epsilon: { off: ["write"] },
    zeta: ["write"],
    constructor: true,
  };
  const choice = await mcp.kit.choice(handle);
  expect({ ...(choice as object) }).toEqual({
    alpha: true,
    beta: { off: ["write"], known: ["read", "write"] },
    gamma: false,
    delta: false,
    epsilon: false,
    zeta: false,
    constructor: true,
  });
  expect(Object.getPrototypeOf(choice)).toBeNull();
  for (const odd of ["all", ["alpha"], Promise.resolve({}), null]) {
    answer = odd;
    await expect(mcp.kit.choice(handle)).resolves.toBe("none");
  }
});

it("does not ask a control whose plugin is no longer running", async () => {
  const { mcp, install, status } = setup();
  const asked: Agent[] = [];
  await install({
    choose(who) {
      asked.push(who);
      return { alpha: true };
    },
  });
  status.change({ active: false, unavailable: true });
  await expect(mcp.kit.choice(handle)).resolves.toBe("none");
  expect(asked).toEqual([]);
  status.change({ active: true, unavailable: false });
  await expect(mcp.kit.choice(handle)).resolves.toEqual({ alpha: true });
});

it("asks the registered control, and an error from it loads nothing", async () => {
  const { mcp, install } = setup();
  const asked: Agent[] = [];
  let answer: HarnessMcpControl["choose"] = () => ({ alpha: true });
  await install({
    choose(who) {
      asked.push(who);
      return answer(who);
    },
  });
  await expect(mcp.kit.choice(handle)).resolves.toEqual({ alpha: true });
  expect(asked).toEqual([agent]);
  answer = () => {
    throw new Error("control failed");
  };
  await expect(mcp.kit.choice(handle)).resolves.toBe("none");
  answer = () => undefined;
  await expect(mcp.kit.choice(handle)).resolves.toEqual({});
});

it("answers and hears only for the plugin that runs the agent, as the agent runs, and loads nothing for a protected agent", async () => {
  const { mcp, install, live, kitOf } = setup();
  const asked: Agent[] = [];
  await install({
    choose(who) {
      asked.push(who);
      return { alpha: true };
    },
  });
  const refused = "Only the plugin that runs this agent's harness";
  await expect(kitOf("other").choice(handle)).rejects.toThrow(refused);
  expect(() => kitOf("other").started(handle, "s1", [], "none")).toThrow(
    refused,
  );
  await expect(mcp.kit.choice({ key: "gone" } as never)).rejects.toThrow(
    "not running here",
  );
  expect(() =>
    mcp.kit.started({ key: "gone" } as never, "s2", [], "none"),
  ).toThrow("not running here");
  live.agent = { ...agent, protection: { provider: "p", policy: {} } } as Agent;
  await expect(mcp.kit.choice({ key } as never)).resolves.toBe("none");
  expect(asked).toEqual([]);
  expect(() =>
    mcp.kit.started({ key } as never, "s3", loaded("alpha"), { alpha: true }),
  ).toThrow(/alpha/);
  expect(() =>
    mcp.kit.started({ key } as never, "s4", [], "none"),
  ).not.toThrow();
});

it.each([
  ["it never runs", undefined, "none"],
  [
    "its control registers",
    { choose: () => ({ beta: false }) },
    { beta: false },
  ],
])(
  "waits for a declaring plugin that is still starting, then answers once %s",
  async (_name, control, expected) => {
    const { mcp, status, install } = setup();
    status.change({ unavailable: true, settled: false });
    let answer: unknown = "pending";
    const asked = mcp.kit.choice(handle).then((value) => (answer = value));
    await Promise.resolve();
    expect(answer).toBe("pending");
    if (control) await install(control);
    status.change({ unavailable: !control, settled: true });
    await asked;
    expect(answer).toEqual(expected);
  },
);

it.each([
  [
    "a server chosen on, and a tool the choice did not know of",
    { on: true, partial: { off: ["write"], known: ["read", "write"] } },
    [
      { name: "on", tools: [{ name: "write" }] },
      { name: "partial", tools: [{ name: "read" }, { name: "new" }] },
    ],
    undefined,
  ],
  ["a server chosen off", { off: false }, loaded("off"), /Session s.*off/],
  [
    "a tool the choice turned off",
    { partial: { off: ["write"], known: ["read", "write"] } },
    [{ name: "partial", tools: [{ name: "read" }, { name: "write" }] }],
    /partial/,
  ],
  ["any server when nothing may load", "none", loaded("alpha"), /alpha/],
  ["no server when nothing may load", "none", [], undefined],
  [
    "a name the choice does not own",
    { beta: false },
    loaded("constructor"),
    undefined,
  ],
  [
    "any server while the harness keeps its default",
    undefined,
    loaded("x"),
    undefined,
  ],
])("checks a session that loaded %s", (_name, choice, listing, failure) => {
  const { mcp } = setup();
  const check = () => mcp.kit.started(handle, "s", listing, choice as never);
  if (failure) expect(check).toThrow(failure);
  else expect(check).not.toThrow();
});

it("gives the control what a passing session loaded, and nothing else", async () => {
  const { mcp, install, status, live } = setup();
  const heard: unknown[][] = [];
  let failure: (() => unknown) | undefined;
  await install({
    choose: () => ({ alpha: { off: ["write"], known: ["read", "write"] } }),
    loaded(who, servers) {
      heard.push([who, servers]);
      const fail = failure;
      failure = undefined;
      return fail?.() as void;
    },
  });
  const choice = await mcp.kit.choice(handle);
  const listing = [
    {
      name: "alpha",
      state: "connected" as const,
      tools: [{ name: "read", description: "Reads" }],
    },
  ];
  mcp.kit.started(handle, "s1", listing, choice);
  expect(heard).toEqual([]);
  await Promise.resolve();
  expect(heard).toEqual([[agent, listing]]);
  expect(() =>
    mcp.kit.started(
      handle,
      "s2",
      [{ name: "alpha", tools: [{ name: "write" }] }],
      choice,
    ),
  ).toThrow(/alpha/);
  failure = () => {
    throw new Error("plugin bug");
  };
  expect(() => mcp.kit.started(handle, "s3", listing, choice)).not.toThrow();
  failure = () => Promise.reject(new Error("later"));
  expect(() => mcp.kit.started(handle, "s4", listing, choice)).not.toThrow();
  await Promise.resolve();
  expect(heard).toHaveLength(3);
  live.agent = { ...agent, protection: { provider: "p" } } as never;
  mcp.kit.started(handle, "s5", [], "none");
  live.agent = agent;
  status.change({ active: false });
  mcp.kit.started(handle, "s6", listing, choice);
  await Promise.resolve();
  expect(heard).toHaveLength(3);
});

it("takes one control, and drops it with the plugin's scope", async () => {
  const { mcp, install, status, root } = setup();
  const first = await install({ choose: () => ({ a: true }) });
  await expect(
    root
      .extend({
        pluginOwner: { id: "other", revision: "1", agentMcp: true },
      } as never)
      .plugin((ctx) => mcp.control(ctx, { choose: () => undefined }))
      .await(),
  ).rejects.toThrow("already registered");
  await expect(mcp.kit.choice(handle)).resolves.toEqual({ a: true });
  await first.dispose();
  await expect(mcp.kit.choice(handle)).resolves.toBeUndefined();
  await install({ choose: () => ({ b: true }) });
  await expect(mcp.kit.choice(handle)).resolves.toEqual({ b: true });
  status.change({ unavailable: true });
  await expect(mcp.kit.choice(handle)).resolves.toEqual({ b: true });
});

const report = (overrides: Partial<HarnessMcpReport> = {}) => ({
  tools: true,
  servers: [
    { name: "alpha", default: false },
    { name: "beta", default: false },
  ],
  ...overrides,
});

it("needs the manifest key to control, report or inspect", async () => {
  const inspected: unknown[][] = [];
  const inspect = async (...args: unknown[]) => {
    inspected.push(args);
    return [];
  };
  const { mcp, scope } = setup({
    harnessMcp: { report: async () => report(), inspect },
  });
  expect(() => mcp.control(scope(false), { choose: () => undefined })).toThrow(
    "Declare host.agentMcp",
  );
  await expect(mcp.report(scope(false), key)).rejects.toThrow(
    "Declare host.agentMcp",
  );
  await expect(mcp.inspect(scope(false), key, "alpha")).rejects.toThrow(
    "Declare host.agentMcp",
  );
  expect(inspected).toEqual([]);
});

it("gives a type with no MCP client no report", async () => {
  const { mcp, scope } = setup({ harnessMcp: { client: false } });
  await expect(mcp.report(scope(), key)).resolves.toBeUndefined();
  await expect(mcp.inspect(scope(), key, "alpha")).rejects.toThrow(
    "cannot list",
  );
});

it("passes on calls only when the type says exactly true, and never for a protected agent", async () => {
  const said = { value: true as unknown };
  const { mcp, scope, live } = setup({
    harnessMcp: {
      report: async () => report({ calls: said.value, servers: [] } as never),
    },
  });
  expect(await mcp.report(scope(), key)).toMatchObject({ calls: true });
  said.value = "yes";
  expect(await mcp.report(scope(), key)).not.toHaveProperty("calls");
  said.value = true;
  live.agent = { ...agent, protection: { key: "p" } } as never;
  expect(await mcp.report(scope(), key)).not.toHaveProperty("calls");
});

it("reports a type's servers as it lists them, and nothing for an agent that is not running", async () => {
  const servers = [
    { name: "alpha", default: false },
    { name: "beta", default: false, state: "failed", reason: "No keyring" },
  ] as const;
  const { mcp, scope } = setup({
    harnessMcp: {
      report: async () => report({ servers }),
      inspect: async () => [],
    },
  });
  await expect(mcp.report(scope(), key)).resolves.toEqual({
    inspect: true,
    tools: true,
    servers,
  });
  await expect(
    mcp.report(scope(), "unknown" as never),
  ).resolves.toBeUndefined();
});

it("lists a server's tools through the type, which rejects what it can't list", async () => {
  const inspected: unknown[][] = [];
  const inspect = async (who: Agent, server: string) => {
    inspected.push([who, server]);
    if (server === "beta") throw new Error("did not connect");
    return [{ name: "read" }];
  };
  const { mcp, scope } = setup({
    harnessMcp: { report: async () => report(), inspect },
  });
  await expect(mcp.inspect(scope(), key, "alpha")).resolves.toEqual([
    { name: "read" },
  ]);
  expect(inspected).toEqual([[agent, "alpha"]]);
  await expect(mcp.inspect(scope(), key, "beta")).rejects.toThrow(
    "did not connect",
  );
});

it("never lists tools for a protected agent, a type that cannot, or a stopped plugin", async () => {
  const inspected: unknown[][] = [];
  const inspect = async (...args: unknown[]) => {
    inspected.push(args);
    return [];
  };
  const { mcp, scope, live, status } = setup({
    harnessMcp: { report: async () => report(), inspect },
  });
  live.agent = { ...agent, protection: { provider: "p", policy: {} } } as Agent;
  await expect(mcp.inspect(scope(), key, "alpha")).rejects.toThrow("protected");
  live.agent = agent;
  status.change({ active: false });
  await expect(mcp.inspect(scope(), key, "alpha")).rejects.toThrow(
    "not running",
  );
  expect(inspected).toEqual([]);
  const plain = setup({ harnessMcp: { report: async () => report() } });
  await expect(plain.mcp.inspect(plain.scope(), key, "alpha")).rejects.toThrow(
    "cannot list",
  );
});
