/** Durable per-lane progress. The current signed submission remains the authority. */
export type AutomationLane = {
  request: string;
  tried: string[];
  report?: string;
  receipt?: string;
  reminders: number;
  lastActionAt: number;
  pending?: { key: string; device: string; kind: "remind" | "assign" };
};
export const REVIEW_WAIT_SECONDS = 300;
export function validateAutomation(
  value: unknown,
): asserts value is Record<string, AutomationLane> | undefined {
  if (value === undefined) return;
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    Object.keys(value).length > 12
  )
    throw new Error("Invalid review automation state.");
  for (const item of Object.values(value) as AutomationLane[]) {
    if (
      (item?.receipt !== undefined && !/^[0-9a-f]{64}$/.test(item.receipt)) ||
      !item ||
      !/^[0-9a-f-]{36}$/.test(item.request) ||
      !Array.isArray(item.tried) ||
      item.tried.length > 100 ||
      item.tried.some((key) => !/^[0-9a-f]{64}$/.test(key)) ||
      new Set(item.tried).size !== item.tried.length ||
      !Number.isSafeInteger(item.reminders) ||
      item.reminders < 0 ||
      item.reminders > 3 ||
      !Number.isSafeInteger(item.lastActionAt) ||
      item.lastActionAt <= 0 ||
      (item.report !== undefined && !/^[0-9a-f]{64}$/.test(item.report)) ||
      (item.pending &&
        (!/^[0-9a-f-]{36}$/.test(item.pending.device) ||
          !/^[0-9a-f-]{36}$/.test(item.pending.key) ||
          !["remind", "assign"].includes(item.pending.kind)))
    )
      throw new Error("Invalid review automation state.");
  }
}
