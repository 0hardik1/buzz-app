import type { RelaySession } from "../../features/relay/session";
import { useUnreadChannelIds } from "./useSidebarFilters";
import styles from "./Channels.module.css";

/** Collapsed cards retain the unread signal of their hidden conversations. */
export function SectionUnreadDot({
  session,
  channelIds,
}: {
  session: RelaySession;
  channelIds: readonly string[];
}) {
  const unread = useUnreadChannelIds(
    session.unread,
    JSON.stringify(channelIds),
    true,
  );
  return unread.size ? (
    <span
      className={`${styles.priorityDot} ${styles.sectionUnreadDot}`}
      role="img"
      aria-label="Unread messages"
    />
  ) : null;
}
