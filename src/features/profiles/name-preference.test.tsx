// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { renderToString } from "react-dom/server";
import { afterEach, expect, it, vi } from "vitest";
import {
  namePreference,
  setNamePreference,
  useNamePreference,
  verifiedLabel,
} from "./name-preference";

const preferenceKey = "buzz-name-preference.v1";
const person = { displayName: "ada", fullName: "Ada Lovelace" };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  setNamePreference("full-name");
  localStorage.clear();
});

it("shows full names without saving a choice, falling back to usernames when absent", () => {
  expect(namePreference()).toBe("full-name");
  expect(verifiedLabel(person)).toBe("Ada Lovelace");
  expect(verifiedLabel({ displayName: "ada" })).toBe("ada");
  expect(localStorage.getItem(preferenceKey)).toBeNull();
});

it.each(["username", "full-name"] as const)(
  "preserves a saved %s choice",
  (choice) => {
    localStorage.setItem(preferenceKey, choice);
    expect(namePreference()).toBe(choice);
    expect(verifiedLabel(person)).toBe(
      choice === "username" ? "ada" : "Ada Lovelace",
    );
  },
);

it("defaults to full names when storage is unavailable and retains an unsaved choice", () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new Error("unavailable");
  });
  expect(namePreference()).toBe("full-name");
  setNamePreference("username");
  expect(namePreference()).toBe("username");
});

it("updates mounted readers and keeps an explicit username choice across remounts", () => {
  const first = renderHook(() => useNamePreference());
  expect(first.result.current).toBe("full-name");
  act(() => setNamePreference("username"));
  expect(first.result.current).toBe("username");
  first.unmount();
  const second = renderHook(() => useNamePreference());
  expect(second.result.current).toBe("username");
  act(() => setNamePreference("full-name"));
  expect(second.result.current).toBe("full-name");
});

it("uses the full-name default for the server snapshot", () => {
  function Preference() {
    return useNamePreference();
  }
  expect(renderToString(<Preference />)).toBe("full-name");
});
