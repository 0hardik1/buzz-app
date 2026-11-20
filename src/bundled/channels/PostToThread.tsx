import { useEffect, useEffectEvent, useRef } from "react";
import type { ChannelMessage } from "../../features/relay/contracts";
import type { RelaySession } from "../../features/relay/session";
import { mentionDraft } from "../../features/messages/mention-draft";
import { readSideChatSource } from "../../features/solo/side-chat";
import { readView, writeView } from "../../shared/view-state";
import { useToastNotification } from "../../shared/design-system/ui/Toast";

/** An agent's delivered message in a side chat this device asked in. */
export function canPostToThread(
  message: ChannelMessage,
  session: RelaySession,
) {
  return (
    !!session.scope &&
    message.authorId !== session.viewer &&
    (!message.delivery || ["accepted", "seen"].includes(message.delivery)) &&
    !!readSideChatSource(session.scope, message.channelId)
  );
}

/** Adds the message to the thread's draft and opens the thread, as its link
 * would. Nothing is sent: the person edits and sends it there, as themselves. */
export function PostToThread({
  message,
  session,
  open,
  close,
}: {
  message: ChannelMessage;
  session: RelaySession;
  open(target: string): boolean;
  close(): void;
}) {
  const notify = useToastNotification();
  const started = useRef(false);
  const post = useEffectEvent(() => {
    const scope = session.scope;
    const source = scope && readSideChatSource(scope, message.channelId);
    if (!scope || !source) {
      notify("The thread is unavailable.", "error");
      return;
    }
    const key = `draft:${source.channelId}:thread:${source.rootId}`;
    const { document: _, ...saved } = mentionDraft(
      readView<unknown>(scope, key, ""),
    );
    const text = saved.text.trim()
      ? `${saved.text.trimEnd()}\n\n${message.content}`
      : message.content;
    if (!writeView(scope, key, { ...saved, text })) {
      notify("The thread’s draft couldn’t be saved. Try again.", "error");
      return;
    }
    const thread = new URLSearchParams({
      channel: source.channelId,
      id: source.rootId,
    });
    if (!open(`buzz://message?${thread}`))
      notify("The thread couldn’t open. Your draft is saved there.", "error");
  });
  useEffect(() => {
    if (started.current) return;
    started.current = true;
    post();
    close();
  }, [close]);
  return null;
}
