// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The signal is fixed when the module loads, as a bundle fixes it. */
async function developerModeAt(url: string) {
  vi.stubGlobal("location", new URL(url));
  vi.resetModules();
  return (await import("./mode")).developerMode;
}

it("is on for a development bundle served from loopback", async () => {
  expect(import.meta.env.DEV).toBe(true);
  expect(await developerModeAt("http://localhost:1420/")).toBe(true);
  expect(await developerModeAt("http://127.0.0.1:1420/")).toBe(true);
});

it("is off for a development bundle opened through another host", async () => {
  // `--host` and tunnels serve the same development bundle from elsewhere.
  expect(import.meta.env.DEV).toBe(true);
  expect(await developerModeAt("http://192.168.1.20:1420/")).toBe(false);
  expect(await developerModeAt("https://dev.example.org/")).toBe(false);
  // Only the hostname itself counts, not a name that contains it.
  expect(await developerModeAt("http://localhost.example.org/")).toBe(false);
});
