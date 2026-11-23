// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { SidebarCardResize } from "./SidebarCardResize";
import { SidebarSection } from "./SidebarSection";
import { useSidebarView } from "./useSidebarView";

const ROW = 32;
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
beforeEach(() => {
  localStorage.clear();
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query === "(prefers-reduced-motion: reduce)",
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
  }));
  vi.stubGlobal("requestAnimationFrame", (run: FrameRequestCallback) => {
    run(0);
    return 1;
  });
  // jsdom has no layout. Give even newly mounted rows a fixed pitch.
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    function (this: HTMLElement) {
      const index = this.hasAttribute("data-card-row")
        ? [...document.querySelectorAll("[data-card-row]")].indexOf(this)
        : 0;
      return { top: index * ROW, bottom: (index + 1) * ROW } as DOMRect;
    },
  );
  vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.querySelectorAll("[data-card-row]").length * ROW;
    },
  );
  vi.spyOn(HTMLElement.prototype, "offsetHeight", "get").mockImplementation(
    function (this: HTMLElement) {
      return this.style.maxHeight
        ? Number.parseFloat(this.style.maxHeight)
        : this.scrollHeight;
    },
  );
});

type Mark = "dm" | "mention" | "channel" | "muted";

function Card({
  rows,
  excluded = 0,
  marks = {},
}: {
  rows: number;
  excluded?: number;
  /** Unread on a row: a DM, a mention of you, ordinary channel backlog, or a
   * mention in a muted channel. */
  marks?: Record<number, Mark>;
}) {
  const renderRows = (count: number, start: number) =>
    Array.from({ length: count }, (_, index) => `Row ${start + index}`).map(
      (row) => (
        <div key={row} data-card-row="">
          <button
            type="button"
            data-channel-id={row}
            data-channel-type={
              marks[Number(row.slice(4))] === "dm" ? "dm" : "stream"
            }
          >
            {row}
            {marks[Number(row.slice(4))] && (
              <span
                data-channel-unread=""
                data-channel-muted={
                  marks[Number(row.slice(4))] === "muted" ? "" : undefined
                }
              />
            )}
            {marks[Number(row.slice(4))] &&
              marks[Number(row.slice(4))] !== "channel" && (
                <span data-channel-waiting="" hidden />
              )}
          </button>
        </div>
      ),
    );
  return (
    <SidebarCardResize
      label="Work"
      excludedCount={excluded}
      excludedRows={() => renderRows(excluded, rows)}
    >
      {renderRows(rows, 0)}
    </SidebarCardResize>
  );
}

const grip = () => screen.getByRole("separator", { name: "Resize Work" });
const size = () =>
  document.querySelector<HTMLElement>("[data-card-rows]")?.style.maxHeight;
const press = (key: string) => fireEvent.keyDown(grip(), { key });
const drag = (start: number, end: number, release = true) => {
  fireEvent.pointerDown(grip(), { button: 0, pointerId: 1, clientY: start });
  fireEvent.pointerMove(window, { pointerId: 1, clientY: end });
  if (release) fireEvent.pointerUp(window, { pointerId: 1, clientY: end });
};

it("shows every matching row, including when the count exceeds ten", () => {
  const { rerender } = render(<Card rows={12} />);
  expect(screen.getAllByRole("button")).toHaveLength(12);
  expect(screen.queryByRole("separator")).toBeNull();
  rerender(<Card rows={12} excluded={2} />);
  expect(size()).toBe("");
  expect(grip()).toHaveAttribute("aria-valuemin", "12");
  expect(grip()).toHaveAttribute("aria-valuenow", "12");
  expect(screen.queryByText("Row 12")).toBeNull();
});

it("drags through excluded rows and cannot shrink below the filtered list", () => {
  render(<Card rows={12} excluded={3} />);
  drag(384, 425, false);
  expect(size()).toBe("425px");
  fireEvent.pointerUp(window, { pointerId: 1, clientY: 425 });
  expect(size()).toBe("416px");
  expect(grip()).toHaveAttribute("aria-valuetext", "13 of 15 rows");
  expect(screen.getByText("Row 13").parentElement).toHaveProperty(
    "inert",
    true,
  );
  drag(416, 100);
  expect(size()).toBe("");
  expect(screen.queryByText("Row 12")).toBeNull();
  expect(grip()).toHaveAttribute("aria-valuenow", "12");
});

it("restores the settled count when a drag is cancelled", () => {
  render(<Card rows={3} excluded={4} />);
  press("ArrowDown");
  drag(128, 184, false);
  fireEvent.pointerCancel(window, { pointerId: 1 });
  expect(size()).toBe("128px");
  expect(grip()).toHaveAttribute("aria-valuenow", "4");
  expect(document.documentElement.style.cursor).toBe("");
});

it("steps with the keyboard and toggles all extras back to the filter", () => {
  render(<Card rows={2} excluded={3} />);
  press("ArrowUp");
  expect(grip()).toHaveAttribute("aria-valuenow", "2");
  press("ArrowDown");
  expect(grip()).toHaveAttribute("aria-valuenow", "3");
  fireEvent.doubleClick(grip());
  expect(grip()).toHaveAttribute("aria-valuenow", "5");
  expect(size()).toBe("");
  press("Enter");
  expect(grip()).toHaveAttribute("aria-valuetext", "2 of 5 rows");
  expect(screen.queryByText("Row 2")).toBeNull();
});

it("keeps the filter floor current and resets the expansion on remount", () => {
  const { rerender, unmount } = render(<Card rows={2} excluded={4} />);
  press("ArrowDown");
  rerender(<Card rows={4} excluded={2} />);
  expect(grip()).toHaveAttribute("aria-valuemin", "4");
  expect(grip()).toHaveAttribute("aria-valuenow", "5");
  expect(size()).toBe("160px");
  unmount();
  render(<Card rows={4} excluded={2} />);
  expect(grip()).toHaveAttribute("aria-valuenow", "4");
  expect(screen.queryByText("Row 4")).toBeNull();
});

it("allows disclosure even when no rows match", () => {
  render(<Card rows={0} excluded={1} />);
  expect(grip()).toHaveAttribute("aria-valuemin", "0");
  press("Enter");
  expect(screen.getByText("Row 0")).toBeVisible();
  press("Enter");
  expect(screen.queryByText("Row 0")).toBeNull();
});

it("routes attention cues to the lowest remaining unread and returns keyboard focus", () => {
  render(
    <Card
      rows={2}
      excluded={5}
      marks={{ 3: "dm", 4: "channel", 5: "mention", 6: "muted" }}
    />,
  );
  press("ArrowDown");
  const badge = screen.getByRole("button", {
    name: "Show 2 unread conversations below in Work",
  });
  fireEvent.click(badge, { detail: 0 });
  expect(grip()).toHaveFocus();
  expect(grip()).toHaveAttribute("aria-valuenow", "6");
  expect(screen.queryByRole("button", { name: /unread/ })).toBeNull();
});

it("returns to the filter after 15 seconds without activity in the card", () => {
  vi.useFakeTimers();
  try {
    render(<Card rows={2} excluded={3} />);
    press("Enter");
    act(() => vi.advanceTimersByTime(14_000));
    expect(grip()).toHaveAttribute("aria-valuenow", "5");
    fireEvent.pointerMove(grip());
    act(() => vi.advanceTimersByTime(14_999));
    expect(grip()).toHaveAttribute("aria-valuenow", "5");
    act(() => vi.advanceTimersByTime(1));
    expect(grip()).toHaveAttribute("aria-valuenow", "2");
    expect(screen.queryByText("Row 2")).toBeNull();
  } finally {
    vi.useRealTimers();
  }
});

it.each(["heading", "keyboard", "drag"])(
  "returns a partial contraction to the filter and persists minimization by %s",
  (method) => {
    function Workspace() {
      const sectionKey = "group:work";
      const view = useSidebarView("resize-test", true);
      return (
        <SidebarSection
          sectionKey={sectionKey}
          title="Work"
          open={!view.collapsed.includes(sectionKey)}
          onToggle={(open) => view.toggle(sectionKey, open)}
          heightScope="resize-test"
        >
          <div data-card-row="">First match</div>
          <div data-card-row="">Second match</div>
        </SidebarSection>
      );
    }
    const heading = () =>
      screen.getByLabelText("Work", { selector: "summary" });
    const expanded = () => heading().closest("details");
    vi.useFakeTimers();
    try {
      const { unmount } = render(<Workspace />);
      drag(64, 32);
      expect(grip()).toHaveAttribute("aria-valuenow", "1");
      act(() => vi.advanceTimersByTime(14_999));
      expect(grip()).toHaveAttribute("aria-valuenow", "1");
      act(() => vi.advanceTimersByTime(1));
      expect(grip()).toHaveAttribute("aria-valuenow", "2");

      press("ArrowUp");
      if (method === "keyboard") {
        grip().focus();
        press("ArrowUp");
        expect(grip()).toHaveFocus();
      } else if (method === "drag") {
        drag(32, 0);
      } else {
        fireEvent.click(heading());
      }
      expect(expanded()).not.toHaveAttribute("open");
      expect(grip()).toHaveAttribute("aria-valuenow", "0");
      act(() => vi.advanceTimersByTime(15_001));
      expect(expanded()).not.toHaveAttribute("open");
      unmount();
      render(<Workspace />);
      expect(expanded()).not.toHaveAttribute("open");
      expect(grip()).toHaveAttribute("aria-valuetext", "Minimized");
      if (method === "keyboard") press("ArrowDown");
      else if (method === "drag") {
        drag(0, 32, false);
        fireEvent.pointerCancel(window, { pointerId: 1 });
        expect(expanded()).not.toHaveAttribute("open");
        drag(0, 32);
      } else fireEvent.doubleClick(grip());
      expect(expanded()).toHaveAttribute("open");
      expect(grip()).toHaveAttribute("aria-valuenow", "2");
      expect(size()).toBe("");
    } finally {
      vi.useRealTimers();
    }
  },
);
