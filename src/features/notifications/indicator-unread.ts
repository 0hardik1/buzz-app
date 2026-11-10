import type { Communities } from "../communities/service";
import type { RelaySession } from "../relay/session";
import { communityDestination } from "../communities/destination";
import { observeCommunityUnread, type UnreadGates } from "./community-unread";
import { NO_BADGE, type UnreadBadge } from "./indicator";

/** Notification gates: only conversations they allow light the indicator. */
export type IndicatorGates = UnreadGates;

/**
 * A host projection of existing evidence, never a new read owner. The count
 * is observed unread direct messages and mentions of the viewer; muted
 * conversations contribute only their mentions. It is not an exact relay total.
 */
export function bindUnreadIndicator(
  communities: Communities,
  project: (badge: UnreadBadge) => void,
  gates?: IndicatorGates,
) {
  let closed = false;
  let session: RelaySession | undefined;
  let identity = "";
  let previous: UnreadBadge | undefined;
  let stopObserving = () => {};
  const publish = (badge: UnreadBadge) => {
    if (badge.unread === previous?.unread && badge.count === previous.count)
      return;
    previous = badge;
    project(badge);
  };
  const update = () => {
    if (closed) return;
    const client = communities.snapshot();
    const relay = communities.relay.snapshot();
    const next = `${client.viewer ?? ""}:${client.selected ?? ""}`;
    const owned =
      relay.status === "ready" &&
      client.viewer &&
      relay.viewer === client.viewer &&
      client.memberships.some((item) => item.id === client.selected)
        ? relay.session
        : undefined;
    if (session === owned && identity === next) return;
    stopObserving();
    stopObserving = () => {};
    session = owned;
    identity = next;
    publish(NO_BADGE);
    if (!owned) return;
    stopObserving = observeCommunityUnread(
      owned,
      client.viewer as string,
      communityDestination(client.selected as string).url,
      (state) => {
        const count = state?.count ?? 0;
        publish(
          state ? { unread: state.unread || count > 0, count } : NO_BADGE,
        );
      },
      gates,
    );
  };
  const stop = communities.subscribe(update);
  const stopRelay = communities.relay.subscribe(update);
  update();
  return () => {
    if (closed) return;
    closed = true;
    stop();
    stopRelay();
    stopObserving();
    session = undefined;
    publish(NO_BADGE);
  };
}
