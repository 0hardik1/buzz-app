import type { profileFromEvent } from "../communities/api";
import {
  profileSaveGeneration,
  profileSavedSince,
  trackBackgroundProfileWrite,
} from "../communities/profile-saves";
import type { Communities, PersonalProfile } from "../communities/service";
import { profileTimeZone } from "./local-time";

export const deviceTimeZone = () =>
  profileTimeZone(new Intl.DateTimeFormat().resolvedOptions().timeZone);

/** `existing` with this device's zone added when the profile has never had a
 * `tz` key; an empty `tz` is an opt-out and stays. */
export function withDeviceTimeZone(
  existing: Record<string, unknown>,
  zone: string | undefined,
): Record<string, unknown> {
  return zone && !("tz" in existing) ? { ...existing, tz: zone } : existing;
}

/** `existing` sharing this device's zone, as a profile that follows it does;
 * an empty `tz` is an opt-out and stays. */
export function withFollowedTimeZone(
  existing: Record<string, unknown>,
  zone: string | undefined,
): Record<string, unknown> {
  return zone && existing.tz !== "" ? { ...existing, tz: zone } : existing;
}

// Community and viewer pairs whose zone was picked on this device. Every other
// profile follows this device's zone.
const storageKey = "buzz-pinned-time-zones.v1";
const pinKey = (community: string, viewer: string) => `${community}\n${viewer}`;
// Read on each use, so a pin from another window is never lost.
function pinnedPairs() {
  const pins = new Set<string>();
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(storageKey) ?? "[]");
    if (Array.isArray(saved))
      for (const key of saved) if (typeof key === "string") pins.add(key);
  } catch {}
  return pins;
}

/** Whether the viewer picked this community's zone on this device, so it no
 * longer follows the device's zone. */
export function timeZonePinned(community: string, viewer: string) {
  return pinnedPairs().has(pinKey(community, viewer));
}

export function setTimeZonePinned(
  community: string,
  viewer: string,
  pinned: boolean,
) {
  const pairs = pinnedPairs();
  if (pinned) pairs.add(pinKey(community, viewer));
  else pairs.delete(pinKey(community, viewer));
  try {
    localStorage.setItem(storageKey, JSON.stringify([...pairs]));
  } catch {}
}

const canonical = (zone: string) =>
  new Intl.DateTimeFormat("en-US", { timeZone: zone }).resolvedOptions()
    .timeZone;

type ProfileRead = ReturnType<typeof profileFromEvent>;

/** Whether a background write should set `tz` to `zone`: the profile exists,
 * has not opted out (an empty `tz`), shares a different zone or none, and the
 * profile writer would leave its other fields as they are. */
function follows({ exists, existing, profile }: ProfileRead, zone: string) {
  if (!exists || existing.tz === "") return false;
  const shared = profileTimeZone(existing.tz);
  // Engines spell some zones differently (Asia/Calcutta, Asia/Kolkata).
  if (shared && canonical(shared) === canonical(zone)) return false;
  const name = profile.name.trim();
  const written: Record<string, unknown> = {
    name,
    display_name: name,
    picture: profile.picture,
    about: profile.about?.trim() ?? "",
  };
  return (
    !!name &&
    !Object.entries(written).some(
      ([field, value]) => field in existing && existing[field] !== value,
    )
  );
}

// Runs one at a time, so overlapping triggers never publish twice.
let running: Promise<unknown> = Promise.resolve();

/** Sets `tz` to this device's zone in each joined community whose profile
 * follows it: not pinned on this device, not opted out, and not already
 * there. Reads each profile strongly just before publishing, so a lagging read
 * never reverts a newer profile; never creates a profile or renames anyone;
 * and stands aside while a profile save is running or after one started.
 * Resolves whether every community was checked, so a failed read or
 * publication can be retried. */
export function followDeviceTimeZone(
  options: Parameters<typeof follow>[0],
): Promise<boolean> {
  const current = running.then(() => follow(options));
  running = current.catch(() => {});
  return current;
}

async function follow({
  viewer,
  communities,
  inspect,
  publish,
  signal,
  zone,
}: {
  viewer: string;
  /** The app's communities: whose profiles follow, and whose saves this
   * write stands aside for. */
  communities: Communities;
  /** A strong read of the viewer's profile, as `inspectProfile` returns. */
  inspect(community: string): Promise<ProfileRead>;
  publish(
    community: string,
    profile: PersonalProfile,
    existing: Record<string, unknown>,
  ): Promise<void>;
  signal?: AbortSignal;
  /** This device's zone, from `deviceTimeZone()`. */
  zone: string | undefined;
}): Promise<boolean> {
  if (!zone) return true;
  const saves = profileSaveGeneration(communities);
  // Pinned before or during the read: the viewer's pick stays.
  const settled = (community: string) =>
    !!signal?.aborted ||
    communities.snapshot().viewer !== viewer ||
    timeZonePinned(community, viewer);
  let complete = true;
  for (const { id } of communities.snapshot().memberships) {
    if (settled(id)) continue;
    if (profileSavedSince(communities, saves)) return false;
    let current: ProfileRead;
    try {
      current = await inspect(id);
    } catch {
      complete = false;
      continue;
    }
    if (settled(id) || !follows(current, zone)) continue;
    if (profileSavedSince(communities, saves)) return false;
    try {
      const write = publish(
        id,
        current.profile,
        withFollowedTimeZone(current.existing, zone),
      );
      trackBackgroundProfileWrite(communities, write);
      await write;
    } catch {
      complete = false;
    }
  }
  return complete && !signal?.aborted;
}

/** Test seam: forget pinned zones and any run in flight. */
export function resetFollowedTimeZones() {
  try {
    localStorage.removeItem(storageKey);
  } catch {}
  running = Promise.resolve();
}
