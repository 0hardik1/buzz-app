import { reviewHistoryMember } from "./access";
import type { RelayData } from "../../features/relay/service";
import { useChannelList, useRelayConnection } from "../../features/relay/react";
import { CountBadge } from "../../shared/design-system/ui/CountBadge";
import { useSubmissionUpdates } from "./submission-updates";

export function ReviewUpdatesBadge({ relay }: { relay: RelayData }) {
  const connection = useRelayConnection(relay);
  const session = connection.session;
  const list = useChannelList(session.channels);
  const channels =
    list.status === "ready"
      ? list.channels
          .filter((item) => reviewHistoryMember(item, session.viewer))
          .map((item) => item.id)
      : [];
  const readable = connection.status === "ready" && list.status === "ready";
  const updates = useSubmissionUpdates(session, "", readable, channels);
  const count =
    readable && !updates.error
      ? updates.rows.filter(updates.store.unread).length
      : 0;
  return (
    <CountBadge
      count={count}
      label={`${count} updated pull requests submitted by you`}
    />
  );
}
