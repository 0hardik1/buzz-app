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
    const otherOrigin = "https://other.example.org";
    const scope = `${viewer}:${origin}`;
    const otherScope = `${viewer}:${otherOrigin}`;
    const cache = createHeadPersistence(viewer, origin);
    const peer = createHeadPersistence(viewer, origin);
    const other = createHeadPersistence(viewer, otherOrigin);
    const channelId = (index) => `example-channel-${index}`;
    const channelRoster = (index, time, members = [viewer, ...agents]) =>
      roster(relay, channelId(index), members, time);
    const rosterSize = 1876;
    const events = Array.from({ length: rosterSize }, (_, index) => [
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
    await writeLegacy(scope, saved);
    const legacy = await cache.readStartup();
    await cache.writeStartup({ discovery: saved.discovery });
    await cache.writeProfiles([{ content: "m".repeat(2_000_000) }]);
    const otherEvent = channelRoster(3000);
    await other.writeStartup({
      discovery: { ...saved.discovery, events: [otherEvent] },
    });
    await cache.write({
      channelId: channelId(1),
      events: [],
      profiles: [],
      savedAt: Date.now(),
    });
    await other.write({
      channelId: channelId(3000),
      events: [],
      profiles: [],
      savedAt: Date.now(),
    });
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
      rosterReads: 0,
      bulkValueReads: 0,
      readBytes: 0,
      writtenBytes: 0,
    });
    let measured = counts();
    const methods = ["put", "get", "getAll", "getAllKeys", "openCursor"];
    const prototype = IDBObjectStore.prototype;
    const originals = methods.map((method) => prototype[method]);
    const inlineRoster = (value) =>
      Array.isArray(value?.data?.discovery?.events);
    const hasRoster = (value) =>
      inlineRoster(value) ||
      (Array.isArray(value?.data) &&
        value.data.some(
          (event) => event?.kind === 39002 || event?.kind === 39000,
        ));
    for (const [index, method] of methods.entries()) {
      prototype[method] = function (...args) {
        const request = originals[index].apply(this, args);
        if (this.name !== "startup") return request;
        const sample = measured;
        if (method === "put") {
          sample.writtenBytes += bytes(args[0]);
          if (inlineRoster(args[0])) sample.rosterWrites++;
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
    const rawStorage = () =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(["startup", "heads"]);
        const startup = tx.objectStore("startup").getAll();
        const heads = tx.objectStore("heads").getAll();
        tx.oncomplete = () =>
          resolve({
            payloadKeys: startup.result
              .filter((row) => hasRoster(row) || Array.isArray(row.data))
              .map(({ key }) => key),
            headScopes: [...new Set(heads.result.map((row) => row.scope))],
          });
        tx.onabort = () => reject(tx.error);
      });
    channels.acceptDiscovery(events, undefined, undefined, false, false);
    let lastUpdate;
    window.rosterReplay = {
      update(index) {
        lastUpdate = channelRoster(index, 1_700_000_001);
        channels.acceptDiscovery([lastUpdate]);
      },
      repeat: (complete = false) =>
        channels.acceptDiscovery(
          [lastUpdate],
          complete
            ? new Set(
                Array.from({ length: rosterSize - 1 }, (_, index) =>
                  channelId(index + 1),
                ),
              )
            : undefined,
        ),
      unrelated: () => {
        channels.acceptDiscovery([
          metadata(relay, "preview", "Unjoined preview"),
        ]);
      },
      settle,
      async measure() {
        const replay = measured;
        measured = counts();
        await cache.writeProfiles([{ content: "m".repeat(5_000_000) }]);
        const prune = measured;
        measured = counts();
        const mirrorPruned = (await cache.readProfiles()).length === 0;
        return { replay, prune, mirrorPruned };
      },
      async finish() {
        const current = await cache.readStartup();
        const removed = channelId(0);
        const changedPreferences = { ...preferences, savedAt: Date.now() + 1 };
        const saving = peer.writeStartup({ preferences: changedPreferences });
        channels.acceptDiscovery([channelRoster(0, 1_700_000_002, agents)]);
        await saving;
        const afterRevocation = await cache.readStartup();
        const oversized = await cache
          .writeStartup({
            preferences: {
              ...changedPreferences,
              data: {
                sections: [
                  { id: "oversized", name: "p".repeat(4_600_000), order: 0 },
                ],
              },
            },
          })
          .then(
            () => false,
            () => true,
          );
        await cache.writeProfiles([{ content: "Selected scope" }]);
        await other.writeProfiles([{ content: "Other scope" }]);
        lastUpdate = channelRoster(1, 1_700_000_002);
        channels.acceptDiscovery([lastUpdate]);
        const clear = (name, work) =>
          new Promise((resolve, reject) => {
            const tx = db.transaction(name, "readwrite");
            work(tx.objectStore(name));
            tx.oncomplete = resolve;
            tx.onabort = () => reject(tx.error);
          });
        // The v2 client clears these stores in two transactions.
        await clear("startup", (startup) => {
          startup.delete(scope);
          startup.delete(`${scope}:profiles`);
        });
        await clear("heads", (heads) => {
          const rows = heads.getAll();
          rows.onsuccess = () => {
            for (const row of rows.result)
              if (row.scope === scope) heads.delete(row.key);
          };
        });
        return {
          afterClear: await rawStorage(),
          legacyRestored:
            legacy.discovery.events.length === events.length &&
            legacy.preferences.savedAt === preferences.savedAt,
          initialBytes: bytes(saved),
          oversized,
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
        };
      },
      async cleanup() {
        try {
          return {
            ...(await rawStorage()),
            cleared: (await cache.readStartup()) === undefined,
            otherScope,
            otherEvent:
              (await other.readStartup())?.discovery?.events[0]?.id ===
              otherEvent.id,
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
    const replay = await page.evaluate(() => window.rosterReplay.measure());
    await page.clock.runFor(30_000);
    await page.evaluate(() => window.rosterReplay.repeat());
    await page.clock.runFor(500);
    result = {
      ...replay,
      ...(await page.evaluate(() => window.rosterReplay.finish())),
    };
    await page.clock.runFor(30_500);
    await page.evaluate(() => window.rosterReplay.unrelated());
    await page.clock.runFor(500);
    await page.evaluate(() => window.rosterReplay.repeat(true));
    await page.clock.runFor(500);
  } finally {
    remaining = await page.evaluate(() => window.rosterReplay.cleanup());
  }
  await info.attach("roster-replay", {
    body: JSON.stringify(result, null, 2),
    contentType: "application/json",
  });
  const otherPayloads = {
    payloadKeys: [remaining.otherScope, `${remaining.otherScope}:profiles`],
    headScopes: [remaining.otherScope],
  };
  expect(result.afterClear).toEqual(otherPayloads);
  expect(remaining).toMatchObject({
    ...otherPayloads,
    cleared: true,
    otherEvent: true,
  });
  expect(result).toMatchObject({
    legacyRestored: true,
    replay: {
      rosterWrites: 1,
      rosterReads: 1,
      bulkValueReads: 0,
    },
    prune: { rosterReads: 0, rosterWrites: 0, bulkValueReads: 0 },
    mirrorPruned: true,
    latestSaved: true,
    immediatelyRevoked: true,
    preferencesSaved: true,
    oversized: true,
  });
  expect(result.initialBytes).toBeGreaterThan(3_500_000);
  expect(result.replay.readBytes + result.replay.writtenBytes).toBeLessThan(
    2.05 * result.initialBytes,
  );
});
