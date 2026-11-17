// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { RailCardResize } from "./RailCardResize";

afterEach(cleanup);

test("drag previews whole rows, commits on release, and discards cancelled changes", () => {
  const preview = vi.fn();
  const commit = vi.fn();
  const cancel = vi.fn();
  const view = render(
    <div>
      <div data-rail-row="first" />
      <RailCardResize
        title="Team"
        count={4}
        max={8}
        onPreview={preview}
        onCommit={commit}
        onCancel={cancel}
      />
    </div>,
  );
  const row = view.container.querySelector("[data-rail-row]");
  if (!row) throw new Error("Missing fixture row");
  vi.spyOn(row, "getBoundingClientRect").mockReturnValue({
    height: 40,
  } as DOMRect);
  const grip = screen.getByRole("slider");
  grip.setPointerCapture = vi.fn();
  grip.releasePointerCapture = vi.fn();
  const pointer = (type: string, y: number) => {
    const event = new MouseEvent(type, {
      bubbles: true,
      clientY: y,
      button: 0,
    });
    Object.defineProperty(event, "pointerId", { value: 1 });
    fireEvent(grip, event);
  };
  pointer("pointerdown", 100);
  pointer("pointermove", 180);
  expect(preview).toHaveBeenLastCalledWith(6);
  expect(commit).not.toHaveBeenCalled();
  pointer("pointercancel", 180);
  expect(cancel).toHaveBeenCalledOnce();
  expect(commit).not.toHaveBeenCalled();
  pointer("pointerdown", 100);
  pointer("pointermove", 60);
  pointer("pointerup", 60);
  expect(commit).toHaveBeenCalledExactlyOnceWith(3);
});
