import { createHash, randomUUID } from "node:crypto";
import { decode } from "nostr-tools/nip19";
import { finalizeEvent, getPublicKey } from "nostr-tools/pure";
import { hexToBytes } from "nostr-tools/utils";
import { eventsDto, type RelayEvent } from "../../../features/relay/events";
import type { RelayReader } from "../../../features/relay/reader";
import type { RelayWriter } from "../../../features/relay/transport";
import { PublishRejected } from "../../../features/relay/outbox";

/** Bounded authenticated HTTP. Exact signed events survive uncertain delivery. */
export async function boundedJson(
  response: Response,
  maxBytes = 8 * 1024 * 1024,
): Promise<unknown> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Empty HTTP response.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.length;
      if (size > maxBytes)
        throw new Error("HTTP response exceeded its byte limit.");
      chunks.push(part.value);
    }
  } finally {
    await reader.cancel();
  }
  if (!response.ok)
    throw new Error(`HTTP request failed (${response.status}).`);
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}
export function reviewTransport(options: {
  relay: string;
  key: string;
  signal: AbortSignal;
}) {
  const base = options.relay.replace(/^ws/, "http").replace(/\/+$/, "");
  const url = new URL(base);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    url.pathname !== "/" ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error(
      "Use an HTTPS community origin (HTTP is allowed only for loopback tests).",
    );
  let key: Uint8Array;
  try {
    key = options.key.startsWith("nsec1")
      ? (decode(options.key as `nsec1${string}`).data as Uint8Array)
      : hexToBytes(options.key);
    getPublicKey(key);
  } catch {
    throw new Error("The provisioned signing key is invalid.");
  }
  const viewer = getPublicKey(key);
  const signalFor = (signal?: AbortSignal) =>
    AbortSignal.any([
      options.signal,
      AbortSignal.timeout(20_000),
      ...(signal ? [signal] : []),
    ]);
  async function request(path: string, body: unknown, signal?: AbortSignal) {
    const text = JSON.stringify(body);
    const endpoint = `${base}${path}`;
    const auth = finalizeEvent(
      {
        kind: 27235,
        created_at: Math.floor(Date.now() / 1000),
        content: "",
        tags: [
          ["u", endpoint],
          ["method", "POST"],
          ["payload", createHash("sha256").update(text).digest("hex")],
          ["nonce", randomUUID()],
        ],
      },
      key,
    );
    return boundedJson(
      await fetch(endpoint, {
        method: "POST",
        redirect: "error",
        signal: signalFor(signal),
        headers: {
          authorization: `Nostr ${Buffer.from(JSON.stringify(auth)).toString("base64")}`,
          "content-type": "application/json",
        },
        body: text,
      }),
    );
  }
  const reader: RelayReader = {
    async read(filters, options) {
      return eventsDto(await request("/query", filters, options?.signal));
    },
  };
  const writer: RelayWriter = {
    kinds: [7, 9, 45010],
    async sign(event, signal) {
      signal.throwIfAborted();
      return finalizeEvent(
        {
          kind: event.kind,
          content: event.content,
          created_at: event.created_at,
          tags: event.tags.map((tag) => [...tag]),
        },
        key,
      ) as RelayEvent;
    },
    async publish(event, signal) {
      signal.throwIfAborted();
      if (event.pubkey !== viewer)
        throw new Error("Event signer does not match the worker.");
      const result = (await request("/events", event, signal)) as {
        accepted?: boolean;
        message?: string;
      };
      if (!result.accepted && !result.message?.startsWith("duplicate"))
        throw new PublishRejected(
          "The relay refused the review event.",
          result.message,
        );
      return event.id;
    },
  };
  return {
    viewer,
    base,
    reader,
    writer,
    async authority() {
      const response = (await boundedJson(
        await fetch(base, {
          headers: { Accept: "application/nostr+json" },
          redirect: "error",
          signal: signalFor(),
        }),
        256 * 1024,
      )) as { self?: string };
      if (!response.self || !/^[0-9a-f]{64}$/.test(response.self))
        throw new Error(
          "The community did not advertise its signing authority.",
        );
      return response.self;
    },
  };
}
