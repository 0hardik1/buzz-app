import type { ComponentProps } from "react";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { avatarMedia } from "../../shared/avatar-source";
import type { ChannelSummary, Profile } from "../../features/relay/contracts";
import type { RelaySession } from "../../features/relay/session";
import styles from "./StarredArtwork.module.css";

/** Pins' identity tiles, using Starred's existing channel and profile evidence. */
export function StarredArtwork({
  channel,
  profile,
  session,
  selected,
  presence,
}: {
  channel: ChannelSummary;
  profile: Profile | undefined;
  session: RelaySession;
  selected: boolean;
  presence: ComponentProps<typeof Avatar>["statusBadge"] | "unknown";
}) {
  const person =
    channel.channelType === "dm" && channel.participants?.length === 1;
  const group =
    channel.channelType === "dm" && (channel.participants?.length ?? 0) > 1;
  const agent = person && profile?.isAgent;
  const initials = Array.from(
    channel.name.replace(/^#+/, "").trim().toUpperCase(),
  )
    .slice(0, 2)
    .join("");
  const surfaces = [
    "categorical-purple",
    "categorical-blue",
    "categorical-green",
    "categorical-orange",
  ] as const;
  const surface =
    surfaces[(initials.codePointAt(0) ?? 0) % surfaces.length] ??
    "categorical-purple";
  const artwork = (
    <Avatar
      size="fill"
      shape={agent ? "squircle" : "circle"}
      src={person ? avatarMedia(profile?.picture, session.media) : undefined}
      alt=""
      fallback={channel.name}
      fallbackSurface={channel.channelType === "dm" ? "subtle" : surface}
      fallbackContent={
        group ? channel.participants?.length : person ? undefined : initials
      }
      statusSurface="sidebar-card"
      statusBadge={person && presence !== "unknown" ? presence : undefined}
    />
  );
  return (
    <span className={styles.artwork}>
      {selected && (
        <span
          className={styles.selection}
          data-agent={agent || undefined}
          data-channel={channel.channelType !== "dm" || undefined}
          aria-hidden="true"
        >
          <span className={styles.selectionArtwork}>{artwork}</span>
        </span>
      )}
      {artwork}
    </span>
  );
}
