// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, expect, it } from "vitest";
import { SidebarSection } from "./SidebarSection";
import { UnreadDmPreviews } from "./SidebarUnread";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const previews = new Map([
  ["dm-ana", { name: "Ana" }],
  ["dm-bo", { name: "Bo" }],
]);

function Row({ id, unread }: { id: string; unread?: boolean }) {
  return (
    <div data-card-row="">
      <button type="button" data-channel-id={id}>
        {id}
        {unread && <span data-channel-unread="" />}
      </button>
    </div>
  );
}

function Card({ initiallyOpen }: { initiallyOpen: boolean }) {
  const [open, setOpen] = useState(initiallyOpen);
  const [unread, setUnread] = useState(true);
  return (
    <UnreadDmPreviews.Provider value={previews}>
      <SidebarSection
        sectionKey="dms"
        title="Direct messages"
        open={open}
        onToggle={setOpen}
        heightScope="test"
      >
        <Row id="general" unread />
        <Row id="dm-ana" unread={unread} />
        <Row id="dm-bo" />
      </SidebarSection>
      <button type="button" onClick={() => setUnread(false)}>
        Read Ana
      </button>
    </UnreadDmPreviews.Provider>
  );
}

it("offers a collapsed card's unread DMs only, then restores it from the same spot", async () => {
  const user = userEvent.setup();
  render(<Card initiallyOpen={false} />);
  const card = screen
    .getByLabelText("Direct messages")
    .closest("[data-sidebar-section]");
  // Channels and read DMs never count.
  await user.click(
    await screen.findByRole("button", {
      name: "1 unread DM, show only these",
    }),
  );
  expect(card?.querySelector("details")).toHaveAttribute("open");
  expect(card).toHaveAttribute("data-only-unread-dms");
  expect(
    screen.getByRole("button", { name: "dm-ana" }).closest("[data-card-row]"),
  ).toHaveAttribute("data-unread-dm-row");
  expect(
    screen.getByRole("button", { name: "general" }).closest("[data-card-row]"),
  ).not.toHaveAttribute("data-unread-dm-row");
  await user.click(
    screen.getByRole("button", { name: "Show all conversations" }),
  );
  expect(card).not.toHaveAttribute("data-only-unread-dms");
  expect(card?.querySelector("details")).not.toHaveAttribute("open");
});

it("ends the DM-only view once nothing is unread, leaving the card open", async () => {
  const user = userEvent.setup();
  render(<Card initiallyOpen={false} />);
  await user.click(
    await screen.findByRole("button", {
      name: "1 unread DM, show only these",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Read Ana" }));
  const card = screen
    .getByLabelText("Direct messages")
    .closest("[data-sidebar-section]");
  await waitFor(() => expect(card).not.toHaveAttribute("data-only-unread-dms"));
  expect(card?.querySelector("details")).toHaveAttribute("open");
  expect(
    screen.queryByRole("button", { name: /unread DM|Show all/ }),
  ).toBeNull();
});
