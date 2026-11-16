// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, test, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { RelaySession } from "../../features/relay/session";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { TeamViewMenu } from "./TeamViewMenu";
const index = vi.hoisted(() => ({ keys: vi.fn(), event: vi.fn() }));
vi.mock("../../features/conversation/conversation-index", () => ({
  conversationIndex: () => index,
}));
afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

test("right-click marks only matching threads read and continues after a failed save", async () => {
  index.keys.mockReturnValue(["e:first", "e:second"]);
  index.event.mockImplementation((key) => ({
    channelId: "channel",
    rootId: key,
    messageId: key,
  }));
  const first = vi.fn().mockRejectedValue(new Error("offline"));
  const second = vi.fn().mockResolvedValue(undefined);
  const unread = {
    sync: () => ({ capability: "frontier-sync" }),
    prepareThreadRead: vi.fn((_channel, root) =>
      root === "first" ? first : second,
    ),
    markChannelRead: vi.fn(),
  };
  const navigate = vi.fn();
  render(
    <ToastProvider>
      <TeamViewMenu
        session={{ unread } as unknown as RelaySession}
        filter="threads"
      >
        <button type="button" onClick={navigate}>
          Threads
        </button>
      </TeamViewMenu>
    </ToastProvider>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Threads" }), {
    clientX: 20,
    clientY: 20,
  });
  expect(
    await screen.findByRole("menuitem", { name: "Mark as read" }),
  ).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "Mark as unread" })).toBeNull();
  await userEvent.click(screen.getByRole("menuitem", { name: "Mark as read" }));
  await waitFor(() => expect(second).toHaveBeenCalledOnce());
  expect(index.keys).toHaveBeenCalledWith({
    filter: "threads",
    unread: true,
    home: "team",
  });
  expect(unread.markChannelRead).not.toHaveBeenCalled();
  expect(navigate).not.toHaveBeenCalled();
  expect(
    await screen.findByText("Couldn't update 1 item. Try again."),
  ).toBeVisible();
});

test("marks matching mentions unread locally without changing their whole channel", async () => {
  index.keys.mockImplementation((query) => (query.unread ? [] : ["e:mention"]));
  index.event.mockReturnValue({ channelId: "channel", messageId: "message" });
  const unread = {
    sync: () => ({ capability: "frontier-sync" }),
    markUnreadLocal: vi.fn().mockResolvedValue(undefined),
  };
  render(
    <ToastProvider>
      <TeamViewMenu
        session={{ unread } as unknown as RelaySession}
        filter="mentions"
      >
        <button type="button">Mentions</button>
      </TeamViewMenu>
    </ToastProvider>,
  );
  fireEvent.contextMenu(screen.getByRole("button", { name: "Mentions" }), {
    clientX: 20,
    clientY: 20,
  });
  expect(
    await screen.findByRole("menuitem", { name: "Mark as unread" }),
  ).toBeVisible();
  expect(screen.queryByRole("menuitem", { name: "Mark as read" })).toBeNull();
  await userEvent.click(
    screen.getByRole("menuitem", { name: "Mark as unread" }),
  );
  await waitFor(() =>
    expect(unread.markUnreadLocal).toHaveBeenCalledWith({
      kind: "message",
      channelId: "channel",
      messageId: "message",
    }),
  );
  expect(index.keys).toHaveBeenCalledWith({
    filter: "mentions",
    unread: false,
    home: "team",
  });
});
