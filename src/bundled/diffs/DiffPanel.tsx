import { useReaderMessage } from "../../features/messages/DetailsReader";
import { usePanelTabTitle } from "../../features/panels/PanelWorkspace";
import type { PanelProps } from "../../features/panels/service";
import { useRelayConnection } from "../../features/relay/react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import { DiffReader, diffTargetMessage, useDiff } from "./DiffMessage";

/** A diff message read whole, in a sheet or a tab: drawn from its id, so it
 * outlives the row that opened it and a channel switch. */
export function DiffPanel({
  relay,
  target,
  context,
}: PanelProps & { relay: RelayData }) {
  const { session } = useRelayConnection(relay);
  const messageId = diffTargetMessage(target);
  const channelId = context?.channelId;
  if (!session || !messageId || !channelId) return null;
  return (
    <DiffPanelBody
      session={session}
      channelId={channelId}
      messageId={messageId}
    />
  );
}

function DiffPanelBody({
  session,
  channelId,
  messageId,
}: {
  session: RelaySession;
  channelId: string;
  messageId: string;
}) {
  const message = useReaderMessage(session, channelId, messageId);
  const diff = useDiff(message);
  usePanelTabTitle(diff?.title ?? "Code diff");
  if (!diff) return null;
  return <DiffReader viewer={diff.viewer} warning={diff.warning} />;
}
