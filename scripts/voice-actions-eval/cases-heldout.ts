// Held-out cases: written after the instruction wording was tuned on
// `cases.ts`, with new phrasings and channels, people and messages the tuned
// cases don't use. Never tune against these; report them separately
// (`--set heldout`).
import type { Case, Category, Expected } from "./cases";

const act = (
  action: string,
  owner?: string,
  target?: string,
  text?: string,
): Expected => ({
  action,
  ...(owner ? { owner } : {}),
  ...(target ? { target } : {}),
  ...(text ? { text } : {}),
});
const go = (navigate: string): Expected => ({ navigate });
const none: Expected = { none: true };

type Row = [Category, string | null, string, Expected];

const ROWS: Row[] = [
  [
    "forward",
    "message:m-deploy",
    "react with the rocket",
    act("message.react", "m-deploy", "e-rocket"),
  ],
  [
    "forward",
    "message:m-deploy",
    "hundred points",
    act("message.react", "m-deploy", "e-100"),
  ],
  [
    "forward",
    "message:m-lunch",
    "put a laughing face on it",
    act("message.react", "m-lunch", "e-laughing"),
  ],
  [
    "forward",
    "#goose",
    "stop notifications from this channel",
    act("channel.mute", "c-goose"),
  ],
  ["forward", "#legal", "favorite this one", act("channel.star", "c-legal")],
  [
    "forward",
    "message:m-lunch",
    "keep me posted on replies here",
    act("message.follow", "m-lunch"),
  ],
  [
    "forward",
    "message:m-deploy",
    "get me a link to this",
    act("message.copy_link", "m-deploy"),
  ],
  [
    "forward",
    "#finance",
    "I'm done with this channel, leave it",
    act("channel.leave", "c-finance"),
  ],

  [
    "reverse",
    "section:Later",
    "stick goose releases in this section",
    act("channel.move_to_section", "c-goose-releases", "s-Later"),
  ],
  [
    "reverse",
    "section:Projects",
    "file the plugins channel under this",
    act("channel.move_to_section", "c-plugins", "s-Projects"),
  ],
  [
    "reverse",
    "person:Jonas",
    "bring him into relay perf",
    act("channel.add_member", "c-relay-perf", "p-jonas"),
  ],
  [
    "reverse",
    "person:Fizz",
    "add this agent to the agents channel",
    act("channel.add_member", "c-agents", "p-fizz"),
  ],
  [
    "reverse",
    "section:Starred",
    "star builderbot",
    act("channel.star", "c-builderbot"),
  ],

  [
    "navigate",
    "message:m-lunch",
    "open the analytics channel",
    go("channel:c-analytics"),
  ],
  ["navigate", "#pets", "go to my chat with Honey", go("chat:d-Honey")],
  [
    "navigate",
    "section:Social",
    "take me to the IT help channel",
    go("channel:c-it-help"),
  ],
  ["navigate", null, "show me the DM with Arjun", go("dm:d-Arjun")],
  [
    "navigate",
    "person:Jonas",
    "jump to builderlab",
    go("channel:c-builderlab"),
  ],

  [
    "ambiguity",
    "#goose",
    "move goose releases next to this",
    act("channel.move_next_to", "c-goose-releases", "c-goose"),
  ],
  [
    "ambiguity",
    "#product",
    "put this next to engineering",
    act("channel.move_next_to", "c-product", "c-engineering"),
  ],
  [
    "ambiguity",
    "#legal",
    "slide finance over beside this one",
    act("channel.move_next_to", "c-finance", "c-legal"),
  ],
  [
    "ambiguity",
    "#builderlab",
    "move this so it sits next to builderbot",
    act("channel.move_next_to", "c-builderlab", "c-builderbot"),
  ],

  [
    "new-name",
    null,
    "make me a section named launch week",
    act("section.create", undefined, undefined, "Launch Week"),
  ],
  [
    "new-name",
    "section:Agents",
    "rename this one to bots",
    act("section.rename", "s-Agents", undefined, "Bots"),
  ],
  [
    "new-name",
    "#docs",
    "start a new section called writing",
    act("section.create", undefined, undefined, "Writing"),
  ],

  [
    "stt",
    "message:m-deploy",
    "send this to drone oh one",
    act("message.forward_to_person", "m-deploy", "p-drone01"),
  ],
  [
    "stt",
    null,
    "take me to the build her lab channel",
    go("channel:c-builderlab"),
  ],
  [
    "stt",
    "message:m-lunch",
    "forward this to sam reviera",
    act("message.forward_to_person", "m-lunch", "p-sam"),
  ],
  [
    "stt",
    "person:Kenji",
    "add him to the goose release channel",
    act("channel.add_member", "c-goose-releases", "p-kenji"),
  ],
  [
    "stt",
    "message:m-deploy",
    "share this with the relay purr channel",
    act("message.forward_to_channel", "m-deploy", "c-relay-perf"),
  ],

  ["none", "message:m-deploy", "how many people saw this", none],
  ["none", "#product", "undo that", none],

  ["global", null, "clear all my unreads", act("community.mark_all_read")],

  // Nothing hovered, with every global and named action offered at once:
  // the longest action list the app sends.
  [
    "no-hover",
    null,
    "only show unreads in work",
    act("section.filter_unreads.named", undefined, "s-Work"),
  ],
  [
    "no-hover",
    null,
    "show everything in projects",
    act("section.filter_all.named", undefined, "s-Projects"),
  ],
  [
    "no-hover",
    null,
    "collapse the social section",
    act("section.collapse.named", undefined, "s-Social"),
  ],
  [
    "no-hover",
    null,
    "expand oncall",
    act("section.expand.named", undefined, "s-Oncall"),
  ],
  ["no-hover", null, "set me to away", act("self.set_away")],
  ["no-hover", null, "I'm back", act("self.set_active")],
  ["no-hover", null, "appear offline", act("self.set_offline")],
  [
    "no-hover",
    null,
    "show Priya's profile",
    act("person.profile.named", undefined, "p-priya"),
  ],
  [
    "no-hover",
    null,
    "message Jonas",
    act("person.dm.named", undefined, "p-jonas"),
  ],
  ["no-hover", null, "go to the legal channel", go("channel:c-legal")],
  [
    "no-hover",
    null,
    "catch me up, mark it all read",
    act("community.mark_all_read"),
  ],
];

export const HELDOUT: readonly Case[] = ROWS.map(
  ([category, hover, spoken, expect], i) => ({
    id: `heldout-${category}-${String(i + 1).padStart(3, "0")}`,
    category,
    hover,
    spoken,
    expect,
  }),
);
