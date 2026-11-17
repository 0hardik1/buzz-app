import { expect, it, vi } from "vitest";
import type { Communities } from "../communities/service";
import type { RelaySession } from "../relay/session";
import { beginProfileSave, endProfileSave } from "../communities/profile-saves";
import {
  profilePhotoChoice,
  syncManagedProfile,
  type ProfileSyncOptions,
} from "./profile-source";

function fixture(existing: Record<string, unknown> = {}) {
  const managed = {
    version: 1,
    source_label: "Directory",
    source_url: "https://example.org/alice",
    fields: [],
    timezone: "Europe/London",
    picture: "https://example.org/alice.png",
  };
  const session = {
    viewer: "alice",
    profiles: { verifiedAuthority: () => ({ managedKind: 30383 }) },
    directMessages: {
      verified: vi.fn(async () => ({
        profiles: new Map([
          ["alice", { status: "checked", username: "alice", managed }],
        ]),
      })),
    },
  } as unknown as RelaySession;
  const communities = {
    relay: { snapshot: () => ({ session }) },
  } as unknown as Communities;
  const current = {
    exists: true,
    existing: {
      name: "Alice",
      display_name: "Alice",
      picture: "",
      about: "",
      ...existing,
    },
    profile: {
      name: "Alice",
      picture: typeof existing.picture === "string" ? existing.picture : "",
      about: "",
    },
  };
  const options: ProfileSyncOptions = {
    community: "https://example.org",
    viewer: "alice",
    communities,
    read: Promise.resolve([]),
    inspect: vi.fn(async () => current),
    publish: vi.fn(async () => {}),
    zone: "UTC",
  };
  return { options, current, session };
}

it("imports defaults without persisting directory fields into user metadata", async () => {
  const { options } = fixture();
  expect(await syncManagedProfile(options)).toBe(true);
  expect(options.publish).toHaveBeenCalledWith(
    { name: "Alice", picture: "https://example.org/alice.png", about: "" },
    {
      name: "Alice",
      display_name: "Alice",
      picture: "",
      about: "",
      managed_photo_initialized: true,
      tz: "Europe/London",
    },
  );
});

it.each([
  { picture: "https://example.org/chosen.png" },
  { picture: "", managed_photo_initialized: true },
])("preserves chosen and explicitly removed photos: %j", async (existing) => {
  const { options } = fixture(existing);
  await syncManagedProfile(options);
  expect(options.publish).toHaveBeenCalledWith(
    expect.objectContaining({ picture: existing.picture }),
    expect.anything(),
  );
});

it("records explicit photo replacement and removal", () => {
  expect(
    profilePhotoChoice("https://example.org", { picture: "old" }, ""),
  ).toEqual({ picture: "old", managed_photo_initialized: true });
  expect(
    profilePhotoChoice("https://example.org", { picture: "" }, "new"),
  ).toEqual({ picture: "", managed_photo_initialized: true });
});

it("does not publish after a foreground save starts during inspection", async () => {
  const { options, current } = fixture();
  options.inspect = async () => {
    beginProfileSave(options.communities);
    return current;
  };
  expect(await syncManagedProfile(options)).toBe(false);
  expect(options.publish).not.toHaveBeenCalled();
  endProfileSave(options.communities);
});

it("does not import a timezone this runtime cannot use", async () => {
  const { options, session } = fixture();
  vi.mocked(session.directMessages.verified).mockResolvedValue({
    profiles: new Map([
      [
        "alice",
        {
          status: "checked",
          username: "alice",
          managed: {
            version: 1,
            source_label: "Directory",
            source_url: "https://example.org",
            fields: [],
            timezone: "Not/AZone",
          },
        },
      ],
    ]),
  } as never);
  expect(await syncManagedProfile(options)).toBe(false);
  expect(options.publish).not.toHaveBeenCalled();
});
