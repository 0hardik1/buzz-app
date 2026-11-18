// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { readView, writeView } from "../../shared/view-state";
import { backgroundId, backgroundKey, setHomeBackground } from "./background";
const storage = vi.hoisted(() => ({ file: vi.fn() }));
vi.mock("./canvas-files", () => ({ canvasFile: storage.file }));
const previous = "00000000-0000-4000-8000-000000000001";
const file = () =>
  new File(["image bytes"], "photo.png", { type: "image/png" });
beforeEach(() => {
  storage.file.mockReset();
  vi.stubGlobal(
    "Image",
    class {
      src = "";
      decode = () => Promise.resolve();
    },
  );
  vi.stubGlobal(
    "URL",
    class extends URL {
      static createObjectURL = () => "blob:test";
      static revokeObjectURL = () => {};
    },
  );
});
afterEach(() => {
  localStorage.clear();
  vi.unstubAllGlobals();
});
it("keeps the existing background until the new file commits, then replaces only that scope", async () => {
  let commit: (() => void) | undefined;
  let started: (() => void) | undefined;
  const saving = new Promise<void>((resolve) => {
    started = resolve;
  });
  storage.file
    .mockImplementationOnce(() => {
      started?.();
      return new Promise<void>((resolve) => {
        commit = resolve;
      });
    })
    .mockResolvedValue(undefined);
  writeView("scope", backgroundKey, previous);
  writeView("other", backgroundKey, previous);
  const change = setHomeBackground(
    "scope",
    file(),
    new AbortController().signal,
  );
  await saving;
  try {
    expect(backgroundId("scope")).toBe(previous);
  } finally {
    commit?.();
  }
  await change;
  const selected = backgroundId("scope");
  expect(selected).toBeTypeOf("string");
  expect(selected).not.toBe(previous);
  expect(storage.file).toHaveBeenLastCalledWith("scope", previous, null);
  expect(readView("other", backgroundKey, null)).toBe(previous);
});
it("removes an aborted pending image and leaves the prior background selected", async () => {
  let commit: (() => void) | undefined;
  let started: (() => void) | undefined;
  const saving = new Promise<void>((resolve) => {
    started = resolve;
  });
  storage.file
    .mockImplementationOnce(() => {
      started?.();
      return new Promise<void>((resolve) => {
        commit = resolve;
      });
    })
    .mockResolvedValue(undefined);
  writeView("scope", backgroundKey, previous);
  const controller = new AbortController();
  const change = setHomeBackground("scope", file(), controller.signal);
  const rejected = expect(change).rejects.toThrow();
  try {
    await saving;
    controller.abort();
  } finally {
    commit?.();
  }
  await rejected;
  const selected = storage.file.mock.calls[0]?.[1];
  expect(storage.file).toHaveBeenLastCalledWith("scope", selected, null);
  expect(backgroundId("scope")).toBe(previous);
});
