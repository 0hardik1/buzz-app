// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import {
  ALL_PLUGINS_SEARCH_THRESHOLD,
  AllPlugins,
  arrangePlugins,
  type AllPluginsEntry,
} from "./AllPlugins";

afterEach(cleanup);

const entry = (
  key: string,
  overrides: Partial<AllPluginsEntry> = {},
): AllPluginsEntry => ({
  key,
  label: (key[0] ?? "").toUpperCase() + key.slice(1),
  icon: null,
  enabled: true,
  pinned: false,
  pinnable: true,
  active: false,
  toggle: { disabled: false },
  ...overrides,
});

function setup(plugins: AllPluginsEntry[]) {
  const props = {
    onOpen: vi.fn(),
    onEnabledChange: vi.fn(),
    onPinnedChange: vi.fn(),
    onPinnedOrderChange: vi.fn(),
  };
  render(<AllPlugins plugins={plugins} {...props} />);
  return props;
}

async function openPopover() {
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "All plugins" }));
  return { user, popup: await screen.findByRole("dialog") };
}

it("keeps pinned plugins in the person's order and sorts the rest A–Z", () => {
  const { pinned, rest } = arrangePlugins([
    entry("zebra", { pinned: true }),
    entry("delta"),
    entry("alpha", { pinned: true }),
    entry("charlie"),
    // Off keeps its pin but lists with the rest until it returns.
    entry("bravo", { pinned: true, enabled: false, pinnable: false }),
  ]);
  expect(pinned.map(({ key }) => key)).toEqual(["zebra", "alpha"]);
  expect(rest.map(({ key }) => key)).toEqual(["bravo", "charlie", "delta"]);
});

it("filters both sections by name", () => {
  const { pinned, rest } = arrangePlugins(
    [entry("reminders", { pinned: true }), entry("repos"), entry("agents")],
    "RE",
  );
  expect(pinned.map(({ key }) => key)).toEqual(["reminders"]);
  expect(rest.map(({ key }) => key)).toEqual(["repos"]);
});

it("shows search only once the list passes the threshold", async () => {
  const few = Array.from({ length: ALL_PLUGINS_SEARCH_THRESHOLD }, (_, i) =>
    entry(`plugin${i}`),
  );
  setup(few);
  await openPopover();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
  cleanup();

  setup([...few, entry("extra")]);
  const { user } = await openPopover();
  await user.type(screen.getByRole("searchbox"), "nothing");
  expect(screen.getByRole("status")).toHaveTextContent(
    "No plugins match “nothing”.",
  );
});

it("pins, switches and opens from the popover", async () => {
  const props = setup([
    entry("reminders", { pinned: true }),
    entry("agents"),
    entry("harness", { pinnable: false }),
  ]);
  const { user, popup } = await openPopover();
  expect(
    within(popup).getByRole("heading", { name: "Pinned" }),
  ).toBeInTheDocument();

  await user.click(within(popup).getByRole("button", { name: "Pin Agents" }));
  expect(props.onPinnedChange).toHaveBeenCalledWith("agents", true);

  await user.click(within(popup).getByRole("switch", { name: "Agents" }));
  expect(props.onEnabledChange).toHaveBeenCalledWith("agents", false);

  // A plugin without a page offers its switch only.
  expect(
    within(popup).queryByRole("button", { name: /Harness/ }),
  ).not.toBeInTheDocument();
  expect(
    within(popup).getByRole("switch", { name: "Harness" }),
  ).toBeInTheDocument();

  await user.click(within(popup).getByRole("button", { name: "Reminders" }));
  expect(props.onOpen).toHaveBeenCalledWith("reminders");
});

it("reorders pinned plugins with the arrow keys on the handle", async () => {
  const props = setup([
    entry("alpha", { pinned: true }),
    entry("bravo", { pinned: true }),
    // Hidden by being off, but its place in the order is kept.
    entry("charlie", { pinned: true, enabled: false, pinnable: false }),
  ]);
  const { user, popup } = await openPopover();
  within(popup).getByRole("button", { name: "Reorder Alpha" }).focus();
  await user.keyboard("{ArrowDown}");
  expect(props.onPinnedOrderChange).toHaveBeenCalledWith([
    "bravo",
    "alpha",
    "charlie",
  ]);
});

it("shows a locked switch's reason", async () => {
  setup([
    entry("managed", {
      toggle: { disabled: true, reason: "Your organization manages this." },
    }),
  ]);
  const { popup } = await openPopover();
  const toggle = within(popup).getByRole("switch", { name: "Managed" });
  expect(toggle).toHaveAccessibleDescription("Your organization manages this.");
});
