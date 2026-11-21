// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { Context } from "@deepseek-ai/cordis";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Shortcut } from "../../features/shortcuts/service";
import type { PluginModule } from "../../plugins/api";
import { PluginRuntime } from "../../plugins/runtime";
import * as finderPlugin from "./index";
import { topInterest } from "./interest";
import type { Finder, FinderItem, FinderSource } from "./service";

const viewer = "a".repeat(64);
const communityOrigin = "https://relay.example.org";
const scope = `${communityOrigin}:${viewer}`;
const contexts: Context[] = [];
beforeEach(() => {
  vi.stubGlobal("matchMedia", () => ({
    matches: true,
    addEventListener() {},
    removeEventListener() {},
  }));
  vi.stubGlobal(
    "ResizeObserver",
    class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  );
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value() {},
  });
});
afterEach(async () => {
  cleanup();
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  localStorage.clear();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
});

/** A plugin that uses `ctx.finder` the way another plugin would. */
const consumer = (register?: () => FinderSource) => {
  const used: { finder?: Finder | undefined } = {};
  const module: PluginModule = {
    apply(ctx) {
      ctx.inject(["finder"], (child) => {
        used.finder = child.finder;
        if (register) child.finder?.registerSource(register());
      });
    },
  };
  return { module, used };
};

async function mount(plugins: Record<string, PluginModule> = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  const modules: Record<string, PluginModule> = {
    "buzz.finder": finderPlugin,
    ...plugins,
  };
  const runtime = new PluginRuntime(ctx, async (plugin) => {
    const module = modules[plugin.manifest.id];
    if (!module) throw new Error(`No module for ${plugin.manifest.id}`);
    return module;
  });
  ctx.effect(() => () => runtime.dispose());
  const listeners = new Set<() => void>();
  let entry: { id: string; target: unknown } = {
    id: "home",
    target: { kind: "home" },
  };
  // Stable between changes, as the real navigation snapshot is.
  let snapshot = { entry };
  const shortcuts = new Map<string, Shortcut>();
  let Overlay: ComponentType = () => null;
  ctx.provide("relay", {
    snapshot: () => ({ status: "connecting" }),
    subscribe: () => () => {},
  } as never);
  ctx.provide("navigation", {
    snapshot: () => snapshot,
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
  } as never);
  ctx.provide("pages", {
    registerOverlay(overlay: { component: ComponentType }) {
      Overlay = overlay.component;
    },
  } as never);
  ctx.provide("shortcuts", {
    register(shortcut: Shortcut) {
      shortcuts.set(shortcut.id, shortcut);
    },
  } as never);
  const navigate = (next: typeof entry) => {
    entry = next;
    snapshot = { entry };
    for (const listener of listeners) listener();
  };
  const enable = async (...ids: string[]) => {
    await act(() =>
      runtime.reconcile(
        ids.map((id) => ({
          manifest: { id, name: id, apiVersion: 1 as const },
          enabled: true,
          source: "bundled" as const,
          revision: "bundled",
          previous: null,
          reloadable: false,
          error: null,
        })),
      ),
    );
    await vi.waitFor(() => expect(shortcuts.has("open")).toBe(true));
  };
  await enable("buzz.finder", ...Object.keys(plugins));
  // Load the lazy dialog first, so its import time can't race the waits.
  await import("./FinderDialog");
  return {
    shortcuts,
    enable,
    visit: (id: string, channelId: string) =>
      navigate({
        id,
        target: {
          kind: "conversation",
          scope: { viewer, communityOrigin },
          channelId,
        },
      }),
    leave: () => navigate({ id: `home-${entry.id}`, target: { kind: "home" } }),
    notify: () => {
      for (const listener of listeners) listener();
    },
    show: () => render(<Overlay />),
  };
}

const selectedTab = async () =>
  (await screen.findByRole("tab", { selected: true })).textContent;
const rows = () =>
  screen.queryAllByRole("option").map((row) => row.textContent ?? "");
const item = (label: string, run = vi.fn()): FinderItem => ({
  id: label.toLowerCase(),
  label,
  run,
});

test("counts each visit to a conversation once", async () => {
  const { visit, notify } = await mount();
  visit("v1", "busy");
  // Navigation also notifies for attempts and other changes to one visit.
  notify();
  notify();
  visit("v2", "quiet");
  visit("v3", "quiet");
  expect(topInterest(scope, 5)).toEqual(["quiet", "busy"]);
});

test("⌘P searches the open conversation, else all of Buzz; ⌘⇧P stays out of text fields", async () => {
  const { visit, leave, shortcuts, show } = await mount();
  const find = shortcuts.get("open");
  const all = shortcuts.get("all");
  expect(find?.binding).toEqual({ key: "p", mod: true });
  expect(find?.allowInEditable).toBe(true);
  expect(all?.binding).toEqual({ key: "p", mod: true, shift: true });
  // The composer's Spoiler keeps ⌘⇧P while typing.
  expect(all?.allowInEditable).toBeFalsy();
  visit("v1", "crew");
  show();
  await act(async () => find?.run());
  expect(await selectedTab()).toBe("This channel");
  await act(async () => all?.run());
  expect(await selectedTab()).toBe("All of Buzz");
  await act(async () => find?.run());
  expect(await selectedTab()).toBe("This channel");
  leave();
  await act(async () => find?.run());
  expect(await selectedTab()).toBe("All of Buzz");
});

test("another plugin opens its own list with a query; Finder ranks it and Enter runs the item", async () => {
  const banana = vi.fn();
  const fruit = consumer(() => ({
    id: "list",
    title: "Fruit",
    items: () => [item("Apple"), item("Banana", banana), item("Cherry")],
  }));
  // Same local ID from another plugin: no collision.
  const veg = consumer(() => ({
    id: "list",
    title: "Vegetables",
    items: () => [item("Bean")],
  }));
  const { show } = await mount({
    "example.fruit": fruit.module,
    "example.veg": veg.module,
  });
  show();
  await act(async () =>
    fruit.used.finder?.open({ source: "example.fruit/list", query: "ban" }),
  );
  expect(await screen.findByRole("combobox")).toHaveValue("ban");
  expect(
    screen.getByRole("button", { name: "Remove Fruit search scope" }),
  ).toBeVisible();
  expect(rows()).toEqual([expect.stringContaining("Banana")]);
  await act(async () => screen.getByRole("option").click());
  expect(banana).toHaveBeenCalledTimes(1);
  await act(async () => veg.used.finder?.open({ source: "example.veg/list" }));
  expect(await screen.findByRole("combobox")).toHaveValue("");
  expect(rows()).toEqual([expect.stringContaining("Bean")]);
  // A bare local ID names no source: Finder opens as ⌘P does.
  await act(async () => veg.used.finder?.open({ source: "list" }));
  expect(await selectedTab()).toBe("All of Buzz");
});

test("a source leaves when its plugin stops, and All of Buzz shows instead", async () => {
  const fruit = consumer(() => ({
    id: "list",
    title: "Fruit",
    items: () => [item("Apple")],
  }));
  const { show, enable } = await mount({ "example.fruit": fruit.module });
  show();
  await act(async () =>
    fruit.used.finder?.open({ source: "example.fruit/list" }),
  );
  expect(rows()).toEqual([expect.stringContaining("Apple")]);
  await enable("buzz.finder");
  expect(await selectedTab()).toBe("All of Buzz");
  expect(
    screen.queryByRole("button", { name: "Remove Fruit search scope" }),
  ).not.toBeInTheDocument();
});

test("a failing list shows an error row, and a late answer for older text is ignored", async () => {
  const answers = new Map<string, (items: readonly FinderItem[]) => void>();
  const broken = consumer(() => ({
    id: "broken",
    title: "Broken",
    items: () => {
      throw new Error("no list");
    },
  }));
  const slow = consumer(() => ({
    id: "slow",
    title: "Slow",
    search: (query, publish) => void answers.set(query, publish),
  }));
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { show } = await mount({
    "example.broken": broken.module,
    "example.slow": slow.module,
  });
  show();
  await act(async () =>
    broken.used.finder?.open({ source: "example.broken/broken" }),
  );
  expect(await screen.findByText("This list couldn't load.")).toBeVisible();
  await act(async () =>
    slow.used.finder?.open({ source: "example.slow/slow", query: "a" }),
  );
  await act(async () =>
    slow.used.finder?.open({ source: "example.slow/slow", query: "ab" }),
  );
  await act(async () => answers.get("a")?.([item("Stale")]));
  expect(rows()).toEqual([]);
  await act(async () => answers.get("ab")?.([item("Fresh")]));
  expect(
    within(screen.getByRole("listbox")).getByRole("option"),
  ).toHaveTextContent("Fresh");
});
