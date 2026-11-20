// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../../features/relay/session";
import { sideChatSourceKey } from "../../features/solo/side-chat";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { readView, writeView } from "../../shared/view-state";
import { PostToThread, canPostToThread } from "./PostToThread";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
const viewer = "a".repeat(64),
  agent = "b".repeat(64),
  root = "c".repeat(64);
const scope = `https://relay.example.org:${viewer}`;
const send = vi.fn();
const session = {
  viewer,
  scope,
  messages: { send, reply: send },
} as unknown as RelaySession;
const answer = {
  id: "d".repeat(64),
  channelId: "side",
  authorId: agent,
  delivery: "seen" as const,
  content: "The cache key changed in **#412**.",
  createdAt: 1,
  mentions: [],
  participants: [],
  attachments: [],
  reactions: [],
  replyCount: 0,
};
const threadDraft = `draft:design:thread:${root}`;
const asked = () =>
  writeView(scope, sideChatSourceKey("side"), {
    channelId: "design",
    rootId: root,
  });

it("offers Post to thread on agent messages in a side chat asked from this device", () => {
  expect(canPostToThread(answer, session)).toBe(false);
  asked();
  expect(canPostToThread(answer, session)).toBe(true);
  expect(canPostToThread({ ...answer, authorId: viewer }, session)).toBe(false);
  expect(canPostToThread({ ...answer, delivery: "sending" }, session)).toBe(
    false,
  );
});

it("adds the message to the thread's draft and opens the thread without sending", async () => {
  asked();
  writeView(scope, threadDraft, "Summary:");
  const open = vi.fn((_target: string) => true);
  const close = vi.fn();
  render(
    <StrictMode>
      <ToastProvider>
        <PostToThread
          message={answer}
          session={session}
          open={open}
          close={close}
        />
      </ToastProvider>
    </StrictMode>,
  );
  await waitFor(() => expect(close).toHaveBeenCalledOnce());
  expect(readView(scope, threadDraft, null)).toEqual({
    text: "Summary:\n\nThe cache key changed in **#412**.",
    recipients: [],
  });
  expect(open).toHaveBeenCalledExactlyOnceWith(
    `buzz://message?channel=design&id=${root}`,
  );
  expect(send).not.toHaveBeenCalled();
});
