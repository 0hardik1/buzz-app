import { expect, test, vi } from "vitest";
import type { PluginInfo } from "../plugins/types";
import { togglePlugin } from "./plugin-rules";

const plugin = (
  id: string,
  enabled: boolean,
  source: PluginInfo["source"] = "bundled",
): PluginInfo => ({
  manifest: { id, name: id, apiVersion: 1 } as PluginInfo["manifest"],
  source,
  enabled,
  revision: "r1",
  previous: null,
  reloadable: false,
  error: null,
});

test("turns a plugin on or off through the plugin manager", () => {
  const change = vi.fn(async () => true);
  expect(
    togglePlugin({ change }, plugin("buzz.reminders", false), "allowed", false),
  ).toBe(true);
  expect(
    togglePlugin({ change }, plugin("buzz.reminders", true), "allowed", false),
  ).toBe(true);
  expect(change.mock.calls).toEqual([
    ["enable", "buzz.reminders"],
    ["disable", "buzz.reminders"],
  ]);
});

test("Channels, busy changes and restricted plugins without access are locked", () => {
  const change = vi.fn(async () => true);
  expect(
    togglePlugin({ change }, plugin("buzz.channels", true), "allowed", false),
  ).toBe(false);
  expect(
    togglePlugin({ change }, plugin("buzz.reminders", false), "allowed", true),
  ).toBe(false);
  expect(
    togglePlugin({ change }, plugin("buzz.moderation", false), "denied", false),
  ).toBe(false);
  // Turning a restricted plugin off never needs access.
  expect(
    togglePlugin({ change }, plugin("buzz.moderation", true), "denied", false),
  ).toBe(true);
  expect(change.mock.calls).toEqual([["disable", "buzz.moderation"]]);
});
