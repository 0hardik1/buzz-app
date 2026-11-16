// The relay's own answer to "what may this viewer do in these channels"
// (`buzz-channel-access`): one entry per readable channel, from the same
// decision the relay makes on every read and post. It is a snapshot; the
// relay still checks every post.
import { ReadError } from "./errors";

/** Relay NIP-11 `supported_extensions` entry for the access answer. */
export const CHANNEL_ACCESS_EXTENSION = "buzz-channel-access";
/** Relay-signed, empty, `h`-tagged: ask again about this channel's access. */
export const ACCESS_CHANGED_KIND = 20004;
/** Most channels one request may name. */
export const CHANNEL_ACCESS_LIMIT = 100;

export type ChannelAccess = Readonly<{
  post: boolean;
  joined: boolean;
  /** Absent when the relay gave no answer and only reading is proven. */
  role?: "owner" | "admin" | "member" | "guest";
}>;

/** A complete answer: an id it leaves out is not readable by the viewer. */
export type ChannelAccessAnswer = ReadonlyMap<string, ChannelAccess>;

export type ChannelAccessReader = (
  ids: readonly string[],
  signal: AbortSignal,
) => Promise<ChannelAccessAnswer>;

const roles = new Set(["owner", "admin", "member", "guest"]);
const channelId = /^[a-zA-Z0-9_-]{1,128}$/;

export function channelAccessCapability(info: unknown): boolean {
  const extensions =
    typeof info === "object" && info !== null
      ? (info as { supported_extensions?: unknown }).supported_extensions
      : undefined;
  return (
    Array.isArray(extensions) && extensions.includes(CHANNEL_ACCESS_EXTENSION)
  );
}

export function channelAccessRequest(ids: readonly string[]) {
  if (
    ids.length < 1 ||
    ids.length > CHANNEL_ACCESS_LIMIT ||
    new Set(ids).size !== ids.length ||
    ids.some((id) => !channelId.test(id))
  )
    throw new Error("Invalid channel access request");
  return [{ access: "channels", ids: [...ids] }];
}

/** Strict: anything but a well-formed answer about exactly the requested ids
 * is a failed check, never a partial one that would read as lost access. */
export function parseChannelAccess(
  body: unknown,
  ids: readonly string[],
): ChannelAccessAnswer {
  const invalid = () =>
    new ReadError("invalid-response", "Invalid channel access answer");
  if (!Array.isArray(body) || body.length > ids.length) throw invalid();
  const wanted = new Set(ids);
  const answer = new Map<string, ChannelAccess>();
  for (const entry of body) {
    if (typeof entry !== "object" || entry === null) throw invalid();
    const { id, read, post, joined, role } = entry as Record<string, unknown>;
    if (
      typeof id !== "string" ||
      !wanted.has(id) ||
      answer.has(id) ||
      read !== true ||
      typeof post !== "boolean" ||
      typeof joined !== "boolean" ||
      typeof role !== "string" ||
      !roles.has(role) ||
      (role === "guest" && post)
    )
      throw invalid();
    answer.set(
      id,
      Object.freeze({
        post,
        joined,
        role: role as NonNullable<ChannelAccess["role"]>,
      }),
    );
  }
  return answer;
}

/** Every failed request is "couldn't check": retryable, never a denial. */
export function createChannelAccessReader(
  request: (body: unknown, signal: AbortSignal) => Promise<Response>,
): ChannelAccessReader {
  return async (ids, signal) => {
    const response = await request(channelAccessRequest(ids), signal);
    signal.throwIfAborted();
    if (!response.ok)
      throw new ReadError(
        "unavailable",
        `Channel access check failed (${response.status})`,
        response.status,
      );
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new ReadError("invalid-response", "Invalid channel access answer");
    }
    return parseChannelAccess(body, ids);
  };
}
