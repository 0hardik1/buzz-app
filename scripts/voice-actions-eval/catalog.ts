// The actions the eval offers Jev, and the workspace as the builder takes
// it. IDs follow drone01's registry where it has them (channel.star,
// channel.unstar, channel.move_to_section, message.forward_to_person,
// message.forward_to_channel); the rest are the actions drone02 and drone03
// plan to add, so the eval measures accuracy with a realistically full menu.
import type { JumpPlace } from "../../src/features/search/voice-jump";
import type { ActionDef, Entity, SlotKind, Thing } from "./draft-builder";
import {
  CHANNELS,
  EMOJI,
  MESSAGES,
  PEOPLE,
  SECTIONS,
  channel,
  message,
  person,
} from "./world";

const a = (
  id: string,
  owner: ActionDef["owner"],
  target: SlotKind | undefined,
  sentence: ActionDef["sentence"],
  confirm: ActionDef["confirm"] = "none",
  global = false,
  whenHovered?: ActionDef["whenHovered"],
): ActionDef => ({
  id,
  ...(owner ? { owner } : {}),
  ...(target ? { target } : {}),
  sentence,
  confirm,
  ...(global ? { global } : {}),
  ...(whenHovered ? { whenHovered } : {}),
});

// drone02's named forms: offered unless the hovered thing is already of
// that kind, so a hovered and a named form never both bind.
const NOT_SECTION = ["channel", "message", "person", "nothing"] as const;
const NOT_PERSON = ["channel", "message", "section", "nothing"] as const;
const named = (
  id: string,
  target: SlotKind,
  sentence: string,
  whenHovered: ActionDef["whenHovered"],
) => a(id, undefined, target, () => sentence, "none", true, whenHovered);

export const ACTIONS: readonly ActionDef[] = [
  // Channels (drone01 M1 + drone02).
  a("channel.star", "channel", undefined, (o) => `Star ${o}`),
  a("channel.unstar", "channel", undefined, (o) => `Unstar ${o}`),
  a(
    "channel.move_to_section",
    "channel",
    "section",
    (o, t) => `Move ${o} into ${t}`,
  ),
  a(
    "channel.move_next_to",
    "channel",
    "channel",
    (o, t) => `Move ${o} next to ${t} in the sidebar`,
  ),
  a("channel.mute", "channel", undefined, (o) => `Mute ${o}`),
  a("channel.mark_read", "channel", undefined, (o) => `Mark ${o} as read`),
  a("channel.leave", "channel", undefined, (o) => `Leave ${o}`, "confirm"),
  a(
    "channel.add_member",
    "channel",
    "person",
    (o, t) => `Add ${t} to ${o}`,
    "confirm",
  ),
  // Sections.
  a(
    "section.create",
    undefined,
    "text",
    () => "Create a new sidebar section with a name they say",
    "none",
    true,
  ),
  a("section.rename", "section", "text", (o) => `Rename the ${o} section`),
  a(
    "section.collapse",
    "section",
    undefined,
    (o) => `Collapse the ${o} section`,
  ),
  a(
    "section.delete",
    "section",
    undefined,
    (o) => `Delete the ${o} section`,
    "confirm",
  ),
  // Messages and threads (drone01's forward + drone03).
  a(
    "message.forward_to_person",
    "message",
    "person",
    (o, t) => `Forward ${o} to ${t}`,
    "confirm",
  ),
  a(
    "message.forward_to_channel",
    "message",
    "channel",
    (o, t) => `Forward ${o} to ${t}`,
    "confirm",
  ),
  a("message.react", "message", "emoji", (o, t) => `React to ${o} with ${t}`),
  a("message.reply", "message", undefined, (o) => `Reply in a thread to ${o}`),
  a("message.follow", "message", undefined, (o) => `Follow the thread of ${o}`),
  a(
    "message.unfollow",
    "message",
    undefined,
    (o) => `Unfollow the thread of ${o}`,
  ),
  a("message.copy_link", "message", undefined, (o) => `Copy a link to ${o}`),
  a("message.mark_unread", "message", undefined, (o) => `Mark ${o} as unread`),
  a("message.delete", "message", undefined, (o) => `Delete ${o}`, "confirm"),
  // People.
  a("person.profile", "person", undefined, (o) => `Open ${o}'s profile`),
  a("person.dm", "person", undefined, (o) => `Send ${o} a direct message`),
  // Named forms and self (drone02): the no-hover menu.
  named(
    "section.filter_unreads.named",
    "section",
    "Show only unread channels in a section",
    NOT_SECTION,
  ),
  named(
    "section.filter_all.named",
    "section",
    "Show every channel in a section",
    NOT_SECTION,
  ),
  named(
    "section.collapse.named",
    "section",
    "Collapse a sidebar section (hide its channels)",
    NOT_SECTION,
  ),
  named(
    "section.expand.named",
    "section",
    "Expand a sidebar section (show its channels)",
    NOT_SECTION,
  ),
  named(
    "person.dm.named",
    "person",
    "Send someone a direct message",
    NOT_PERSON,
  ),
  named("person.profile.named", "person", "Show someone's profile", NOT_PERSON),
  a(
    "self.set_away",
    undefined,
    undefined,
    () => "Set my availability to away",
    "none",
    true,
  ),
  a(
    "self.set_active",
    undefined,
    undefined,
    () => "Set my availability to active (I'm back)",
    "none",
    true,
  ),
  a(
    "self.set_offline",
    undefined,
    undefined,
    () => "Set my availability to appear offline",
    "none",
    true,
  ),
  // Community.
  a(
    "community.mark_all_read",
    undefined,
    undefined,
    () => "Mark everything in the community as read",
    "confirm",
    true,
  ),
];

export const CONFIRM = new Set(
  ACTIONS.filter((x) => x.confirm === "confirm").map((x) => x.id),
);

export const ENTITIES: Readonly<Partial<Record<SlotKind, readonly Entity[]>>> =
  {
    channel: CHANNELS.map((c) => ({
      key: c.id,
      option: `#${c.name}`,
      ...(c.about ? { detail: c.about } : {}),
    })),
    section: SECTIONS.map((s) => ({
      key: `s-${s}`,
      option: s,
      ...(s === "Starred" ? { detail: "Built in: starred channels" } : {}),
    })),
    person: PEOPLE.map((p) => ({
      key: p.id,
      option: p.name,
      kind: p.agent ? "agent" : "person",
    })),
    emoji: Object.entries(EMOJI).map(([name, glyph]) => ({
      key: `e-${name}`,
      option: name,
      detail: glyph,
    })),
  };

/** Jump's places, most recent first: channels, DMs and agent chats, threads,
 * capped at jump's 200. */
export const PLACES: readonly JumpPlace[] = [
  ...CHANNELS.map(
    (c, i): JumpPlace => ({
      key: `channel:${c.id}`,
      kind: "channel",
      channelId: c.id,
      name: c.name,
      // Only jump's 40 most recent places carry their details.
      ...(i < 40 && c.about ? { about: c.about } : {}),
      ...(i < 40 && c.recent ? { recent: c.recent } : {}),
      at: 1000 - i,
    }),
  ),
  ...PEOPLE.filter((p) => p.dm).map(
    (p, i): JumpPlace => ({
      key: `${p.agent ? "chat" : "dm"}:d-${p.name}`,
      kind: p.agent ? "chat" : "dm",
      channelId: `d-${p.name}`,
      name: p.name,
      at: 900 - i,
    }),
  ),
  ...MESSAGES.filter((m) => m.replies).map(
    (m, i): JumpPlace => ({
      key: `thread:${m.id}`,
      kind: "thread",
      channelId: `c-${m.channel}`,
      rootId: m.id,
      name: `${m.author}: ${m.text}`,
      in: m.channel,
      at: 800 - i,
    }),
  ),
].slice(0, 200);

/** Hover targets, by a short spec: `#name`, `section:Name`, `person:name`,
 * `message:id`, or null for nothing. */
export function hover(spec: string | null): Thing | null {
  if (spec === null) return null;
  if (spec.startsWith("#")) {
    const c = channel(spec.slice(1));
    return {
      kind: "channel",
      key: c.id,
      label: `#${c.name}`,
      ...(c.about ? { detail: c.about } : {}),
    };
  }
  const [kind, rest] = [
    spec.slice(0, spec.indexOf(":")),
    spec.slice(spec.indexOf(":") + 1),
  ];
  if (kind === "section")
    return { kind: "section", key: `s-${rest}`, label: rest };
  if (kind === "person") {
    const p = person(rest);
    return {
      kind: "person",
      key: p.id,
      label: p.name,
      detail: p.agent ? "agent" : "person",
    };
  }
  if (kind === "message") {
    const m = message(rest);
    return {
      kind: "message",
      key: m.id,
      label: `this message from ${m.author}`,
      detail: `In #${m.channel}: ${m.text}${m.replies ? ` (${m.replies} replies)` : ""}`,
    };
  }
  throw new Error(`Bad hover spec ${spec}`);
}
