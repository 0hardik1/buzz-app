import { useEffect, useState } from "react";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { avatarMedia } from "../../shared/avatar-source";
import { animatedAvatar } from "./animated-avatar";
import { IconButton } from "../../shared/design-system/ui/IconButton";

/** Profiles play the full animation through the same authorized media adapter as the poster. */
export function HumanProfileAvatar({
  picture,
  media,
  name,
  status,
}: {
  picture: string | undefined;
  media: (url: string, size?: "small") => string | undefined;
  name: string;
  status: "online" | "away" | "offline" | undefined;
}) {
  const animation = animatedAvatar(picture);
  const [playing, setPlaying] = useState(false);
  const animationSource =
    animation && playing ? media(animation.animation) : undefined;
  const [loaded, setLoaded] = useState<string>();
  useEffect(() => {
    if (!animationSource) return;
    const image = new Image();
    image.referrerPolicy = "no-referrer";
    image.onload = () => setLoaded(animationSource);
    image.src = animationSource;
    return () => {
      image.onload = null;
      image.src = "";
    };
  }, [animationSource]);
  const source =
    animationSource && loaded === animationSource
      ? animationSource
      : avatarMedia(picture, media);
  const avatar = (
    <Avatar
      src={source}
      alt={`${name} avatar`}
      fallback={name}
      size="fill"
      shape="circle"
      statusBadge={status}
    />
  );
  return animation ? (
    <IconButton
      variant="avatar"
      style={{ width: "100%", height: "100%" }}
      aria-label={playing ? "Pause avatar animation" : "Play avatar animation"}
      aria-pressed={playing}
      onClick={() => setPlaying(!playing)}
      icon={avatar}
    />
  ) : (
    avatar
  );
}
