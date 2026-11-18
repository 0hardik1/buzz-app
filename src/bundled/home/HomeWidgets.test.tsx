// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { FocusWidget, ChecklistWidget } from "./HomeWidgets";
import { readObjects, updateObjects, type CanvasObject } from "./canvas-state";

afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.useRealTimers();
});
const scope = "home-widget-test";
function Widget({ kind }: { kind: "focus" | "checklist" }) {
  const [object, setObject] = useState(() => readObjects(scope)[0]);
  if (!object) throw new Error("Missing widget");
  const change = (patch: Partial<CanvasObject>) => {
    updateObjects(scope, (items) =>
      items.map((item) =>
        item.id === object.id ? { ...item, ...patch } : item,
      ),
    );
    setObject(readObjects(scope)[0]);
    return true;
  };
  return kind === "focus" ? (
    <FocusWidget object={object} change={change} />
  ) : (
    <ChecklistWidget object={object} change={change} />
  );
}
it("preserves paused time, resumes against a wall-clock deadline, and completes after a closed view", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-11-17T12:00:00Z"));
  updateObjects(scope, () => [
    { id: "focus", kind: "focus", name: "Focus", x: 0, y: 0 },
  ]);
  let view = render(<Widget kind="focus" />);
  fireEvent.click(screen.getByRole("button", { name: "Start focus" }));
  act(() => vi.advanceTimersByTime(40_000));
  fireEvent.click(screen.getByRole("button", { name: "Pause" }));
  view.unmount();
  act(() => vi.advanceTimersByTime(600_000));
  view = render(<Widget kind="focus" />);
  expect(screen.getByRole("timer")).toHaveAccessibleName(
    "24 minutes 20 seconds remaining",
  );
  fireEvent.click(screen.getByRole("button", { name: "Resume" }));
  view.unmount();
  act(() => vi.advanceTimersByTime(1_500_000));
  render(<Widget kind="focus" />);
  expect(screen.getByRole("timer")).toHaveAccessibleName(
    "0 minutes 0 seconds remaining",
  );
  expect(screen.getByText("Take a breather")).toBeVisible();
});
it("keeps checklist entries and completion when the canvas remounts", () => {
  updateObjects(scope, () => [
    { id: "list", kind: "checklist", name: "List", x: 0, y: 0 },
  ]);
  const view = render(<Widget kind="checklist" />);
  fireEvent.change(
    screen.getByRole("textbox", { name: "Add a checklist item" }),
    { target: { value: "Sketch the small idea" } },
  );
  fireEvent.click(screen.getByRole("button", { name: "Add checklist item" }));
  fireEvent.click(
    screen.getByRole("checkbox", { name: "Sketch the small idea" }),
  );
  view.unmount();
  render(<Widget kind="checklist" />);
  expect(
    screen.getByRole("checkbox", { name: "Sketch the small idea" }),
  ).toBeChecked();
  expect(screen.getByText("1 of 1 done")).toBeVisible();
});
