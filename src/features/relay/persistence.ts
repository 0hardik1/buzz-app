import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "nostr-tools/utils";
import { byteSize, listByteSize } from "./budget";
import type { SidebarPreferences } from "./sidebar-preferences";
/** Device-local resume data, never proof of current access or permission to write. */
export type SavedStartup = {
  discovery?: {
    savedAt: number;
    relayAuthor: string;
    events: unknown[];
  };
  /** The verified-profile authority last observed, `null` once disabled, so
   * a cached session can show saved verified names before discovery. */
  verifiedProfiles?: unknown;
  preferences?: { savedAt: number; data: SidebarPreferences };
};
type SavedDiscovery = NonNullable<SavedStartup["discovery"]>;
/** Signed wire records only. The owner re-verifies before displaying cached history.
 * A cache hit is never authority for current membership or freshness. No keys/tokens are persisted. */
export type SavedHead = {
  channelId: string;
  savedAt: number;
  events: unknown[];
  /** Membership notices among the events, read apart from them. */
  notices?: unknown[];
  profiles: unknown[];
};
export interface HeadPersistence {
  read(): Promise<SavedHead[]>;
  /** Header-only callers get the discovery identity and an empty event list. */
  readStartup?(mode?: "header"): Promise<SavedStartup | undefined>;
  writeStartup?(patch: SavedStartup, revoked?: boolean): Promise<void>;
  /** Signed kind 0 and verified-profile (30382) events mirrored from the profile directory. */
  readProfiles?(): Promise<unknown[]>;
  writeProfiles?(events: readonly unknown[]): Promise<void>;
  write(head: SavedHead): Promise<void>;
  remove(channelId: string): Promise<void>;
  retain(channelIds: readonly string[]): Promise<void>;
  clear(): Promise<void>;
  close(): void;
}
const DB = "buzz-channel-heads-v1";
const STORE = "heads";
const STARTUP = "startup";
const MIRROR = ":profiles";
const STARTUP_BUDGET = `!budget${MIRROR}`;
const ROSTER_SHARD = "!roster:";
const ROSTER_SHARDS = 64;
/** The largest row saved; a larger one is not written at all. */
export const MAX_BYTES = 8 * 1024 * 1024;
const MAX_HEADS = 64;
const MAX_AGE = 24 * 60 * 60 * 1000;
type RowBudget = {
  key: string;
  bytes: number;
  savedAt: number;
  roster?: boolean;
};
type Record = SavedHead & RowBudget & { scope: string };
type RosterShard = { hash: string; bytes: number };
type RosterIndex = Omit<SavedDiscovery, "events"> & {
  shards: (RosterShard | null)[];
};
type StartupData = Omit<SavedStartup, "discovery"> & {
  discovery?: SavedDiscovery | RosterIndex;
};
type StartupRow = RowBudget & { data: StartupData };
type ScopedRow = Pick<Record, "scope" | "channelId"> & { key: IDBValidKey };

const rosterPrefix = (scope: string) =>
  `${ROSTER_SHARD}${scope.length}:${scope}/`;
const rosterKey = (scope: string, shard: number) =>
  `${rosterPrefix(scope)}${shard}`;
function rosterKeys(scope: string) {
  const prefix = rosterPrefix(scope);
  return IDBKeyRange.bound(prefix, `${prefix}\uffff`);
}

function shardDiscovery(events: unknown[]) {
  const groups = Array.from({ length: ROSTER_SHARDS }, () => [] as unknown[]);
  for (const value of events) {
    const event = value as { kind?: unknown; tags?: unknown } | null;
    const coordinate = event?.kind === 9007 ? "h" : "d";
    const channel = Array.isArray(event?.tags)
      ? event.tags.find(
          (tag) => Array.isArray(tag) && tag[0] === coordinate,
        )?.[1]
      : undefined;
    let hash = 0;
    if (typeof channel === "string")
      for (let i = 0; i < channel.length; i++)
        hash = Math.imul(hash, 31) + channel.charCodeAt(i);
    groups[hash & (ROSTER_SHARDS - 1)]?.push(value);
  }
  const encoder = new TextEncoder();
  return groups.map((events) => {
    if (!events.length) return null;
    const ids = events.map((value) => {
      const id = (value as { id?: unknown } | null)?.id;
      return typeof id === "string" ? id : JSON.stringify(value);
    });
    return {
      events,
      meta: {
        hash: bytesToHex(sha256(encoder.encode(ids.join(",")))),
        bytes: events.every((event) => event && typeof event === "object")
          ? listByteSize(events as object[])
          : byteSize(events),
      },
    };
  });
}

function rosterIndex(value?: StartupData["discovery"]) {
  return value &&
    typeof value === "object" &&
    "shards" in value &&
    Array.isArray(value.shards) &&
    !("events" in value)
    ? value
    : undefined;
}

const rosterBytes = (index?: RosterIndex) =>
  index?.shards.reduce((bytes, shard) => bytes + (shard?.bytes ?? 0), 0) ?? 0;

// History keys are strings. Array keys let us load the metadata on its own
// without changing the database version that older builds open.
const historyKeys = () => IDBKeyRange.upperBound([], true);
const metadataKeys = () => IDBKeyRange.lowerBound([]);

function putHeadMeta(
  store: IDBObjectStore,
  { key, bytes, savedAt, scope, channelId }: Record,
) {
  store.put({
    key: [key],
    scope,
    channelId,
    // Older builds can clear these rows by scope. Their writes expire every
    // metadata row, so an older same-key write also invalidates the budget.
    savedAt: Number.NEGATIVE_INFINITY,
    bytes: 0,
    head: { key, bytes, savedAt } satisfies RowBudget,
  });
}

function deleteHead(store: IDBObjectStore, key: string) {
  store.delete(key);
  store.delete([key]);
}

export function createHeadPersistence(
  viewer: string,
  relay: string,
): HeadPersistence {
  const scope = `${viewer}:${relay}`;
  const profiles = `${scope}${MIRROR}`;
  let closed = false;
  let opening: Promise<IDBDatabase> | undefined;
  function database() {
    if (closed || typeof indexedDB === "undefined")
      return Promise.reject(new Error("Cache unavailable"));
    opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(DB, 2);
      let expired = false;
      const timeout = setTimeout(() => {
        expired = true;
        reject(new Error("Cache open timed out"));
      }, 1500);
      request.onupgradeneeded = () => {
        for (const name of [STORE, STARTUP])
          if (!request.result.objectStoreNames.contains(name))
            request.result.createObjectStore(name, { keyPath: "key" });
      };
      request.onerror = () => {
        clearTimeout(timeout);
        reject(request.error);
      };
      request.onblocked = () => {
        expired = true;
        clearTimeout(timeout);
        reject(new Error("Cache blocked"));
      };
      request.onsuccess = () => {
        clearTimeout(timeout);
        if (closed || expired) {
          request.result.close();
          reject(new Error("Cache closed"));
          return;
        }
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      };
    });
    return opening;
  }
  /** `handler` must issue follow-up requests synchronously (IDB auto-commits). */
  type Then = <R>(request: IDBRequest<R>, handler: (result: R) => void) => void;
  function writeStartupBudget(store: IDBObjectStore, rows: RowBudget[]) {
    if (!rows.length) {
      store.delete(STARTUP_BUDGET);
      return;
    }
    // Older builds still open this version. Their prune puts this marker last
    // and evicts it, so their writes cannot leave a stale budget behind.
    store.put({
      key: STARTUP_BUDGET,
      bytes: MAX_BYTES + 1,
      savedAt: Number.NEGATIVE_INFINITY,
      data: {},
      rows,
    });
  }
  /** Keep the startup store, across identities, within its byte budget.
   * Optional profile mirrors give way before any saved roster. */
  function prune(store: IDBObjectStore, then: Then, updated: RowBudget) {
    then(store.get(STARTUP_BUDGET), (budget) => {
      const known = new Map<string, RowBudget>(
        (budget?.rows as RowBudget[] | undefined)?.map((row) => [row.key, row]),
      );
      known.set(updated.key, updated);
      then(store.getAllKeys(), (keys) => {
        const rows: RowBudget[] = [];
        const missing: string[] = [];
        for (const key of keys) {
          if (
            typeof key !== "string" ||
            key === STARTUP_BUDGET ||
            key.startsWith(ROSTER_SHARD)
          )
            continue;
          const row = known.get(key);
          if (row) rows.push(row);
          else missing.push(key);
        }
        const trim = () => {
          const mirror = (row: RowBudget) => Number(row.key.endsWith(MIRROR));
          let total = 0;
          const kept: RowBudget[] = [];
          for (const row of rows.sort(
            (a, b) => mirror(a) - mirror(b) || b.savedAt - a.savedAt,
          )) {
            total += row.bytes;
            if (total > MAX_BYTES) store.delete(row.key);
            else kept.push(row);
          }
          const prefixes = new Set(
            kept
              .filter(({ roster }) => roster)
              .map(({ key }) => rosterPrefix(key)),
          );
          for (const key of keys)
            if (
              typeof key === "string" &&
              key.startsWith(ROSTER_SHARD) &&
              !prefixes.has(key.slice(0, key.lastIndexOf("/") + 1))
            )
              store.delete(key);
          writeStartupBudget(store, kept);
        };
        // Import sizes once for rows written before the budget was present.
        let pending = missing.length;
        if (pending === 0) trim();
        for (const key of missing)
          then(store.get(key), ({ bytes, savedAt, data }: StartupRow) => {
            const index = rosterIndex(data?.discovery);
            rows.push({
              key,
              bytes: bytes + rosterBytes(index),
              savedAt,
              roster: !!index,
            });
            if (--pending === 0) trim();
          });
      });
    });
  }
  async function transact<T>(
    mode: IDBTransactionMode,
    work: (store: IDBObjectStore, done: (value: T) => void, then: Then) => void,
    name = STORE,
  ): Promise<T> {
    const db = await database();
    if (closed) throw new Error("Cache closed");
    return new Promise<T>((resolve, reject) => {
      const tx = db.transaction(name, mode);
      let result: T;
      let ended = false;
      const timeout = setTimeout(() => {
        ended = true;
        try {
          tx.abort();
        } catch (error) {
          // Native completion can precede its queued event. Let that event
          // settle the operation when the transaction can no longer abort.
          if (
            !(
              error instanceof DOMException &&
              error.name === "InvalidStateError"
            )
          )
            reject(error);
        }
      }, 2000);
      tx.oncomplete = () => {
        clearTimeout(timeout);
        resolve(result);
      };
      tx.onabort = tx.onerror = () => {
        ended = true;
        clearTimeout(timeout);
        reject(tx.error ?? new Error("Cache transaction aborted"));
      };
      work(
        tx.objectStore(name),
        (value) => {
          result = value;
        },
        (request, handler) => {
          request.onsuccess = () => {
            if (ended) return;
            try {
              handler(request.result);
            } catch (error) {
              // WebKit delivers a queued success after a browser-initiated abort.
              if (
                !(
                  error instanceof DOMException &&
                  error.name === "TransactionInactiveError"
                )
              )
                throw error;
              ended = true;
            }
          };
        },
      );
    });
  }
  return {
    readStartup: (mode) =>
      transact<SavedStartup | undefined>(
        "readonly",
        (store, done, then) =>
          then(store.get(scope), (row: StartupRow | undefined) => {
            const data = row?.data;
            const index = rosterIndex(data?.discovery);
            if (!data?.discovery) return done(data as SavedStartup | undefined);
            const { savedAt, relayAuthor } = data.discovery;
            if (mode === "header")
              return done({
                ...data,
                discovery: { savedAt, relayAuthor, events: [] },
              });
            if (!index) return done(data as SavedStartup);
            then(
              store.getAll(rosterKeys(scope)),
              (rows: { key: string; data: unknown[]; hash: string }[]) => {
                const held = new Map(rows.map((row) => [row.key, row]));
                const events: unknown[] = [];
                for (const [number, expected] of index.shards.entries()) {
                  if (!expected) continue;
                  const shard = held.get(rosterKey(scope, number));
                  // A legacy client can evict a single shard. Keep sidebar
                  // settings, but wait for live discovery for this roster.
                  if (
                    shard?.hash !== expected.hash ||
                    !Array.isArray(shard.data)
                  )
                    return done({ ...data, discovery: undefined });
                  for (const event of shard.data) events.push(event);
                }
                done({
                  ...data,
                  discovery: { savedAt, relayAuthor, events },
                });
              },
            );
          }),
        STARTUP,
      ),
    writeStartup: (patch, revoked = false) =>
      transact(
        "readwrite",
        (store, done, then) =>
          then(store.get(scope), (row: StartupRow | undefined) => {
            const data: StartupData = { ...row?.data, ...patch };
            const shards = patch.discovery
              ? shardDiscovery(patch.discovery.events)
              : undefined;
            if (patch.discovery && shards) {
              const { savedAt, relayAuthor } = patch.discovery;
              data.discovery = {
                savedAt,
                relayAuthor,
                shards: shards.map((shard) => shard?.meta ?? null),
              };
            }
            let index = rosterIndex(data.discovery);
            let bytes = byteSize(data);
            if (bytes + rosterBytes(index) > MAX_BYTES && revoked) {
              // Keep preferences even when a revocation cannot save a new roster.
              store.delete(rosterKeys(scope));
              delete data.discovery;
              index = undefined;
              bytes = byteSize(data);
            }
            const total = bytes + rosterBytes(index);
            if (total > MAX_BYTES) return;
            const meta = { key: scope, bytes, savedAt: Date.now() };
            const save = () => {
              store.put({ ...meta, data });
              prune(store, then, { ...meta, bytes: total, roster: !!index });
              done(undefined);
            };
            if (!shards || !index) {
              save();
              return;
            }
            const previous = rosterIndex(row?.data.discovery);
            // A legacy build can evict an individual shard. Check keys without
            // transferring values so the next roster save repairs a partial copy.
            then(store.getAllKeys(rosterKeys(scope)), (keys) => {
              const held = new Set(keys);
              for (const [number, shard] of shards.entries()) {
                const key = rosterKey(scope, number);
                if (!shard) {
                  if (held.has(key)) store.delete(key);
                } else if (
                  !held.has(key) ||
                  previous?.shards[number]?.hash !== shard.meta.hash
                ) {
                  store.put({
                    key,
                    bytes: shard.meta.bytes,
                    hash: shard.meta.hash,
                    savedAt: meta.savedAt,
                    data: shard.events,
                  });
                }
              }
              save();
            });
          }),
        STARTUP,
      ),
    readProfiles: () =>
      transact(
        "readonly",
        (store, done, then) =>
          then(store.get(profiles), (row) => done(row?.data ?? [])),
        STARTUP,
      ),
    writeProfiles: (events) =>
      transact(
        "readwrite",
        (store, done, then) => {
          const bytes = byteSize(events);
          if (bytes <= MAX_BYTES) {
            const meta = { key: profiles, bytes, savedAt: Date.now() };
            store.put({ ...meta, data: events });
            prune(store, then, meta);
          }
          done(undefined);
        },
        STARTUP,
      ),
    read: () =>
      transact("readonly", (store, done, then) =>
        then(store.getAll(historyKeys()), (rows: Record[]) =>
          done(
            rows
              .filter(
                (row) =>
                  row.scope === scope && Date.now() - row.savedAt < MAX_AGE,
              )
              .sort((a, b) => b.savedAt - a.savedAt)
              .slice(0, MAX_HEADS),
          ),
        ),
      ),
    write: (head) =>
      transact("readwrite", (store, done, then) => {
        const bytes = byteSize(head);
        if (bytes > MAX_BYTES) {
          done(undefined);
          return;
        }
        const row: Record = {
          ...head,
          scope,
          key: `${scope}:${head.channelId}`,
          bytes,
        };
        store.put(row);
        putHeadMeta(store, row);
        const size = store.count();
        const pruneHeads = (rows: RowBudget[]) => {
          // Global disk budget across identities; scope is still required for every read.
          let total = 0,
            count = 0;
          for (const entry of rows.sort((a, b) => b.savedAt - a.savedAt)) {
            total += entry.bytes;
            count++;
            if (
              total > MAX_BYTES ||
              count > MAX_HEADS ||
              Date.now() - entry.savedAt >= MAX_AGE
            )
              deleteHead(store, entry.key);
          }
          done(undefined);
        };
        const metadata = metadataKeys();
        then(store.getAll(metadata), (rows: { head: RowBudget }[]) => {
          // New writes keep one metadata row per head. An older writer drops
          // all metadata, and an older point delete can leave an extra row.
          if (size.result === 2 * rows.length) {
            pruneHeads(rows.map((row) => row.head));
            return;
          }
          then(store.getAll(historyKeys()), (heads: Record[]) => {
            store.delete(metadata);
            for (const head of heads) putHeadMeta(store, head);
            pruneHeads(heads);
          });
        });
      }),
    remove: (channelId) =>
      transact("readwrite", (store, done) => {
        deleteHead(store, `${scope}:${channelId}`);
        done(undefined);
      }),
    retain: (ids) =>
      transact("readwrite", (store, done, then) => {
        const allowed = new Set(ids);
        then(store.getAll(), (rows: ScopedRow[]) => {
          for (const row of rows)
            if (row.scope === scope && !allowed.has(row.channelId))
              store.delete(row.key);
          done(undefined);
        });
      }),
    clear: async () => {
      await transact(
        "readwrite",
        (store, done, then) => {
          store.delete(scope);
          store.delete(profiles);
          store.delete(rosterKeys(scope));
          then(store.get(STARTUP_BUDGET), (budget) => {
            if (!budget) return;
            writeStartupBudget(
              store,
              (budget.rows as RowBudget[]).filter(
                ({ key }) => key !== scope && key !== profiles,
              ),
            );
          });
          done(undefined);
        },
        STARTUP,
      );
      await transact("readwrite", (store, done, then) =>
        // Include metadata left by a point delete on an older build.
        then(store.getAll(), (rows: ScopedRow[]) => {
          for (const row of rows)
            if (row.scope === scope) store.delete(row.key);
          done(undefined);
        }),
      );
    },
    close() {
      closed = true;
      void opening?.then(
        (db) => db.close(),
        () => {},
      );
    },
  };
}
