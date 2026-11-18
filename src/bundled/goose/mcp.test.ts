import { describe, expect, it, vi } from "vitest";
import type { HarnessMcpAnswer } from "../../features/agents/harness-mcp";
import type { Agent } from "../../features/agents/service";
import type { Host } from "../../features/host/service";
import { gated } from "./goose-testing";
import { GooseProcess } from "./goose";
import { native, transport } from "./mcp-testing";
import { GooseMcp } from "./mcp";
import { GooseRuntime, DEFAULT_CONFIG } from "./runtime";

function present<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("Expected the protocol fixture");
  return value;
}

async function setup(initial: HarnessMcpAnswer = { fixture: true }) {
  const wire = transport();
  let choice: HarnessMcpAnswer = initial;
  const kit = {
    choice: vi.fn(async () => choice),
    started: vi.fn(),
  };
  const who = { key: "agent@example.org" };
  const mcp = new GooseMcp(kit, () => who);
  const goose = await GooseProcess.start(wire.spawn, {
    cwd: "/work",
    serve: wire.fake.serve,
    mcp,
  });
  const open = () =>
    goose.open({ cwd: "/work", systemPrompt: "", tools: async () => ({}) });
  const finish = async (session: Awaited<ReturnType<typeof open>>) => {
    const done = session.send("Fixture turn");
    await vi.waitFor(() =>
      expect(wire.fake.geese[0]?.turns.at(-1)?.sessionId).toBe(session.id),
    );
    return { done };
  };
  return {
    ...wire,
    native: present(wire.fake.geese[0]),
    kit,
    who,
    goose,
    mcp,
    open,
    finish,
    choose: (next: HarnessMcpAnswer) => {
      choice = next;
    },
  };
}

describe("Goose native MCP sessions", () => {
  it.each([
    { kind: "owner", names: ["developer", "buzz"] },
    { kind: "helper", names: [] },
    { kind: "mesh", names: ["buzz"] },
  ])(
    "keeps the no-control $kind session's native defaults",
    async ({ kind, names }) => {
      const t = await setup();
      t.choose(undefined);
      t.saved("fixture", {
        envs: { TOKEN: "fixture-secret" },
        cwd: "/private-config",
      });
      try {
        const session =
          kind === "owner"
            ? await t.open()
            : await t.goose.open({
                cwd: "/work",
                systemPrompt: "",
                ...(kind === "mesh" && {
                  platform: [],
                  tools: async () => ({}),
                }),
              });
        const { done } = await t.finish(session);
        const meta = present(t.native.opened[0])._meta as {
          enabledExtensions: { name?: string; server?: { name: string } }[];
        };
        expect(
          meta.enabledExtensions.map((e) => e.server?.name ?? e.name),
        ).toEqual(names);
        expect(
          t.requests.some(
            ({ method, params }) =>
              /extensions|tools\/list|session\/set_mode/.test(method) ||
              (method === "_goose/unstable/config/read" &&
                params.key === "extensions"),
          ),
        ).toBe(false);
        expect(t.kit.started).not.toHaveBeenCalled();
        expect(t.native.env.GOOSE_MODE).toBe("auto");
        present(t.native.turns[0]).finish();
        await done;
      } finally {
        await t.goose.kill();
      }
    },
  );

  it("reports metadata without a session or startup, and marks native disabled state", async () => {
    const t = await setup();
    try {
      expect(await t.mcp.report(t.goose)).toEqual({
        tools: true,
        servers: [
          { name: "fixture", default: false },
          { name: "other", default: false, state: "disabled" },
        ],
      });
      expect(t.native.opened).toEqual([]);
    } finally {
      await t.goose.kill();
    }
  });

  it.each([{}, { summon: true, delegate: true }])(
    "keeps controlled defaults off and cannot select platform delegation with %j",
    async (choice) => {
      const t = await setup(choice);
      try {
        const session = await t.open();
        const { done } = await t.finish(session);
        const meta = present(t.native.opened[0])._meta as {
          enabledExtensions: { name?: string; server?: { name: string } }[];
        };
        expect(
          meta.enabledExtensions.map((e) => e.server?.name ?? e.name),
        ).toEqual(["developer", "buzz"]);
        expect(t.kit.started).toHaveBeenCalledWith(t.who, session.id, [], {
          fixture: false,
          other: false,
        });
        const methods = t.requests.map(({ method }) => method);
        const listing = "_goose/unstable/session/extensions/list";
        expect(methods.filter((method) => method === listing)).toHaveLength(1);
        expect(methods.indexOf(listing)).toBeLessThan(
          methods.indexOf("session/prompt"),
        );
        present(t.native.turns[0]).finish();
        await done;
      } finally {
        await t.goose.kill();
      }
    },
  );

  it.each([
    { envs: { TOKEN: "fixture-secret" } },
    { cwd: "/private-config" },
    { env: { TOKEN: "fixture-secret" } },
  ])("refuses lossy native launches and inspection with %j", async (saved) => {
    const t = await setup();
    try {
      t.saved("fixture", { name: undefined, ...saved });
      const report = await t.mcp.report(t.goose);
      expect(report.servers.find((s) => s.name === "fixture")).toMatchObject({
        default: false,
        state: "failed",
      });
      const reason = report.servers.find((s) => s.name === "fixture")?.reason;
      expect(reason).toMatch(/fixture.*can't start|can't start.*fixture/);
      expect(reason).toContain("carry over");
      expect(reason).toContain(
        "cwd" in saved ? "working directory" : "environment values",
      );
      expect(JSON.stringify(report)).not.toMatch(
        /fixture-secret|private-config|TOKEN/,
      );
      await expect(
        t.mcp.inspect(
          t.goose,
          "/work",
          "fixture",
          new AbortController().signal,
        ),
      ).rejects.toThrow(/carry over/);
      await expect(t.open()).rejects.toThrow(/carry over/);
      expect(t.native.opened).toEqual([]);
      expect(t.requests.some((r) => r.method.endsWith("extensions/add"))).toBe(
        false,
      );
    } finally {
      await t.goose.kill();
    }
  });

  it.each(["choice", "config"])(
    "refuses a lossy launch after a later %s change",
    async (source) => {
      const t = await setup({ fixture: false, other: true });
      try {
        t.saved("fixture", {
          envs: { TOKEN: "fixture-secret" },
          cwd: "/private-config",
        });
        const session = await t.open();
        const first = await t.finish(session);
        expect(t.kit.started).toHaveBeenLastCalledWith(
          t.who,
          session.id,
          [
            {
              name: "other",
              state: "connected",
              tools: [
                { name: "read_echo", description: "read_echo" },
                { name: "write_marker", description: "write_marker" },
              ],
            },
          ],
          { fixture: false, other: true },
        );
        present(t.native.turns[0]).finish();
        await first.done;
        if (source === "choice") t.choose({ fixture: true, other: true });
        else t.saved("other", { cwd: "/private-config" });
        const additions = t.requests.filter((r) =>
          r.method.endsWith("extensions/add"),
        ).length;
        let settled = false;
        const next = session.send("Turn on the lossy server").finally(() => {
          settled = true;
        });
        await vi.waitFor(() =>
          expect(settled || t.native.turns.length === 2).toBe(true),
        );
        t.native.turns[1]?.finish();
        expect((await next).ok).toBe(false);
        expect(t.native.turns).toHaveLength(1);
        expect(
          t.requests.filter((r) => r.method.endsWith("extensions/add")),
        ).toHaveLength(additions);
      } finally {
        await t.goose.kill();
      }
    },
  );

  it("updates one saved session's native tool filter and omits all-off extensions", async () => {
    const t = await setup();
    try {
      const session = await t.open();
      const first = await t.finish(session);
      expect(t.kit.started).toHaveBeenLastCalledWith(
        t.who,
        session.id,
        [
          {
            name: "fixture",
            state: "connected",
            tools: [
              { name: "read_echo", description: "read_echo" },
              { name: "write_marker", description: "write_marker" },
            ],
          },
        ],
        { fixture: true, other: false },
      );
      t.choose({
        fixture: {
          off: ["write_marker"],
          known: ["read_echo", "write_marker"],
        },
      }); // The active turn keeps its selection.
      expect(
        t.requests.filter(
          (r) => r.method === "_goose/unstable/session/extensions/add",
        ),
      ).toHaveLength(1);
      present(t.native.turns.at(-1)).finish();
      await first.done;
      const second = session.send("Next turn");
      await vi.waitFor(() => expect(t.native.turns).toHaveLength(2));
      expect(t.kit.started).toHaveBeenLastCalledWith(
        t.who,
        session.id,
        [
          {
            name: "fixture",
            state: "connected",
            tools: [{ name: "read_echo", description: "read_echo" }],
          },
        ],
        {
          fixture: {
            off: ["write_marker"],
            known: ["read_echo", "write_marker"],
          },
          other: false,
        },
      );
      present(t.native.turns.at(-1)).finish();
      await second;
      t.choose({
        fixture: {
          off: ["read_echo", "write_marker"],
          known: ["read_echo", "write_marker"],
        },
      });
      const third = session.send("All off");
      await vi.waitFor(() => expect(t.native.turns).toHaveLength(3));
      expect(t.kit.started).toHaveBeenLastCalledWith(t.who, session.id, [], {
        fixture: {
          off: ["read_echo", "write_marker"],
          known: ["read_echo", "write_marker"],
        },
        other: false,
      });
      expect(
        t.requests
          .filter((r) => r.method.endsWith("extensions/add"))
          .some(
            (r) =>
              (
                r.params.extension as {
                  available_tools?: string[];
                  name?: string;
                  server?: { name: string };
                }
              ).available_tools?.length === 0,
          ),
      ).toBe(false);
      present(t.native.turns.at(-1)).finish();
      await third;
      expect(t.native.opened).toHaveLength(1);
      expect(t.requests.some((r) => r.method.includes("permissions/set"))).toBe(
        false,
      );
    } finally {
      await t.goose.kill();
    }
  });

  it.each([
    { off: [], allowed: ["read_echo", "write_marker"] },
    { off: ["write_marker"], allowed: ["read_echo"] },
  ])(
    "uses the saved allowlist on a fresh adapter with exclusions $off",
    async ({ off, allowed }) => {
      const pick = { off, known: ["read_echo", "write_marker"] };
      const t = await setup({ fixture: pick });
      try {
        const session = await t.open();
        const { done } = await t.finish(session);
        const meta = present(t.native.opened[0])._meta as {
          enabledExtensions: {
            server?: { name: string };
            available_tools?: string[];
          }[];
        };
        expect(
          meta.enabledExtensions.find((e) => e.server?.name === "fixture"),
        ).toMatchObject({ available_tools: allowed });
        expect(t.kit.started).toHaveBeenLastCalledWith(
          t.who,
          session.id,
          [
            {
              name: "fixture",
              state: "connected",
              tools: allowed.map((name) => ({ name, description: name })),
            },
          ],
          { fixture: pick, other: false },
        );
        expect(
          t.requests.some(({ method }) => method === "session/set_mode"),
        ).toBe(false);
        present(t.native.turns[0]).finish();
        await done;
      } finally {
        await t.goose.kill();
      }
    },
  );

  it("does not prompt when readback is rejected or an abort follows the check", async () => {
    for (const abort of [false, true]) {
      const t = await setup();
      try {
        const session = await t.open();
        t.kit.started.mockImplementation(() => {
          if (abort) session.interrupt();
          else throw new Error("MCP mismatch");
        });
        const result = await session.send("Blocked");
        expect(t.native.turns).toHaveLength(0);
        expect(result.ok).toBe(false);
        expect(t.native.closed).toContain(session.id);
      } finally {
        await t.goose.kill();
      }
    }
  });
});

function inspector(wire: ReturnType<typeof transport>, spawn = wire.spawn) {
  const kit = { choice: async () => undefined, started: vi.fn() };
  const host = {
    spawn,
    resolveDirectory: wire.fake.resolveDirectory,
    readFile: vi.fn(),
    serveMcp: wire.fake.serve,
  } as unknown as Host;
  const storage = {
    getItem: () => null,
    setItem: () => {},
  } as unknown as Storage;
  const runtime = new GooseRuntime(
    host,
    () => undefined,
    async () => undefined,
    storage,
    () => [],
    () => "",
    undefined,
    undefined,
    kit,
  );
  const agent = {
    key: "agent@example.org",
    config: { ...DEFAULT_CONFIG, workspace: "/project/fixture" },
  } as Agent;
  return { runtime, agent };
}

describe("Goose tools-only lifecycle", () => {
  it.each(["listed", "error", "cancelled", "cancelled while opening"] as const)(
    "deletes and stops an isolated inspection after %s",
    async (outcome) => {
      const wire = transport();
      const opening = gated("session/new");
      const { runtime, agent } = inspector(
        wire,
        outcome === "cancelled while opening"
          ? opening.wrap(wire.spawn)
          : wire.spawn,
      );
      let listed!: () => void;
      const started = new Promise<void>((resolve) => {
        listed = resolve;
      });
      if (outcome === "listed") {
        wire.permission("write_marker", "always_allow");
        wire.permission("read_echo", "ask_before");
      }
      if (outcome === "error") wire.failTools();
      if (outcome === "cancelled") wire.holdTools(listed);
      const inspect = runtime.inspectMcp(agent, "fixture");
      try {
        if (outcome === "listed") {
          expect(await inspect).toEqual([
            { name: "read_echo", description: "read_echo" },
            { name: "write_marker", description: "write_marker" },
          ]);
        } else {
          const rejected = expect(inspect).rejects.toThrow(
            outcome === "error" ? "Tool listing failed" : "agent was retired",
          );
          if (outcome === "cancelled") {
            await started;
            await runtime.retire(agent.key);
          }
          if (outcome === "cancelled while opening") {
            await vi.waitFor(() => expect(opening.waiting()).toHaveLength(1));
            const retiring = runtime.retire(agent.key);
            opening.release();
            await retiring;
          }
          await rejected;
        }
        const goose = present(wire.fake.geese[0]);
        expect(goose.deleted).toEqual(["session-1"]);
        expect(goose.killed).toBe(true);
        expect(goose.turns).toHaveLength(0);
        expect(goose.opened[0]).toMatchObject({
          cwd: "/project/fixture",
          mcpServers: [],
          _meta: { enabledExtensions: [native("fixture")], hidden: true },
        });
      } finally {
        opening.release();
        runtime.dispose();
      }
    },
  );
  it.each(["spawn", "opening", "tools"] as const)(
    "waits for a cancelled inspection's actual exit during retirement (%s)",
    async (stage) => {
      vi.useFakeTimers();
      const wire = transport();
      let requested!: () => void;
      const stopped = new Promise<void>((resolve) => {
        requested = resolve;
      });
      const requestStop = vi.fn(requested);
      let spawned!: () => void;
      const spawning = new Promise<void>((resolve) => {
        spawned = resolve;
      });
      let release!: () => void;
      const held = new Promise<void>((resolve) => {
        release = resolve;
      });
      let listed!: () => void;
      const listing = new Promise<void>((resolve) => {
        listed = resolve;
      });
      wire.holdTools(listed);
      const opening = gated("session/new");
      const spawn = stage === "opening" ? opening.wrap(wire.spawn) : wire.spawn;
      const { runtime, agent } = inspector(wire, async (id, options) => {
        const process = await spawn(id, options);
        spawned();
        if (stage === "spawn") await held;
        return {
          ...process,
          kill: async () => requestStop(),
        };
      });
      let retiring: Promise<void> | undefined;
      const inspection = runtime.inspectMcp(agent, "fixture");
      const rejected = inspection.then(
        () => undefined,
        (error: unknown) => error,
      );
      let retired = false;
      try {
        if (stage === "opening")
          await vi.waitFor(() => expect(opening.waiting()).toHaveLength(1));
        else await (stage === "spawn" ? spawning : listing);
        retiring = runtime.retire(agent.key).then(() => {
          retired = true;
        });
        if (stage === "opening") {
          await vi.advanceTimersByTimeAsync(0);
          expect(requestStop).not.toHaveBeenCalled();
        }
        // Passing the old stop timeout is not evidence that the process exited.
        await vi.advanceTimersByTimeAsync(6_000);
        if (stage === "opening") expect(requestStop).toHaveBeenCalled();
        expect(retired).toBe(false);
        release();
        await stopped;
        await vi.advanceTimersByTimeAsync(0);
        expect(retired).toBe(false);
        present(wire.fake.geese[0]).exit(null);
        expect(await rejected).toBeInstanceOf(Error);
        await retiring;
        expect(retired).toBe(true);
      } finally {
        release();
        wire.fake.geese[0]?.exit(null);
        opening.release();
        await inspection.catch(() => undefined);
        await retiring;
        runtime.dispose();
        vi.useRealTimers();
      }
    },
  );

  it("retains a failed inspection cleanup for retirement to retry", async () => {
    const wire = transport();
    let fail = true;
    const kill = vi.fn(async () => {
      if (fail) throw new Error("Native stop failed");
      present(wire.fake.geese[0]).exit(null);
    });
    const { runtime, agent } = inspector(wire, async (id, options) => ({
      ...(await wire.spawn(id, options)),
      kill,
    }));
    try {
      await expect(runtime.inspectMcp(agent, "fixture")).rejects.toThrow(
        "Native stop failed",
      );
      await expect(runtime.retire(agent.key)).rejects.toThrow(
        "Native stop failed",
      );
      fail = false;
      await runtime.retire(agent.key);
      expect(kill).toHaveBeenCalledTimes(3);
    } finally {
      wire.fake.geese[0]?.exit(null);
      runtime.dispose();
    }
  });
});
