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

function Row({
  id,
  unread,
  selected,
}: {
  id: string;
  unread?: boolean;
  selected?: boolean;
}) {
  return (
    <div data-card-row="">
      <div data-selected={selected || undefined}>
        <button type="button" data-channel-id={id}>
          {id}
          {unread && <span data-channel-unread="" />}
        </button>
      </div>
    </div>
  );
}

function Card({
  initiallyOpen,
  boUnread = false,
}: {
  initiallyOpen: boolean;
  boUnread?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const [unread, setUnread] = useState(true);
  const [selected, setSelected] = useState<string>();
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
        <Row id="dm-ana" unread={unread} selected={selected === "dm-ana"} />
        <Row id="dm-bo" unread={boUnread} selected={selected === "dm-bo"} />
      </SidebarSection>
      <button
        type="button"
        onClick={() => {
          setSelected("dm-ana");
          setUnread(false);
        }}
      >
        Open Ana
      </button>
      <button type="button" onClick={() => setSelected("dm-bo")}>
        Open Bo
      </button>
      <button type="button" onClick={() => setSelected(undefined)}>
        Leave
      </button>
    </UnreadDmPreviews.Provider>
  );
}

const cardOf = () =>
  screen.getByLabelText("Direct messages").closest("[data-sidebar-section]");

it("offers a collapsed card's unread DMs only, then restores it from the same spot", async () => {
  const user = userEvent.setup();
  render(<Card initiallyOpen={false} />);
  const card = cardOf();
  // Channels and read DMs never count, and one face needs no number.
  const pill = await screen.findByRole("button", {
    name: "1 unread DM, show only these",
  });
  expect(pill).not.toHaveTextContent("1");
  await user.click(pill);
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

it("never counts the DM that is open", async () => {
  const user = userEvent.setup();
  render(<Card initiallyOpen={false} boUnread />);
  expect(
    await screen.findByRole("button", {
      name: "2 unread DMs, show only these",
    }),
  ).toHaveTextContent("2 unread");
  await user.click(screen.getByRole("button", { name: "Open Bo" }));
  expect(
    await screen.findByRole("button", {
      name: "1 unread DM, show only these",
    }),
  ).toBeInTheDocument();
});

it("ends the DM-only view once nothing is unread, collapsing after you leave", async () => {
  const user = userEvent.setup();
  render(<Card initiallyOpen={false} />);
  await user.click(
    await screen.findByRole("button", {
      name: "1 unread DM, show only these",
    }),
  );
  await user.click(screen.getByRole("button", { name: "Open Ana" }));
  const card = cardOf();
  await waitFor(() => expect(card).not.toHaveAttribute("data-only-unread-dms"));
  // The conversation you are reading stays put until you leave it.
  expect(card?.querySelector("details")).toHaveAttribute("open");
  expect(
    screen.queryByRole("button", { name: /unread DM|Show all/ }),
  ).toBeNull();
  await user.click(screen.getByRole("button", { name: "Leave" }));
  await waitFor(() =>
    expect(card?.querySelector("details")).not.toHaveAttribute("open"),
  );
});
