// Voice jump: what someone says picks one place to go among the channels,
// DMs, agent chats and threads this device already holds in memory. Nothing
// is read from the relay; the decision provider (Jev) chooses among them.
import type { DecisionFailure, Decisions } from "../decisions/service";
import type { ChannelSummary, ChannelWindow } from "../relay/contracts";
import type { InboxItem } from "../relay/inbox";
import { messagePreviewText } from "../conversation/message-preview-text";

/** Goes to the likeliest place at or above this probability. */
export const VOICE_JUMP_THRESHOLD = 0.5;
/** The most places Jev chooses among (a choice allows 255 options). */
const MAX_PLACES = 200;
/** Places, most recent first, that also carry their messages. */
const DETAILED_PLACES = 40;
/** Threads, most recent first. */
const MAX_THREADS = 40;
const RECENT_MESSAGES = 3;
const TEXT_LIMIT = 160;
const NONE = "none";

export type JumpKind = "channel" | "dm" | "chat" | "thread";

export type JumpPlace = Readonly<{
  key: string;
  kind: JumpKind;
  channelId: string;
  /** A thread's root message. */
  rootId?: string;
  name: string;
  /** Where a thread is: its conversation's name. */
  in?: string;
  about?: string;
  first?: string;
  recent?: readonly string[];
  at: number;
}>;

export type JumpSources = Readonly<{
  channels: readonly ChannelSummary[];
  /** A conversation's display name: a DM's is its other people. */
  name: (channel: ChannelSummary) => string;
  /** The messages this device holds for a conversation; never reads. */
  window: (channelId: string) => ChannelWindow;
  /** Activity rows, for threads not otherwise in memory. */
  activity: readonly InboxItem[];
  author: (pubkey: string, channel: ChannelSummary) => string;
}>;

const clip = (text: string) => {
  const line = messagePreviewText(text).replace(/\s+/g, " ").trim();
  return line.length > TEXT_LIMIT ? `${line.slice(0, TEXT_LIMIT - 1)}…` : line;
};

const kindOf = (channel: ChannelSummary): JumpKind | undefined =>
  channel.channelType === "dm"
    ? "dm"
    : channel.channelType === "solo"
      ? "chat"
      : channel.channelType === "system"
        ? undefined
        : "channel";

/** Every place a spoken request may name, most recently active first. */
export function jumpPlaces(sources: JumpSources): JumpPlace[] {
  const conversations: JumpPlace[] = [];
  const threads = new Map<string, JumpPlace>();
  const byId = new Map<string, ChannelSummary>();
  for (const channel of sources.channels) {
    const kind = kindOf(channel);
    if (!kind || channel.archived || channel.hidden) continue;
    byId.set(channel.id, channel);
    const name = sources.name(channel);
    const history = sources.window(channel.id);
    const rows = history.rows.filter(
      (row) => row.content.trim() && !row.membership,
    );
    const said = (row: (typeof rows)[number]) =>
      `${sources.author(row.workflowOwnerId ?? row.authorId, channel)}: ${clip(row.content)}`;
    const top = rows.filter((row) => !row.threadRootId);
    const last = rows.at(-1)?.createdAt ?? 0;
    const at = Math.max(channel.lastActivityAt ?? 0, last);
    const recent = top.slice(-RECENT_MESSAGES).map(said);
    const first = !history.hasMore && top[0] ? said(top[0]) : undefined;
    conversations.push({
      key: `${kind}:${channel.id}`,
      kind,
      channelId: channel.id,
      name,
      ...(channel.description?.trim()
        ? { about: clip(channel.description) }
        : {}),
      ...(first && !recent.includes(first) ? { first } : {}),
      ...(recent.length
        ? { recent }
        : channel.preview?.trim()
          ? { recent: [clip(channel.preview)] }
          : {}),
      at,
    });
    for (const row of top) {
      if (!row.replyCount) continue;
      threads.set(row.id, {
        key: `thread:${row.id}`,
        kind: "thread",
        channelId: channel.id,
        rootId: row.id,
        name: said(row),
        in: name,
        at: row.createdAt,
      });
    }
  }
  for (const item of sources.activity) {
    const channel = byId.get(item.channelId);
    if (!item.thread || !item.rootId || !channel || threads.has(item.rootId))
      continue;
    threads.set(item.rootId, {
      key: `thread:${item.rootId}`,
      kind: "thread",
      channelId: item.channelId,
      rootId: item.rootId,
      name: item.preview.trim()
        ? `Latest reply, ${sources.author(item.workflowOwnerId ?? item.authorId, channel)}: ${clip(item.preview)}`
        : "A thread",
      in: sources.name(channel),
      at: item.createdAt,
    });
  }
  const recentFirst = (a: JumpPlace, b: JumpPlace) => b.at - a.at;
  conversations.sort(recentFirst);
  const detailed = conversations.map((place, index) =>
    index < DETAILED_PLACES
      ? place
      : {
          key: place.key,
          kind: place.kind,
          channelId: place.channelId,
          name: place.name,
          at: place.at,
        },
  );
  const recentThreads = [...threads.values()]
    .sort(recentFirst)
    .slice(0, MAX_THREADS);
  return [...detailed, ...recentThreads].slice(0, MAX_PLACES);
}

export type VoiceJump =
  | Readonly<{ outcome: "found"; place: JumpPlace; probability: number }>
  /** No place is likely enough. */
  | Readonly<{ outcome: "none" }>
  | Readonly<{ outcome: "failed"; reason: DecisionFailure }>;

/** The place the spoken request asked for, when one is likely enough. */
export async function pickPlace(
  decisions: Decisions,
  spoken: string,
  places: readonly JumpPlace[],
  community: string | undefined,
  threshold = VOICE_JUMP_THRESHOLD,
): Promise<VoiceJump> {
  if (!spoken.trim() || !places.length) return { outcome: "none" };
  const options: Record<string, string> = {};
  places.forEach((_, index) => {
    options[`p${index}`] = `Go to \`places[${index}]\`.`;
  });
  options[NONE] = "None of the places is the one the person asked for.";
  const result = await decisions.decide({
    state: JSON.stringify({
      spoken_request: spoken,
      places: places.map(({ kind, name, in: where, about, first, recent }) => ({
        kind,
        name,
        ...(where ? { in: where } : {}),
        ...(about ? { about } : {}),
        ...(first ? { first_message: first } : {}),
        ...(recent ? { recent_messages: recent } : {}),
      })),
    }),
    questions: {
      place: {
        type: "choice",
        instructions:
          "A person said `spoken_request` aloud to jump to a place in a workplace chat app. It is a speech transcript, so names may be misheard or spelled phonetically. `places` are what they can go to, most recently active first: a `channel`, a `dm` (named by the other people in it), an agent `chat`, or a `thread` (named by its first message, `in` its conversation). Which place did they ask to go to? A place whose name matches what they said beats one whose messages only mention it. Pick a thread only when they asked for a thread or a specific discussion. Pick none when no place plainly fits.",
        options,
      },
    },
    timeoutMs: 8_000,
    ...(community ? { community } : {}),
  });
  if (result.outcome !== "answered")
    return { outcome: "failed", reason: result.reason };
  const answer = result.answers.place;
  if (answer?.type !== "choice" || answer.choice === NONE)
    return { outcome: "none" };
  const probability =
    answer.probabilities[answer.choice] ?? answer.confidence ?? 0;
  const place = places[Number(answer.choice.slice(1))];
  if (!place || probability < threshold) return { outcome: "none" };
  return { outcome: "found", place, probability };
}
