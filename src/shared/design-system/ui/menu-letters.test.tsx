// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { afterEach, expect, test, vi } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MenuItem, MenuPopup, MenuRoot, MenuTrigger } from "./Menu";
import { assignMenuLetters, enableMenuLetters } from "./menu-letters";

afterEach(cleanup);

test("letters come from labels, keep fixed keys and never repeat", () => {
  expect(
    assignMenuLetters([
      { label: "Reply" },
      { label: "Copy message" },
      { label: "Copy link" },
      { label: "Forward message" },
      { label: "Search", fixed: "c" },
      { label: "Ccc" },
    ]),
  ).toEqual(["r", "m", "l", "f", "c", undefined]);
  expect(
    assignMenuLetters([{ label: "Mute" }, { label: "Mark read" }]),
  ).toEqual(["m", "r"]);
  // Reserved keys stay with whoever turned letters on.
  expect(assignMenuLetters([{ label: "Copy link" }], "cl")).toEqual(["o"]);
});

function Actions({ onReply, onEdit }: { onReply(): void; onEdit(): void }) {
  return (
    <MenuRoot>
      <MenuTrigger>Actions</MenuTrigger>
      <MenuPopup>
        <MenuItem onClick={onReply}>Reply</MenuItem>
        <MenuItem disabled onClick={onEdit}>
          Edit
        </MenuItem>
      </MenuPopup>
    </MenuRoot>
  );
}

test("while letters are on, items show and run their key; off, nothing changes", async () => {
  const user = userEvent.setup();
  const onReply = vi.fn();
  const onEdit = vi.fn();
  render(<Actions onReply={onReply} onEdit={onEdit} />);

  await user.click(screen.getByRole("button", { name: "Actions" }));
  const reply = await screen.findByRole("menuitem", { name: "Reply" });
  expect(reply).not.toHaveAttribute("aria-keyshortcuts");
  await user.keyboard("r");
  expect(onReply).not.toHaveBeenCalled();
  await user.keyboard("{Escape}");

  let release = () => {};
  act(() => {
    release = enableMenuLetters();
  });
  await user.click(screen.getByRole("button", { name: "Actions" }));
  expect(
    await screen.findByRole("menuitem", { name: "Reply" }),
  ).toHaveAttribute("aria-keyshortcuts", "r");
  expect(screen.getByRole("menuitem", { name: "Edit" })).toHaveAttribute(
    "data-menu-letter",
    "e",
  );
  // A disabled item keeps its key but does not run.
  await user.keyboard("e");
  expect(onEdit).not.toHaveBeenCalled();
  await user.keyboard("r");
  expect(onReply).toHaveBeenCalledTimes(1);

  act(release);
  await user.click(screen.getByRole("button", { name: "Actions" }));
  expect(
    await screen.findByRole("menuitem", { name: "Reply" }),
  ).not.toHaveAttribute("aria-keyshortcuts");
});
