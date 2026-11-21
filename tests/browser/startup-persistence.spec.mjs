import { test, expect } from "./source-fixture.mjs";

test("startup storage batches roster updates and prunes without transferring the roster", async ({
  page,
  context,
  sourceOrigin,
}, info) => {
  const url = `${sourceOrigin}/startup-persistence-test`;
  await context.route(url, (route) =>
    route.fulfill({ contentType: "text/html", body: "<!doctype html>" }),
  );
  await page.goto(url);
  const replayStart = Date.now();
  await page.clock.install({ time: replayStart });
  await page.clock.pauseAt(replayStart + 60_000);
  await page.evaluate(async () => {
    const { createHeadPersistence } = await import(
      "/src/features/relay/persistence.ts"
    );
    const { createProfileDirectory } = await import(
      "/src/features/relay/profile-directory.ts"
    );
    const { createChannelStore } = await import("/src/features/relay/store.ts");
    const { keypair, metadata, roster } = await import(
      "/src/features/relay/testing.ts"
    );
    const relay = keypair();
    const { pubkey: viewer } = keypair();
    const agents = [keypair().pubkey, keypair().pubkey];
    const origin = "https://example.org";
    const cache = createHeadPersistence(viewer, origin);
    const peer = createHeadPersistence(viewer, origin);
    const other = createHeadPersistence(viewer, "https://other.example.org");
    const channelId = (index) => `example-channel-${index}`;
    const channelRoster = (index, time, members = [viewer, ...agents]) =>
      roster(relay, channelId(index), members, time);
    const events = Array.from({ length: 1876 }, (_, index) => [
      channelRoster(index),
      metadata(relay, channelId(index), `Example task ${index}`, undefined, [
        ["about", "Synthetic task context. ".repeat(42)],
        ["visibility", "private"],
      ]),
    ]).flat();
    const bytes = (value) =>
      new TextEncoder().encode(JSON.stringify(value ?? null)).byteLength;
    const preferences = { savedAt: Date.now(), data: { sections: [] } };
    const saved = {
      discovery: { savedAt: Date.now(), relayAuthor: relay.pubkey, events },
      preferences,
    };
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("buzz-channel-heads-v1", 2);
      request.onupgradeneeded = () => {
        for (const name of ["heads", "startup"])
          request.result.createObjectStore(name, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const writeLegacy = (key, data) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("startup", "readwrite");
        tx.objectStore("startup").put({
          key,
          data,
          bytes: bytes(data),
          savedAt: Date.now(),
        });
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    await writeLegacy(`${viewer}:${origin}`, saved);
    const legacy = await cache.readStartup();
    await cache.writeStartup({ discovery: saved.discovery });
    await cache.writeProfiles([{ content: "m".repeat(2_000_000) }]);
    await other.writeStartup({ verifiedProfiles: null });
    await peer.readStartup();
    const directory = createProfileDirectory(null);
    const channels = createChannelStore(
      {
        viewer,
        relayAuthor: relay.pubkey,
        read: async () => [],
        revokeAccess: (commit) => commit(),
        media: () => undefined,
        visible: (value) => value,
      },
      directory,
      { persistence: cache },
    );

    const counts = () => ({
      rosterWrites: 0,
      shardWrites: 0,
      rosterReads: 0,
      bulkValueReads: 0,
      readBytes: 0,
      writtenBytes: 0,
    });
    let measured = counts();
    const methods = ["put", "get", "getAll", "getAllKeys", "openCursor"];
    const prototype = IDBObjectStore.prototype;
    const originals = methods.map((method) => prototype[method]);
    const hasRoster = (value) => Array.isArray(value?.data?.discovery?.events);
    for (const [index, method] of methods.entries()) {
      prototype[method] = function (...args) {
        const request = originals[index].apply(this, args);
        if (this.name !== "startup") return request;
        const sample = measured;
        if (method === "put") {
          sample.writtenBytes += bytes(args[0]);
          if (hasRoster(args[0])) sample.rosterWrites++;
          if (args[0].key.startsWith("!roster:")) sample.shardWrites++;
        } else {
          if (method === "getAll" || method === "openCursor")
            sample.bulkValueReads++;
          request.addEventListener("success", () => {
            const value =
              method === "openCursor" ? request.result?.value : request.result;
            sample.readBytes += bytes(value);
            sample.rosterReads += Array.isArray(value)
              ? value.filter(hasRoster).length
              : Number(hasRoster(value));
          });
        }
        return request;
      };
    }
    const settle = () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction("startup");
        tx.objectStore("startup").count();
        tx.oncomplete = resolve;
        tx.onabort = () => reject(tx.error);
      });
    channels.acceptDiscovery(events, undefined, undefined, false, false);
    window.rosterReplay = {
      update: (index) =>
        channels.acceptDiscovery([channelRoster(index, 1_700_000_001)]),
      settle,
      async finish() {
        const replay = measured;
        measured = counts();
        await cache.writeProfiles([{ content: "m".repeat(5_000_000) }]);
        const prune = measured;
        measured = counts();
        const mirrorPruned = (await cache.readProfiles()).length === 0;
        const current = await cache.readStartup();
        const removed = channelId(0);
        const changedPreferences = { ...preferences, savedAt: Date.now() + 1 };
        const saving = peer.writeStartup({ preferences: changedPreferences });
        channels.acceptDiscovery([channelRoster(0, 1_700_000_002, agents)]);
        await saving;
        const afterRevocation = await cache.readStartup();
        // Older clients can evict individual shards as independent rows.
        await new Promise((resolve, reject) => {
          const tx = db.transaction("startup", "readwrite");
          const store = tx.objectStore("startup");
          const keys = store.getAllKeys();
          keys.onsuccess = () => {
            const shard = keys.result.find((key) => key.startsWith("!roster:"));
            if (shard) store.delete(shard);
          };
          tx.oncomplete = resolve;
          tx.onabort = () => reject(tx.error);
        });
        const incomplete = await cache.readStartup();
        channels.acceptDiscovery([channelRoster(1, 1_700_000_002)]);
        await channels.clearCache();
        return {
          legacyRestored:
            legacy.discovery.events.length === events.length &&
            legacy.preferences.savedAt === preferences.savedAt,
          initialBytes: bytes(saved),
          replay,
          prune,
          mirrorPruned,
          latestSaved: current.discovery.events.some(
            (event) =>
              event.kind === 39002 &&
              event.created_at === 1_700_000_001 &&
              event.tags[0][1] === channelId(19),
          ),
          immediatelyRevoked: !afterRevocation.discovery.events.some(
            (event) => event.tags[0][1] === removed,
          ),
          preferencesSaved:
            afterRevocation.preferences.savedAt === changedPreferences.savedAt,
          incompleteRejected:
            incomplete.discovery === undefined &&
            incomplete.preferences.savedAt === changedPreferences.savedAt,
        };
      },
      async cleanup() {
        try {
          return {
            cleared: (await cache.readStartup()) === undefined,
            otherScope: await other.readStartup(),
          };
        } finally {
          channels.dispose();
          directory.dispose();
          peer.close();
          other.close();
          db.close();
          for (const [index, method] of methods.entries())
            prototype[method] = originals[index];
        }
      },
    };
  });

  let result;
  let remaining;
  try {
    for (let index = 0; index < 20; index++) {
      await page.evaluate((step) => window.rosterReplay.update(step), index);
      await page.clock.runFor(500);
      await page.evaluate(() => window.rosterReplay.settle());
    }
    result = await page.evaluate(() => window.rosterReplay.finish());
    await page.clock.runFor(500);
  } finally {
    remaining = await page.evaluate(() => window.rosterReplay.cleanup());
  }
  await info.attach("roster-replay", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  expect(result).toMatchObject({
    legacyRestored: true,
    replay: {
      rosterWrites: 0,
      shardWrites: 20,
      rosterReads: 0,
      bulkValueReads: 0,
    },
    prune: { rosterReads: 0, rosterWrites: 0, bulkValueReads: 0 },
    mirrorPruned: true,
    latestSaved: true,
    immediatelyRevoked: true,
    preferencesSaved: true,
    incompleteRejected: true,
  });
  expect(result.initialBytes).toBeGreaterThan(3_500_000);
  expect(result.replay.readBytes + result.replay.writtenBytes).toBeLessThan(
    2.05 * result.initialBytes,
  );
  expect(remaining).toEqual({
    cleared: true,
    otherScope: { verifiedProfiles: null },
  });
});
