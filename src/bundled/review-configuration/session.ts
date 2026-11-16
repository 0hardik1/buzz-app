import type { RelaySession } from "../../features/relay/session";
import {
  rememberTriage,
  forgetTriage,
  type TriageHint,
} from "./triage-recovery";

/** Capabilities shared by the app and the explicitly provisioned server worker. */
export type ReviewSession = Pick<
  RelaySession,
  "viewer" | "scope" | "snapshotRead" | "configArtifactWriter" | "outbox"
> & {
  channels: Pick<RelaySession["channels"], "list" | "refreshRoster">;
  channelDetails: Pick<RelaySession["channelDetails"], "load">;
  agentChoices: Pick<RelaySession["agentChoices"], "refresh" | "snapshot">;
  reviewRuntime?: {
    device: string;
    lock<T>(signal: AbortSignal, run: () => Promise<T>): Promise<T>;
    remember(hint: TriageHint): void;
    forget(artifact: string): void;
  };
};
export const reviewDevice = (session: ReviewSession) =>
  session.reviewRuntime?.device ?? deviceId(session.scope);
export const reviewLockAvailable = (session: ReviewSession) =>
  !!session.reviewRuntime || !!globalThis.navigator?.locks;
export function reviewLocks(session: ReviewSession): {
  request<T>(
    name: string,
    options: { signal: AbortSignal },
    run: () => Promise<T>,
  ): Promise<T>;
} {
  const runtime = session.reviewRuntime;
  return runtime
    ? { request: (_name, { signal }, run) => runtime.lock(signal, run) }
    : navigator.locks;
}
export function rememberReviewTriage(session: ReviewSession, hint: TriageHint) {
  if (session.reviewRuntime) session.reviewRuntime.remember(hint);
  else rememberTriage(session.scope, hint);
}
export function forgetReviewTriage(session: ReviewSession, artifact: string) {
  if (session.reviewRuntime) session.reviewRuntime.forget(artifact);
  else forgetTriage(session.scope, artifact);
}

/** Device ownership is recovery coordination, never permission. The relay still
 * authorizes every write. Shared Web Locks serialize tabs; artifact create/CAS
 * serializes devices. Losing this profile cannot authorize replacement sends. */
export function deviceId(scope: string) {
  const key = `buzz.review.device:${scope}`;
  let value = localStorage.getItem(key);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(key, value);
  }
  if (!/^[0-9a-f-]{36}$/.test(value))
    throw new Error("Submission recovery storage is unavailable.");
  return value;
}
