import { expect, it } from "vitest";
import { DiscoveryState } from "./discovery";
import { keypair, metadata, signed } from "./testing";

const relay = keypair(),
  viewer = keypair();
const id = "00000000-0000-8000-8000-00000000000a";
const conversation = (time = 1) =>
  metadata(relay, id, "Comments", time, [
    ["private"],
    ["t", "artifact"],
    ["parent", "home"],
  ]);
const roster = (role: string, time: number) =>
  signed(relay, {
    kind: 39002,
    content: "",
    created_at: time,
    tags: [
      ["d", id],
      ["p", viewer.pubkey, "", role],
    ],
  });
const known = () => {
  const state = new DiscoveryState(viewer.pubkey, relay.pubkey);
  state.accept(conversation());
  state.retain(new Set(), new Map());
  return state;
};

it("reads a private conversation the relay granted, without listing it", () => {
  const state = known();
  expect(state.get(id)).toBeUndefined();
  expect(state.hold(id, { post: true, joined: false, role: "member" })).toBe(
    true,
  );
  expect(state.canAccess(id)).toBe(true);
  expect(state.canWrite(id)).toBe(true);
  expect(state.get(id)).toMatchObject({
    channelType: "artifact",
    viewerRole: "member",
    name: "Comments",
  });
  expect(state.get(id)?.readOnly).toBeUndefined();
  expect(state.channels()).toEqual([]);
  expect(state.savedEvents()).toEqual([]);
});

it("derives read-only and posting from the same answer", () => {
  const state = known();
  state.hold(id, { post: false, joined: false, role: "guest" });
  expect(state.get(id)?.readOnly).toBe(true);
  expect(state.canWrite(id)).toBe(false);
  expect(state.canParticipate(id)).toBe(false);
  expect(state.hold(id, { post: true, joined: false, role: "member" })).toBe(
    true,
  );
  expect(state.get(id)?.readOnly).toBeUndefined();
  expect(state.canWrite(id)).toBe(true);
  expect(state.hold(id, { post: true, joined: false, role: "member" })).toBe(
    false,
  );
});

it("lets the relay's answer outrank a joined member's roster role", () => {
  const state = known();
  state.accept(roster("member", 2));
  expect(state.canWrite(id)).toBe(true);
  state.hold(id, { post: false, joined: true, role: "member" });
  expect(state.canWrite(id)).toBe(false);
  expect(state.get(id)?.readOnly).toBe(true);
});

it("hides a held conversation while suspended, and a fresh answer restores it", () => {
  const state = known();
  state.hold(id, { post: true, joined: false, role: "member" });
  const revision = state.accessRevision;
  expect(state.suspend(id)).toBe(true);
  // Public metadata coming back is not the relay's answer.
  state.resume(id, conversation(2));
  expect(state.canAccess(id)).toBe(false);
  expect(state.accessRevision).toBeGreaterThan(revision);
  expect(state.canAccess(id)).toBe(false);
  expect(state.canWrite(id)).toBe(false);
  expect(state.get(id)).toBeUndefined();
  expect(state.hold(id, { post: true, joined: false, role: "member" })).toBe(
    true,
  );
  expect(state.canAccess(id)).toBe(true);
});

it("ends access on a confirmed denial, and on release without denying", () => {
  const denied = known();
  denied.hold(id, { post: true, joined: false, role: "member" });
  denied.deny(id);
  expect(denied.canAccess(id)).toBe(false);
  expect(denied.heldAccess(id)).toBeNull();

  const forgotten = known();
  forgotten.hold(id, { post: true, joined: false, role: "member" });
  expect(forgotten.release(id)).toBe(true);
  expect(forgotten.canAccess(id)).toBe(false);
  expect(forgotten.release(id)).toBe(false);
  // Forgetting is not a denial: the relay can grant it again.
  forgotten.hold(id, { post: false, joined: false });
  expect(forgotten.canAccess(id)).toBe(true);
  expect(forgotten.get(id)?.viewerRole).toBeUndefined();
});

it("leaves the viewer's other access as it was when a hold ends", () => {
  const publicId = "00000000-0000-8000-8000-00000000000b";
  const state = new DiscoveryState(viewer.pubkey, relay.pubkey);
  state.accept(metadata(relay, publicId, "Open", 1, [["public"]]));
  state.accept(conversation());
  state.accept(roster("member", 2));
  state.retain(new Set(), new Map());
  // A revoked public preview, and a member the relay then refused.
  expect(state.suspend(publicId)).toBe(true);
  state.deny(id);
  for (const held of [publicId, id]) {
    state.hold(held, { post: true, joined: false, role: "member" });
    expect(state.canAccess(held)).toBe(true);
    state.release(held);
    expect(state.canAccess(held)).toBe(false);
  }
});

it("never lists an artifact conversation, even for a member", () => {
  const state = known();
  state.accept(roster("member", 2));
  expect(state.get(id)).toMatchObject({ channelType: "artifact" });
  expect(state.channels()).toEqual([]);
});
