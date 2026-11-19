// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarCardResize, useSidebarCardHeight } from "./SidebarCardResize";

const ROW = 32;
afterEach(cleanup);
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 1;
  });
});

function Card({ rows }: { rows: number }) {
  const [height, resize, toggle] = useSidebarCardHeight("scope", "group:work");
  return (
    <SidebarCardResize
      label="Work"
      height={height}
      onResize={resize}
      onToggle={toggle}
    >
      {Array.from({ length: rows }, (_, index) => `Row ${index}`).map((row) => (
        <div key={row} data-card-row="">
          {row}
        </div>
      ))}
    </SidebarCardResize>
  );
}

/** jsdom has no layout: stack rows at a fixed pitch from the list's top. */
function layOut() {
  const rows = [...document.querySelectorAll<HTMLElement>("[data-card-row]")];
  const list = rows[0]?.parentElement as HTMLElement;
  for (const [index, row] of rows.entries())
    row.getBoundingClientRect = () =>
      ({ top: index * ROW, bottom: (index + 1) * ROW }) as DOMRect;
  list.getBoundingClientRect = () => ({ top: 0 }) as DOMRect;
  Object.defineProperty(list, "scrollHeight", { value: rows.length * ROW });
  Object.defineProperty(list, "offsetHeight", {
    get: () => Number.parseFloat(list.style.maxHeight) || rows.length * ROW,
  });
  return list;
}

it("offers a grip only when there is a row to hide", async () => {
  const { rerender } = render(<Card rows={1} />);
  expect(screen.queryByLabelText("Resize Work")).toBeNull();
  rerender(<Card rows={3} />);
  expect(await screen.findByLabelText("Resize Work")).toBeInTheDocument();
});

it("follows the pointer, settles on a whole row, and remembers it", () => {
  render(<Card rows={5} />);
  const list = layOut();
  const grip = screen.getByLabelText("Resize Work");
  fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 160 });
  fireEvent.pointerMove(window, { pointerId: 1, clientY: 110 });
  expect(list.style.maxHeight).toBe("110px");
  fireEvent.pointerUp(window, { pointerId: 1, clientY: 110 });
  expect(list.style.maxHeight).toBe(`${3 * ROW}px`);
  cleanup();
  render(<Card rows={5} />);
  expect(
    document.querySelector<HTMLElement>("[data-card-row]")?.parentElement?.style
      .maxHeight,
  ).toBe(`${3 * ROW}px`);
});

it("steps a row with the keyboard, and double-click toggles full and back", () => {
  render(<Card rows={5} />);
  const list = layOut();
  const grip = screen.getByLabelText("Resize Work");
  fireEvent.keyDown(grip, { key: "ArrowUp" });
  expect(list.style.maxHeight).toBe(`${4 * ROW}px`);
  // A double-click's own clicks press and release without moving.
  for (const _ of [1, 2]) {
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 128 });
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 128 });
  }
  expect(grip.style.pointerEvents).toBe("");
  fireEvent.doubleClick(grip);
  expect(list.style.maxHeight).toBe("");
  fireEvent.doubleClick(grip);
  expect(list.style.maxHeight).toBe(`${4 * ROW}px`);
});

/** Lay rows out before the first render, so the default clip can measure. */
function layOutAhead() {
  const rect = vi
    .spyOn(HTMLElement.prototype, "getBoundingClientRect")
    .mockImplementation(function (this: HTMLElement) {
      if (!this.hasAttribute("data-card-row")) return { top: 0 } as DOMRect;
      const index = [...(this.parentElement?.children ?? [])].indexOf(this);
      return { top: index * ROW, bottom: (index + 1) * ROW } as DOMRect;
    });
  const height = vi
    .spyOn(HTMLElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return this.querySelectorAll("[data-card-row]").length * ROW;
    });
  return () => {
    rect.mockRestore();
    height.mockRestore();
  };
}

it("shows ten rows until changed, full stops at fifty, and full toggles back to ten", () => {
  const restore = layOutAhead();
  try {
    render(<Card rows={60} />);
    const list = document.querySelector<HTMLElement>("[data-card-row]")
      ?.parentElement as HTMLElement;
    expect(list.style.maxHeight).toBe(`${10 * ROW}px`);
    expect(screen.queryByText("View all coming soon")).toBeNull();
    const grip = screen.getByLabelText("Resize Work");
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 320 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 9000 });
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 9000 });
    expect(list.style.maxHeight).toBe(`${50 * ROW}px`);
    expect(screen.getByText("View all coming soon")).toBeInTheDocument();
    // Full with nothing to go back to returns to the first ten rows.
    fireEvent.doubleClick(grip);
    expect(list.style.maxHeight).toBe(`${10 * ROW}px`);
    expect(screen.queryByText("View all coming soon")).toBeNull();
  } finally {
    restore();
  }
});
