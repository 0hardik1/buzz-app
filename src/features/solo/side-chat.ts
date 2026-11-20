import type { ChannelMessage } from "../relay/contracts";
import type { RelaySession } from "../relay/session";
import { ownedSoloAgents } from "../relay/solo-admins";
import { messageCopyLink } from "../messages/message-copy";
import type { MentionDraft } from "../messages/mention-draft";
import { readView, writeView } from "../../shared/view-state";
import { startingChatTitle } from "./chat-title";
import { draftLifetime } from "./default-lifetime";

/** The thread a side chat answers, saved on the device that asked in it. */
export type SideChatSource = { channelId: string; rootId: string };
export const sideChatSourceKey = (chatId: string) => `solo:side:${chatId}`;
export function readSideChatSource(
  scope: string,
  chatId: string,
): SideChatSource | undefined {
  const value = readView<Partial<SideChatSource> | null>(
    scope,
    sideChatSourceKey(chatId),
    null,
  );
  return typeof value?.channelId === "string" &&
    typeof value.rootId === "string"
    ? { channelId: value.channelId, rootId: value.rootId }
    : undefined;
}

const escaped = (text: string) => text.replace(/[\\[\]]/g, "\\$&");
/** The thread's one-line note: a link to the chat, tagging nobody. */
export const sideChatMarker = (asker: string, agent: string, chatId: string) =>
  `[${escaped(`${asker} is asking ${agent} →`)}](buzz://channel/${encodeURIComponent(chatId)})`;
const MARKER_LINK = /\]\(buzz:\/\/channel\/([^)\s]+)\)$/;

/** The open chat of yours with `agent` that your latest marker here links.
 * The markers are the thread's own record, so this holds across restarts
 * and devices. */
export function threadSideChat(
  session: RelaySession,
  rows: readonly ChannelMessage[],
  agent: string,
) {
  const viewer = session.viewer;
  if (!viewer) return;
  const chats = session.channels.list().channels;
  for (const row of [...rows].reverse()) {
    if (row.authorId !== viewer || row.mentions.length) continue;
    const id = MARKER_LINK.exec(row.content)?.[1];
    const chat =
      id &&
      chats.find(
        (item) =>
          item.id === decodeURIComponent(id) &&
          item.channelType === "solo" &&
          !item.archived &&
          !item.readOnly &&
          item.members?.includes(viewer) &&
          item.members.includes(agent),
      );
    if (chat) return chat.id;
  }
}

/** One of your agents, when it is the only one this draft tags. */
async function soleAgent(session: RelaySession, draft: MentionDraft) {
  const tagged = [...new Set(draft.recipients.map((item) => item.pubkey))];
  const recipient = draft.recipients[0];
  if (tagged.length !== 1 || !recipient) return;
  const mine = () =>
    session.agentChoices
      .snapshot()
      .selectable.some((agent) => agent.pubkey === recipient.pubkey);
  if (!mine() && !session.agentChoices.snapshot().complete)
    await session.agentChoices.refresh();
  return mine() ? recipient : undefined;
}

/**
 * Asks your one tagged agent in a private side chat instead of the thread.
 * The message carries a link to the thread message it replies to. The first
 * ask starts the chat and leaves the marker; later ones reuse it. Resolves
 * the chat, or undefined when the draft is not for a side chat.
 */
export async function askInSideChat(
  session: RelaySession,
  scope: string,
  {
    draft,
    content,
    replyTo,
    rootId,
    rows,
    asker,
  }: {
    draft: MentionDraft;
    content: string;
    /** The thread message being replied to. */
    replyTo: ChannelMessage;
    rootId: string;
    rows: readonly ChannelMessage[];
    asker: string;
  },
) {
  const agent = await soleAgent(session, draft);
  const link = messageCopyLink(replyTo, scope);
  if (!agent || !link) return;
  const text = `${content}\n\n${link}`;
  let chatId = threadSideChat(session, rows, agent.pubkey);
  if (chatId) session.messages.send(chatId, text, [agent.pubkey]);
  else {
    chatId = crypto.randomUUID();
    const admins = await ownedSoloAgents(session.profiles, session.viewer, [
      agent.pubkey,
    ]);
    const { ready } = session.channelWrites.start(
      chatId,
      startingChatTitle(draft),
      [agent.pubkey],
      draftLifetime(scope, {}),
      false,
      undefined,
      { admins: [...admins] },
    );
    session.messages.send(chatId, text, [agent.pubkey]);
    // A chat the relay refused takes its message with it; the draft stays.
    await ready;
    session.messages.reply(
      replyTo.channelId,
      rootId,
      sideChatMarker(asker, agent.name, chatId),
    );
  }
  writeView(scope, sideChatSourceKey(chatId), {
    channelId: replyTo.channelId,
    rootId,
  });
  return chatId;
}
