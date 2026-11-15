// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { RelaySession } from "../../features/relay/session";
import type { UnreadSnapshot } from "../../features/relay/unread";
import type { Navigation } from "../../features/navigation/controller";
import { CatchUpView } from "./CatchUpPage";
import { apply } from "./index";

afterEach(cleanup);
const scope = { viewer: "viewer", communityOrigin: "https://example.org" };
function setup() {
  const listeners = new Set<() => void>();
  const state = new Map<string, UnreadSnapshot>(
    ["one", "two"].map((id) => [
      id,
      {
        target: { kind: "channel", channelId: id },
        observedCount: 2,
        attentionCount: 0,
        coverage: "observed",
        freshness: "observed",
        manual: "none",
      },
    ]),
  );
  const list = {
    status: "ready",
    channels: [
      {
        id: "one",
        name: "First",
        preview: "First preview",
        members: ["viewer"],
        lastActivityAt: 2,
      },
      {
        id: "two",
        name: "Second",
        preview: "Second preview",
        members: ["viewer"],
        lastActivityAt: 1,
      },
      { id: "archived", name: "Archived", members: ["viewer"], archived: true },
      { id: "other", name: "Not joined", members: ["other"] },
    ],
  };
  const markChannelRead = vi.fn(async (id: string) => {
    state.set(id, { ...(state.get(id) as UnreadSnapshot), observedCount: 0 });
    for (const listener of listeners) listener();
  });
  const reading = vi.fn();
  const sync = {
    status: "local",
    capability: "unsupported",
    completeness: "snapshot",
  };
  const session = {
    channels: {
      ensureList: vi.fn(),
      list: () => list,
      subscribeList: () => () => {},
      refreshList: vi.fn(),
    },
    unread: {
      sync: () => sync,
      subscribeSync: () => () => {},
      snapshot: ({ channelId }: { channelId: string }) =>
        state.get(channelId) ?? { observedCount: 0, manual: "none" },
      subscribe: (_: unknown, listener: () => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      ensure: vi.fn(async () => {}),
      refresh: vi.fn(async () => {}),
      markChannelRead,
      reading,
    },
  } as unknown as RelaySession;
  const open = vi.fn(async () => ({ status: "opened" }));
  const view = render(
    <CatchUpView
      session={session}
      scope={scope}
      navigator={{ open } as unknown as Navigation}
    />,
  );
  return { ...view, session, state, listeners, open, markChannelRead, reading };
}
async function ready() {
  await waitFor(() =>
    expect(screen.queryByText("Checking unread conversations…")).toBeNull(),
  );
}

it("previews without reading and keeps skipped conversations unread", async () => {
  const { markChannelRead, reading } = setup();
  await ready();
  expect(screen.getByText("First preview")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep unread" }));
  expect(screen.getByText("Second preview")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Keep unread" }));
  expect(screen.getByText("Review complete")).toBeTruthy();
  expect(markChannelRead).not.toHaveBeenCalled();
  expect(reading).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Check again" }));
  await ready();
  expect(screen.getByText("First preview")).toBeTruthy();
});

it("advances only after the read save completes and shared unread updates", async () => {
  const { markChannelRead, state, listeners } = setup();
  await ready();
  let finish!: () => void;
  markChannelRead.mockImplementationOnce(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  expect(screen.getByText("First preview")).toBeTruthy();
  expect(
    (screen.getByRole("button", { name: "Keep unread" }) as HTMLButtonElement)
      .disabled,
  ).toBe(true);
  await act(async () => {
    state.set("one", {
      ...(state.get("one") as UnreadSnapshot),
      observedCount: 0,
    });
    finish();
    for (const listener of listeners) listener();
  });
  expect(screen.getByText("Second preview")).toBeTruthy();
  expect(markChannelRead).toHaveBeenCalledExactlyOnceWith("one");
});

it("retains the card after a failed read and allows retry", async () => {
  const { markChannelRead } = setup();
  await ready();
  markChannelRead.mockRejectedValueOnce(new Error("Save failed"));
  fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  await screen.findByRole("alert");
  expect(screen.getByText("Save failed")).toBeTruthy();
  expect(screen.getByText("First preview")).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Mark as read" }));
  await screen.findByText("Second preview");
});

it("opens the current conversation through host navigation", async () => {
  const { open, markChannelRead } = setup();
  await ready();
  fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
  expect(open).toHaveBeenCalledExactlyOnceWith({
    version: 1,
    kind: "conversation",
    scope,
    channelId: "one",
  });
  expect(markChannelRead).not.toHaveBeenCalled();
});

it("releases subscriptions when closed", async () => {
  const { listeners, unmount } = setup();
  await ready();
  expect(listeners.size).toBeGreaterThan(0);
  unmount();
  expect(listeners.size).toBe(0);
});

it("registers Catch up as a primary plugin page", () => {
  const register = vi.fn();
  apply({
    pages: { register },
    relay: {},
    navigation: {},
  } as unknown as Parameters<typeof apply>[0]);
  expect(register).toHaveBeenCalledWith(
    expect.objectContaining({
      id: "catch-up",
      title: "Catch up",
      primary: true,
    }),
  );
});

it("shows unread repair failures returned through snapshots, including with an empty queue", async () => {
  const { state, listeners } = setup();
  await ready();
  act(() => {
    for (const [id, value] of state)
      state.set(id, {
        ...value,
        observedCount: 0,
        error: "Unread repair failed",
      });
    for (const listener of listeners) listener();
  });
  expect(screen.getByRole("alert").textContent).toContain(
    "Unread repair failed",
  );
  expect(screen.queryByText("No unread conversations observed")).toBeNull();
  expect(screen.getByRole("button", { name: "Retry" })).toBeTruthy();
});
