// Reader-to-host priority propagation control contributed by Brain.

import { afterEach, expect, it, vi } from "vitest";
import { connectSignedTransport } from "./transport";
import { API_ACTIVE_LIMIT } from "./http-admission";
import { createRelayReader, READ_SLOTS } from "./reader";
import { hostSigner } from "./testing";
afterEach(() => {
  vi.useRealTimers();
});
it("production reader prioritizes queued work at real capacity, not a clock interval", async () => {
  vi.useFakeTimers();
  const calls: number[] = [];
  const release: Array<() => void> = [];
  const signer = hostSigner(undefined, async (_url, body) => {
    calls.push(JSON.parse(body)[0].limit);
    await new Promise<void>((resolve) => release.push(resolve));
    return Response.json([]);
  });
  const t = await connectSignedTransport(
    signer,
    "https://priority-review.test",
    "relay",
  );
  const r = createRelayReader(t);
  try {
    const full = READ_SLOTS;
    const active = Array.from({ length: full }, (_, i) =>
      r.reader.read([{ kinds: [0], limit: i + 1 }]),
    );
    await vi.waitFor(() => expect(calls).toHaveLength(full));
    const b = r.reader.read([{ kinds: [0], limit: full + 1 }], {
      priority: "background",
    });
    const f = r.reader.read([{ kinds: [0], limit: full + 2 }], {
      priority: "foreground",
    });
    release.shift()?.();
    await vi.waitFor(() => expect(calls).toHaveLength(full + 1));
    expect(calls.at(-1)).toBe(full + 2);
    release.shift()?.();
    await vi.waitFor(() => expect(calls).toHaveLength(full + 2));
    expect(calls.at(-1)).toBe(full + 1);
    for (const finish of release) finish();
    await Promise.all([...active, b, f]);
  } finally {
    r.dispose();
  }
});

it("signed transport forwards query priority to host request admission", async () => {
  const calls: number[] = [];
  const release: Array<() => void> = [];
  const t = await connectSignedTransport(
    hostSigner(undefined, async (_url, body) => {
      calls.push(JSON.parse(body)[0].limit);
      await new Promise<void>((resolve) => release.push(resolve));
      return Response.json([]);
    }),
    "https://priority-forwarding.test",
    "relay",
  );
  const full = API_ACTIVE_LIMIT;
  const active = Array.from({ length: full }, (_, i) =>
    t.query([{ kinds: [0], limit: i + 1 }]),
  );
  await vi.waitFor(() => expect(calls).toHaveLength(full));
  const background = t.query(
    [{ kinds: [0], limit: full + 1 }],
    undefined,
    "read",
    "background",
  );
  const foreground = t.query(
    [{ kinds: [0], limit: full + 2 }],
    undefined,
    "read",
    "foreground",
  );
  release.shift()?.();
  await vi.waitFor(() => expect(calls).toHaveLength(full + 1));
  expect(calls.at(-1)).toBe(full + 2);
  release.shift()?.();
  await vi.waitFor(() => expect(calls).toHaveLength(full + 2));
  expect(calls.at(-1)).toBe(full + 1);
  for (const finish of release) finish();
  await Promise.all([...active, background, foreground]);
});
