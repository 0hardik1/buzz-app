// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { HomeConversationPin } from "./HomeConversationPin";
import { readObjects, updateObjects, type CanvasObject } from "./canvas-state";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

const object: CanvasObject = {
  id: "pin",
  kind: "pin",
  name: "Avery",
  x: 20,
  y: 30,
};
const identity = {
  label: "Avery",
  portraits: [{ id: "avery", name: "Avery", agent: false }],
  media: () => undefined,
  available: true,
};

it("distinguishes a click from a scaled drag and discards cancelled or unsaved moves", () => {
  const move = vi.fn(() => true);
  const open = vi.fn();
  const view = render(
    <HomeConversationPin
      {...identity}
      object={object}
      scale={2}
      move={move}
      open={open}
      resize={() => {}}
      remove={() => {}}
    />,
  );
  const button = screen.getByRole("button", { name: "Avery" });
  button.setPointerCapture = vi.fn();
  const pointer = (type: string, x: number, y: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientX: x,
      clientY: y,
      button: 0,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(button, event);
  };
  pointer("pointerdown", 0, 0);
  pointer("pointermove", 2, 1);
  pointer("pointerup", 2, 1);
  fireEvent.click(button, { detail: 1 });
  expect(open).toHaveBeenCalledOnce();
  expect(move).not.toHaveBeenCalled();

  pointer("pointerdown", 0, 0);
  pointer("pointermove", 20, 40);
  pointer("pointerup", 20, 40);
  fireEvent.click(button, { detail: 1 });
  expect(move).toHaveBeenCalledExactlyOnceWith({ x: 30, y: 50 });
  expect(open).toHaveBeenCalledOnce();

  pointer("pointerdown", 0, 0);
  pointer("pointermove", 100, 100);
  pointer("pointercancel", 100, 100);
  expect(move).toHaveBeenCalledOnce();
  const pin = view.container.querySelector("[data-home-conversation-pin]");
  expect(pin).toHaveStyle({ transform: "translate(20px, 30px)" });

  move.mockReturnValue(false);
  pointer("pointerdown", 0, 0);
  pointer("pointermove", 60, 80);
  pointer("pointerup", 60, 80);
  expect(pin).toHaveStyle({ transform: "translate(20px, 30px)" });
});

it("persists keyboard movement and context-menu size across a remount and removes the pin", async () => {
  const scope = "pin-test";
  updateObjects(scope, () => [object]);
  function Pin() {
    const [saved, setSaved] = useState(() => readObjects(scope)[0]);
    const change = (patch: Partial<CanvasObject>) => {
      updateObjects(scope, (items) =>
        items.map((item) => ({ ...item, ...patch })),
      );
      setSaved(readObjects(scope)[0]);
      return true;
    };
    return saved ? (
      <HomeConversationPin
        {...identity}
        object={saved}
        scale={1}
        move={change}
        resize={(pinSize) => change({ pinSize })}
        open={() => {}}
        remove={() => {
          updateObjects(scope, () => []);
          setSaved(undefined);
        }}
      />
    ) : null;
  }
  let view = render(<Pin />);
  let button = screen.getByRole("button", { name: "Avery" });
  fireEvent.keyDown(button, { key: "ArrowRight" });
  fireEvent.keyDown(button, { key: "F10", shiftKey: true });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Larger" }));
  view.unmount();
  view = render(<Pin />);
  expect(readObjects(scope)[0]).toMatchObject({ x: 36, y: 30, pinSize: 128 });
  expect(
    view.container.querySelector("[data-home-conversation-pin]"),
  ).toHaveStyle({ width: "128px" });
  button = screen.getByRole("button", { name: "Avery" });
  fireEvent.keyDown(button, { key: "F10", shiftKey: true });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Reset size" }));
  expect(readObjects(scope)[0]?.pinSize).toBe(96);
  fireEvent.keyDown(button, { key: "F10", shiftKey: true });
  fireEvent.click(await screen.findByRole("menuitem", { name: "Remove pin" }));
  expect(readObjects(scope)).toEqual([]);
  expect(screen.queryByRole("button", { name: "Avery" })).toBeNull();
});
