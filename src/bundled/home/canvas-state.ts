import { readView, writeView } from "../../shared/view-state";

export type Point = { x: number; y: number };
export type CanvasObject = Point & {
  id: string;
  kind:
    | "attention"
    | "clock"
    | "calendar"
    | "note"
    | "pin"
    | "file"
    | "focus"
    | "checklist"
    | "world-clock";
  name: string;
  text?: string;
  channelId?: string;
  pinSize?: number;
  timer?: { remaining: number; endsAt?: number };
  tasks?: { id: string; text: string; done: boolean }[];
  timezone?: string;
};
export const pinSizes = { minimum: 64, default: 96, maximum: 320 } as const;
export const canvasKey = "home:canvas:v2";
const attention: CanvasObject = {
  id: "attention",
  kind: "attention",
  name: "For you",
  x: -280,
  y: 0,
};
export const initialObjects: CanvasObject[] = [
  attention,
  { id: "clock", kind: "clock", name: "Clock", x: 340, y: 24 },
  { id: "calendar", kind: "calendar", name: "Calendar", x: 340, y: 280 },
];
const kinds = new Set([
  "attention",
  "clock",
  "calendar",
  "note",
  "pin",
  "file",
  "focus",
  "checklist",
  "world-clock",
]);
export function readObjects(scope: string): CanvasObject[] {
  const current = readView<unknown>(scope, canvasKey, null);
  const legacy =
    current === null ? readView<unknown>(scope, "home:canvas:v1", null) : null;
  if (current === null && legacy === null) return initialObjects;
  // The old canvas always had an anchored feed, including when its object list
  // was empty. Bring it into the arrangement once; v2 remembers its removal.
  const saved =
    current ?? (Array.isArray(legacy) ? [attention, ...legacy] : legacy);
  if (!Array.isArray(saved)) return [];
  return saved.filter(
    (item): item is CanvasObject =>
      !!item &&
      typeof item.id === "string" &&
      typeof item.name === "string" &&
      kinds.has(item.kind) &&
      Number.isFinite(item.x) &&
      Number.isFinite(item.y) &&
      (item.text === undefined || typeof item.text === "string") &&
      (item.channelId === undefined || typeof item.channelId === "string") &&
      (item.pinSize === undefined ||
        (Number.isFinite(item.pinSize) &&
          item.pinSize >= pinSizes.minimum &&
          item.pinSize <= pinSizes.maximum)) &&
      (item.timezone === undefined ||
        (typeof item.timezone === "string" && validTimezone(item.timezone))) &&
      (item.timer === undefined ||
        (!!item.timer &&
          Number.isFinite(item.timer.remaining) &&
          item.timer.remaining >= 0 &&
          item.timer.remaining <= 1500 &&
          (item.timer.endsAt === undefined ||
            (Number.isFinite(item.timer.endsAt) && item.timer.endsAt >= 0)))) &&
      (item.tasks === undefined ||
        (Array.isArray(item.tasks) &&
          item.tasks.length <= 12 &&
          item.tasks.every(
            (task: { id?: unknown; text?: unknown; done?: unknown }) =>
              !!task &&
              typeof task.id === "string" &&
              typeof task.text === "string" &&
              task.text.length <= 160 &&
              typeof task.done === "boolean",
          ))),
  );
}
export function updateObjects(
  scope: string,
  change: (items: CanvasObject[]) => CanvasObject[],
) {
  if (!writeView(scope, canvasKey, change(readObjects(scope))))
    throw new Error(
      "Your canvas could not be saved on this device. Free some storage and try again.",
    );
}

function validTimezone(timezone: string) {
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
