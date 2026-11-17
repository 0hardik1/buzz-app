import type { Communities, PersonalProfile } from "../communities/service";
import type { profileFromEvent } from "../communities/api";
import type { EventData } from "../relay/events";

/** Distributor-owned profile defaults. The public build has no managed source. */
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

export function managedProfileTimeZone(
  _community: string | undefined,
): boolean {
  return false;
}

/** Undefined delegates to normal device-timezone sharing. */
export async function syncManagedProfile(
  _options: ProfileSyncOptions,
): Promise<boolean | undefined> {
  return undefined;
}

/** Preserve a distributor's explicit photo choice when saving the editor. */
export function profilePhotoChoice(
  _community: string,
  existing: Record<string, unknown>,
  _picture: string,
): Record<string, unknown> {
  return existing;
}
