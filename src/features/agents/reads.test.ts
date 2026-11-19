import { finalizeEvent, getPublicKey } from "nostr-tools";
import { afterEach, describe, expect, it, vi } from "vitest";
import { matchesEvent } from "../relay/projection";
import type { RelayData, RelaySnapshot } from "../relay/service";
import { createRelaySession } from "../relay/session";
import { ownerReads, readyOwnerReads } from "./reads";

const owner = "a".repeat(64);
const agent = { relay: "wss://relay.example", owner, pubkey: "b".repeat(64) };
const ready = (session: object, over: Partial<RelaySnapshot> = {}) =>
  ({
    status: "ready",
    generation: 1,
    origin: "https://relay.example",
    viewer: owner,
    scope: `https://relay.example:${owner}`,
    session,
    ...over,
  }) as unknown as RelaySnapshot;
const connecting = { status: "connecting", generation: 2 } as RelaySnapshot;

/** A community connection whose snapshot the test publishes. */
function community(first: RelaySnapshot) {
  let snapshot = first;
  const listeners = new Set<() => void>();
  const relay = {
    snapshot: () => snapshot,
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as unknown as RelayData;
  return {
    relay,
    listeners,
    publish(next: RelaySnapshot) {
      snapshot = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

/** A session listing `channels`, which the test relists. */
function session(
  channels: { id: string; channelType?: string }[] = [],
  status = "ready",
) {
  const listeners = new Set<() => void>();
  return {
    workflowAuthority: "c".repeat(64),
    listeners,
    channels: {
      list: () => ({ status, channels }),
      subscribeList: (listener: () => void) => {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    relist(next = channels) {
      status = "ready";
      channels = next;
      for (const listener of [...listeners]) listener();
    },
  };
}

const lost =
  "Workflow request could not start: its community is no longer connected.";

describe("readyOwnerReads", () => {
  it.each([
    ["connecting", connecting],
    ["a cached snapshot", ready(session(), { cached: true })],
  ])(
    "waits through %s for the replacement session's channel list",
    async (_name, first) => {
      const c = community(first);
      const reads = readyOwnerReads(
        c.relay,
        agent,
        new AbortController().signal,
      );
      const settled = vi.fn();
      void reads.then(settled);
      const replacement = session([], "loading");
      c.publish(ready(replacement, { generation: 3 }));
      await Promise.resolve();
      expect(settled).not.toHaveBeenCalled();
      replacement.relist();
      expect((await reads).connection).toBe(replacement);
      expect((await reads).workflowAuthority()).toBe("c".repeat(64));
      expect(replacement.listeners.size).toBe(0);
      expect(c.listeners.size).toBe(0);
    },
  );

  it.each([
    [
      "a disconnect",
      { ...connecting, status: "disconnected" } as RelaySnapshot,
    ],
    [
      "another community",
      ready(session(), {
        origin: "https://other.example",
        scope: `https://other.example:${owner}`,
      }),
    ],
  ])("rejects after %s", async (_name, next) => {
    const c = community(connecting);
    const reads = readyOwnerReads(c.relay, agent, new AbortController().signal);
    c.publish(next);
    await expect(reads).rejects.toThrow(lost);
    expect(c.listeners.size).toBe(0);
  });

  it("rejects on the deadline and stops listening", async () => {
    const c = community(connecting);
    const deadline = new AbortController();
    const reads = readyOwnerReads(c.relay, agent, deadline.signal);
    deadline.abort(new DOMException("timed out", "TimeoutError"));
    await expect(reads).rejects.toThrow(
      "Workflow request could not start: its community did not reconnect before the delivery deadline.",
    );
    expect(c.listeners.size).toBe(0);
  });

  it("waits until the destination is listed and typed", async () => {
    const first = session();
    const c = community(ready(first));
    const settled = vi.fn();
    const reads = readyOwnerReads(
      c.relay,
      agent,
      new AbortController().signal,
      "dm",
    );
    void reads.then(settled);
    first.relist([{ id: "dm" }]);
    await Promise.resolve();
    expect(settled).not.toHaveBeenCalled();
    first.relist([{ id: "dm", channelType: "dm" }]);
    expect((await reads).connection).toBe(first);
    expect(first.listeners.size).toBe(0);
  });

  it("finds a destination the list lacks through the session's get", async () => {
    const live = session();
    const get = vi.fn(() => ({ id: "dm", channelType: "dm" }));
    Object.assign(live.channels, { get });
    const reads = readyOwnerReads(
      community(ready(live)).relay,
      agent,
      new AbortController().signal,
      "dm",
    );
    expect((await reads).connection).toBe(live);
    expect(get).toHaveBeenCalledWith("dm");
  });
});

describe("an agent's Viewing-only channels", () => {
  // The desktop app reads an agent's channels through its owner's session, so
  // the session's own role there is the owner's, not the agent's.
  const relayKey = new Uint8Array(32).fill(3);
  const author = getPublicKey(relayKey);
  const owner = getPublicKey(new Uint8Array(32).fill(2));
  const agent = getPublicKey(new Uint8Array(32).fill(4));
  const id = "11111111-1111-4111-8111-111111111111";
  const stops: (() => void)[] = [];
  afterEach(() => {
    for (const stop of stops.splice(0)) stop();
  });

  async function reads(ownerRole: string, agentRole: string) {
    let clock = 100;
    const record = (kind: number, tags: string[][]) =>
      finalizeEvent({ kind, tags, content: "", created_at: clock++ }, relayKey);
    const roster = (role: string) =>
      record(39002, [
        ["d", id],
        ["p", owner, "", ownerRole],
        ["p", agent, "", role],
      ]);
    let events = [
      record(39000, [
        ["d", id],
        ["t", "stream"],
        ["private"],
        ["name", "foo-3"],
      ]),
      record(39001, [
        ["d", id],
        ...(ownerRole === "owner" ? [["p", owner, "owner"]] : []),
      ]),
      roster(agentRole),
    ];
    const sessionOwner = createRelaySession({
      viewer: owner,
      relayAuthor: author,
      media: () => undefined,
      query: async (filters) =>
        events.filter((event) =>
          filters.some((filter) => matchesEvent(event, filter)),
        ),
    });
    stops.push(sessionOwner.dispose);
    const { session } = sessionOwner;
    session.channels.ensureList();
    await vi.waitFor(() =>
      expect(session.channels.list().status).toBe("ready"),
    );
    const relay = {
      snapshot: () => ({ status: "ready", session, scope: "test" }),
    } as unknown as RelayData;
    const source = ownerReads(relay, agent);
    if (!source) throw new Error("Owner reads unavailable");
    return Object.assign(Object.create(source) as typeof source, {
      /** The relay's roster now gives the agent `role`, and the owner rereads it. */
      async change(role: string) {
        events = [
          ...events.filter((event) => event.kind !== 39002),
          roster(role),
        ];
        await session.memberAdministration.refresh(id);
      },
    });
  }

  it("marks a channel viewing-only by the agent's role, not the owner's", async () => {
    const facts = await (await reads("owner", "guest")).channel(id);
    expect(facts?.viewingOnly).toBe(true);
  });

  it("doesn't mark the agent viewing-only when only its owner is a guest", async () => {
    const facts = await (await reads("guest", "member")).channel(id);
    expect(facts).toBeDefined();
    expect(facts?.viewingOnly).toBeUndefined();
  });

  it("follows a role change that keeps the agent in the channel", async () => {
    const source = await reads("owner", "guest");
    expect((await source.channel(id))?.viewingOnly).toBe(true);
    // Guest to member: the same members, so only the roles tell them apart.
    await source.change("bot");
    expect((await source.channel(id))?.viewingOnly).toBeUndefined();
  });
});
