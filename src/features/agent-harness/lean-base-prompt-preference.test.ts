// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { BASE_PROMPT, basePromptFor, LEAN_BASE_PROMPT } from "./base-prompt";

const key = "buzz-agents-lean-base-prompt.v1";

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it.each([null, "off", "", "true", "invalid", "on"])(
  "uses lean only for an explicit saved on (stored=%s)",
  (stored) => {
    if (stored !== null) localStorage.setItem(key, stored);
    expect(basePromptFor()).toBe(
      stored === "on" ? LEAN_BASE_PROMPT : BASE_PROMPT,
    );
    expect(localStorage.getItem(key)).toBe(stored);
  },
);

it("keeps full guidance when storage cannot be read", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("storage unavailable");
  });
  expect(basePromptFor()).toBe(BASE_PROMPT);
});
