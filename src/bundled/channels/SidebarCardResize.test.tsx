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
  const [height, resize] = useSidebarCardHeight("scope", "group:work");
  return (
    <SidebarCardResize label="Work" height={height} onResize={resize}>
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

it("steps a row with the keyboard and goes back to the default on double-click", () => {
  render(<Card rows={5} />);
  const list = layOut();
  const grip = screen.getByLabelText("Resize Work");
  fireEvent.keyDown(grip, { key: "ArrowUp" });
  expect(list.style.maxHeight).toBe(`${4 * ROW}px`);
  fireEvent.doubleClick(grip);
  expect(list.style.maxHeight).toBe("");
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

it("shows the first ten rows until dragged, and every row once dragged to the bottom", () => {
  const restore = layOutAhead();
  try {
    render(<Card rows={12} />);
    const list = document.querySelector<HTMLElement>("[data-card-row]")
      ?.parentElement as HTMLElement;
    expect(list.style.maxHeight).toBe(`${10 * ROW}px`);
    const grip = screen.getByLabelText("Resize Work");
    fireEvent.pointerDown(grip, { button: 0, pointerId: 1, clientY: 320 });
    fireEvent.pointerMove(window, { pointerId: 1, clientY: 900 });
    fireEvent.pointerUp(window, { pointerId: 1, clientY: 900 });
    expect(list.style.maxHeight).toBe("");
    fireEvent.doubleClick(grip);
    expect(list.style.maxHeight).toBe(`${10 * ROW}px`);
  } finally {
    restore();
  }
});
