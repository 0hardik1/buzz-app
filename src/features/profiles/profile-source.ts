import { useSyncExternalStore } from "react";
import type { RelaySession } from "../relay/session";
import type { Communities, PersonalProfile } from "../communities/service";
import type { profileFromEvent } from "../communities/api";
import type { EventData } from "../relay/events";
import { profileTimeZone } from "./local-time";
import {
  profileSaveGeneration,
  profileSavedSince,
  trackBackgroundProfileWrite,
} from "../communities/profile-saves";
import type { ManagedProfile } from "./managed-profile";

export type ProfileSyncOptions = {
  community: string;
  viewer: string;
  communities: Communities;
  read: Promise<readonly EventData[]>;
  inspect(): Promise<ReturnType<typeof profileFromEvent>>;
  publish(
    profile: PersonalProfile,
    existing: Record<string, unknown>,
  ): Promise<void>;
  signal?: AbortSignal;
  zone: string | undefined;
};

const noSubscribe = () => () => {};
/** Directory values come only from the shared, signature-verified community projection. */
export function useManagedProfile(
  session: RelaySession | undefined,
  pubkey: string,
): ManagedProfile | undefined {
  return useSyncExternalStore(
    session?.profiles.subscribe ?? noSubscribe,
    () => session?.profiles.snapshot().get(pubkey)?.verified?.managed,
  );
}
export function useProfileCity(
  session: RelaySession,
  pubkey: string,
): string | undefined {
  return useManagedProfile(session, pubkey)?.city;
}
export function managedProfileTimeZone(
  data: ManagedProfile | undefined,
): boolean {
  return !!profileTimeZone(data?.timezone);
}
export function managedProfileFields(data: ManagedProfile | undefined) {
  const fields = data?.fields.filter(({ key }) => key !== "username") ?? [];
  const values = fields.map(({ key, label, value }) => ({
    key,
    label,
    value: value || "Not set",
  }));
  const timezone = profileTimeZone(data?.timezone);
  if (timezone && !fields.some(({ key }) => key === "timezone")) {
    values.push({
      key: "timezone",
      label: "Time zone",
      value: timezone,
    });
  }
  return values;
}
export function managedProfileHeading(data: ManagedProfile | undefined) {
  return data
    ? { title: `Managed by ${data.source_label}`, url: data.source_url }
    : undefined;
}
export function profilePhotoChoice(
  _community: string,
  existing: Record<string, unknown>,
  picture: string,
  removedManagedDefault = false,
): Record<string, unknown> {
  const before = typeof existing.picture === "string" ? existing.picture : "";
  return picture !== before || removedManagedDefault
    ? { ...existing, managed_photo_initialized: true }
    : existing;
}

export async function syncManagedProfile(
  options: ProfileSyncOptions,
): Promise<boolean | undefined> {
  const { communities, viewer, signal } = options;
  const generation = profileSaveGeneration(communities);
  const connection = communities.relay.snapshot();
  const session = connection.session;
  const stillCurrent = () =>
    !signal?.aborted &&
    communities.relay.snapshot().session === session &&
    session?.viewer === viewer &&
    !profileSavedSince(communities, generation);
  if (!session) return undefined;
  if (!stillCurrent()) return false;
  if (!session.profiles.verifiedAuthority?.()?.managedKind) return undefined;
  try {
    await options.read;
    const checked = await session.directMessages.verified(
      [viewer],
      signal ?? AbortSignal.timeout(12000),
    );
    const identity = checked?.profiles.get(viewer);
    if (identity?.status !== "checked" || !identity.username || !stillCurrent())
      return false;
    const managed = identity.managed;
    if (!managed) return undefined;
    const current = await options.inspect();
    const latest = await options.inspect();
    if (JSON.stringify(latest.existing) !== JSON.stringify(current.existing))
      return false;
    if (!stillCurrent() || !current.exists || !current.profile.name.trim())
      return false;
    // Never normalize somebody's name/about as a side effect of importing defaults.
    const written = {
      name: current.profile.name.trim(),
      display_name: current.profile.name.trim(),
      picture: current.profile.picture,
      about: current.profile.about?.trim() ?? "",
    };
    if (
      Object.entries(written).some(
        ([key, value]) =>
          key in current.existing && current.existing[key] !== value,
      )
    )
      return false;
    const importPhoto =
      current.existing.managed_photo_initialized !== true &&
      !current.profile.picture &&
      !!managed.picture;
    const markPhoto =
      current.existing.managed_photo_initialized !== true &&
      (!!current.profile.picture || importPhoto);
    const zone = profileTimeZone(managed.timezone);
    const updateZone = !!zone && current.existing.tz !== zone;
    if (!importPhoto && !markPhoto && !updateZone) {
      return false;
    }
    const write = options.publish(
      {
        ...current.profile,
        ...(importPhoto && managed.picture ? { picture: managed.picture } : {}),
      },
      {
        ...current.existing,
        ...(markPhoto ? { managed_photo_initialized: true } : {}),
        ...(updateZone ? { tz: zone } : {}),
      },
    );
    trackBackgroundProfileWrite(communities, write);
    await write;
    return true;
  } catch {
    return false;
  }
}
