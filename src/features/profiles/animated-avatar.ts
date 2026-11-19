import { avatarSource } from "../../shared/avatar-source";

/** Shared with Buzz mobile: a still poster plus a separately hosted animation. */
export function animatedAvatar(value: string | undefined) {
  const index = value?.indexOf("#buzz-anim=") ?? -1;
  if (!value || index <= 0) return undefined;
  try {
    const poster = avatarSource(value.slice(0, index));
    const animation = avatarSource(decodeURIComponent(value.slice(index + 11)));
    if (poster?.startsWith("https://") && animation?.startsWith("https://"))
      return { poster, animation };
  } catch {
    /* Malformed optional metadata leaves the still image usable. */
  }
  return undefined;
}

export function animatedAvatarUrl(poster: string, animation: string) {
  return `${poster}#buzz-anim=${encodeURIComponent(animation)}`;
}
