import { expect, test } from "vitest";
import { lineItem, sameLine } from "./lines";

const at = (top: number, height = 32) => ({ top, bottom: top + height });

// A heading with two trailing icons on its line, then two rows.
const heading = at(0);
const icons = [at(4, 24), at(4, 24)];
const first = at(32);
const second = at(64);

test("j and k reach the first item on the nearest line, past its trailing icons", () => {
  const boxes = [heading, ...icons, first, second];
  expect(lineItem(boxes, heading, true)).toBe(3);
  expect(lineItem(boxes, first, false)).toBe(0);
  expect(lineItem(boxes, second, false)).toBe(3);
  expect(lineItem(boxes, second, true)).toBe(-1);
});

test("document order does not decide the nearest line", () => {
  // A row rendered after a lower one, as in a reordered layout.
  expect(lineItem([at(200), at(100)], at(0), true)).toBe(1);
  expect(lineItem([at(0), at(100)], at(200), false)).toBe(1);
});

test("an edge with no height starts inside a focused section", () => {
  expect(lineItem([at(10), at(50)], at(10, 0), true)).toBe(0);
});

test("touching boxes are separate lines; overlapping ones share one", () => {
  expect(sameLine(at(0), at(31))).toBe(false);
  expect(sameLine(at(0), at(4, 24))).toBe(true);
});
