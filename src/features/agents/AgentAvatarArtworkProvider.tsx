import type { ComponentProps, ReactNode } from "react";
import { AvatarArtworkContext } from "../../shared/design-system/ui/Avatar";
import {
  HoverAvatarArtwork,
  hoverAvatarSources,
} from "../profiles/HoverAvatarArtwork";
import { agentAvatars } from "./avatar-packs";

const packsBySource = new Map(
  agentAvatars.flatMap((avatar) => [
    [avatar.url, avatar] as const,
    [avatar.preview, avatar] as const,
  ]),
);
function renderArtwork(
  src: string,
  options: Omit<
    ComponentProps<typeof HoverAvatarArtwork>,
    "poster" | "animation"
  >,
) {
  const animated = hoverAvatarSources(src);
  if (animated)
    return <HoverAvatarArtwork key={src} {...animated} {...options} />;
  const avatar = packsBySource.get(src);
  return avatar ? (
    <img
      data-loaded="true"
      src={avatar.preview}
      alt=""
      style={{ width: "100%", height: "100%", objectFit: "contain" }}
    />
  ) : null;
}

/** Human recordings play on hover; bundled agent artwork keeps its static portrait. */
export function AgentAvatarArtworkProvider({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <AvatarArtworkContext value={renderArtwork}>
      {children}
    </AvatarArtworkContext>
  );
}
