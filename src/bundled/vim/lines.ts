/*
 * Lines for walking items that have no arrow keys of their own: items whose
 * boxes overlap vertically share a line, such as a sidebar heading and its
 * trailing "More actions" button.
 */
export type Box = Readonly<{ top: number; bottom: number }>;

/** Rounding and borders can make neighbouring lines touch by a pixel. */
const SLACK = 2;

export const sameLine = (a: Box, b: Box) =>
  a.top < b.bottom - SLACK && b.top < a.bottom - SLACK;

/**
 * Of `boxes` in document order, the index of the first on the nearest line
 * wholly below (or above) `from`; -1 when there is none.
 */
export function lineItem(boxes: readonly Box[], from: Box, down: boolean) {
  let best = -1;
  boxes.forEach((box, index) => {
    const beyond = down
      ? box.top >= from.bottom - SLACK
      : box.bottom <= from.top + SLACK;
    if (!beyond) return;
    const current = boxes[best];
    // A later item replaces the best only from a nearer line.
    if (
      !current ||
      (down
        ? box.bottom <= current.top + SLACK
        : box.top >= current.bottom - SLACK)
    )
      best = index;
  });
  return best;
}
