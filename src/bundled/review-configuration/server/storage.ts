import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { join } from "node:path";
import type { OutboxStorage } from "../../../features/relay/outbox";

/** One process per persistent volume. SQLite releases ownership on process death;
 * no PID guessing, expiring lease or unsafe takeover of another writer's journal. */
export function reviewStorage(directory: string, scope: string) {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const owner = new DatabaseSync(join(directory, "owner.sqlite"));
  try {
    owner.exec("BEGIN EXCLUSIVE");
  } catch {
    owner.close();
    throw new Error("Another review worker owns this storage directory.");
  }
  const db = new DatabaseSync(join(directory, "review.sqlite"));
  db.exec(
    "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS state (key TEXT PRIMARY KEY, value TEXT NOT NULL)",
  );
  chmodSync(join(directory, "review.sqlite"), 0o600);
  const read = db.prepare("SELECT value FROM state WHERE key = ?");
  const write = db.prepare(
    "INSERT INTO state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  );
  const get = <T>(key: string): T | undefined => {
    const row = read.get(key);
    return row ? (JSON.parse(String(row.value)) as T) : undefined;
  };
  const set = (key: string, value: unknown) => {
    write.run(key, JSON.stringify(value));
  };
  if (get<string>("scope") && get<string>("scope") !== scope) {
    db.close();
    owner.close();
    throw new Error(
      "Server storage belongs to another relay or signing identity.",
    );
  }
  set("scope", scope);
  const device = get<string>("device") ?? crypto.randomUUID();
  set("device", device);
  let tail: Promise<unknown> = Promise.resolve();
  function lock<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T> {
    const next = tail
      .catch(() => {})
      .then(() => {
        signal.throwIfAborted();
        return run();
      });
    tail = next;
    return next;
  }
  let finishDelivery!: () => void;
  const deliveryClosed = new Promise<void>((resolve) => {
    finishDelivery = resolve;
  });
  const outbox: OutboxStorage = {
    close: () => finishDelivery(),
    load: () => get("outbox") ?? [],
    save: (operations) => set("outbox", operations),
  };
  return {
    get,
    set,
    device,
    lock,
    outbox,
    deliveryClosed,
    // Triage recovery is enumerated from current submission artifacts each tick.
    remember() {},
    forget() {},
    close() {
      db.close();
      owner.close();
    },
  };
}
