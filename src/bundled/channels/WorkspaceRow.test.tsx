// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { useContext, useState } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ReadingCovers } from "../../features/messages/use-reading";
import { asideLayout, WorkspaceRow } from "./WorkspaceRow";

let width = 1200;
const observers = new Set<() => void>();
class TestResizeObserver {
  constructor(private callback: () => void) {}
  observe() {
    observers.add(this.callback);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this.callback);
  }
}
function resize(next: number) {
  width = next;
  act(() => {
    for (const callback of observers) callback();
  });
}

beforeEach(() => {
  width = 1200;
  vi.stubGlobal("ResizeObserver", TestResizeObserver);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(0, 0, width, 600),
  );
});
afterEach(() => {
  cleanup();
  observers.clear();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

let covers: () => readonly DOMRect[] = () => [];
function Covers() {
  covers = useContext(ReadingCovers);
  return null;
}
/** A page whose header button drives the aside, as the contract asks. */
function Page({
  onOpenChange,
  onFloatingChange,
}: {
  onOpenChange?: (open: boolean) => void;
  onFloatingChange?: (floating: boolean) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(!open)}>
        Plan
      </button>
      <WorkspaceRow
        aside={
          <aside aria-label="Plan">
            <button type="button">Step</button>
          </aside>
        }
        width={undefined}
        open={open}
        onOpenChange={(next) => {
          onOpenChange?.(next);
          setOpen(next);
        }}
        onFloatingChange={onFloatingChange}
      >
        <div data-message-scroller>History</div>
        <Covers />
      </WorkspaceRow>
    </>
  );
}
const plan = () =>
  screen.queryByRole("complementary", { name: "Plan", hidden: true });

it("docks an aside only while its reader keeps the minimum width", () => {
  expect(asideLayout(920)).toEqual({ docked: true, width: 320 });
  expect(asideLayout(919)).toEqual({ docked: false, width: 320 });
  expect(asideLayout(300)).toEqual({ docked: false, width: 300 });
  expect(asideLayout(999, 400)).toEqual({ docked: false, width: 400 });
  expect(asideLayout(1000, 400)).toEqual({ docked: true, width: 400 });
});

it("docks the aside after the reader, which keeps its width beside it while shown", () => {
  render(<Page />);
  const box = plan()?.parentElement;
  const reader = screen.getByText("History").parentElement as HTMLElement;
  expect(box).toHaveAttribute("data-workspace-aside", "docked");
  expect(box).toHaveStyle({ inlineSize: "320px" });
  expect(reader.nextElementSibling).toBe(box);
  expect(reader.style.getPropertyValue("--timeline-aside-width")).toBe("320px");
  expect(reader).toHaveAttribute("data-aside-docked");
  expect(plan()).toBeVisible();
  expect(covers()).toEqual([]);
  fireEvent.click(screen.getByRole("button", { name: "Plan" }));
  expect(plan()).not.toBeVisible();
  expect(reader.style.getPropertyValue("--timeline-aside-width")).toBe("");
  expect(reader).not.toHaveAttribute("data-aside-docked");
});

it("closes the aside as it floats and restores the docked state after", () => {
  const changes: boolean[] = [];
  const floats: boolean[] = [];
  render(
    <Page
      onOpenChange={(open) => changes.push(open)}
      onFloatingChange={(floating) => floats.push(floating)}
    />,
  );
  const reader = screen.getByText("History");
  expect(floats).toEqual([false]);
  resize(800);
  expect(changes).toEqual([false]);
  expect(floats).toEqual([false, true]);
  // A floating aside leaves the history its full width.
  expect(
    reader.parentElement?.style.getPropertyValue("--timeline-aside-width"),
  ).toBe("");
  expect(plan()?.parentElement).toHaveAttribute(
    "data-workspace-aside",
    "floating",
  );
  expect(plan()).not.toBeVisible();
  resize(1200);
  expect(changes).toEqual([false, true]);
  expect(floats).toEqual([false, true, false]);
  expect(plan()).toBeVisible();
  // A docked aside hidden by its page stays hidden when it docks again.
  fireEvent.click(screen.getByRole("button", { name: "Plan" }));
  resize(800);
  resize(1200);
  expect(plan()).not.toBeVisible();
  // The reader never remounts.
  expect(screen.getByText("History")).toBe(reader);
});

it("an aside that first measures narrow starts closed", () => {
  width = 700;
  const changes: boolean[] = [];
  const floats: boolean[] = [];
  render(
    <Page
      onOpenChange={(open) => changes.push(open)}
      onFloatingChange={(floating) => floats.push(floating)}
    />,
  );
  expect(changes).toEqual([false]);
  expect(floats).toEqual([true]);
  expect(plan()).not.toBeVisible();
});

it("a floating aside takes focus, covers reading, and closes alone on Escape or a press beside it", () => {
  width = 800;
  const changes: boolean[] = [];
  render(<Page onOpenChange={(open) => changes.push(open)} />);
  const toggle = screen.getByRole("button", { name: "Plan" });
  toggle.focus();
  fireEvent.click(toggle);
  const box = plan()?.parentElement as HTMLElement;
  expect(plan()).toBeVisible();
  expect(box).toHaveFocus();
  expect(covers()).toHaveLength(1);

  const outer = vi.fn();
  document.addEventListener("keydown", outer);
  fireEvent.keyDown(screen.getByRole("button", { name: "Step" }), {
    key: "Escape",
  });
  document.removeEventListener("keydown", outer);
  expect(outer).not.toHaveBeenCalled();
  expect(plan()).not.toBeVisible();
  expect(toggle).toHaveFocus();
  expect(covers()).toEqual([]);

  fireEvent.click(toggle);
  fireEvent.pointerDown(screen.getByRole("button", { name: "Step" }));
  expect(plan()).toBeVisible();
  fireEvent.pointerDown(screen.getByText("History"));
  expect(plan()).not.toBeVisible();
  expect(changes).toEqual([false, false, false]);
});
