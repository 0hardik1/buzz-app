// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import type { ComponentType } from "react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import type { Shortcut } from "../../features/shortcuts/service";
import { apply } from "./index";
import { topInterest } from "./interest";

const viewer = "a".repeat(64);
const communityOrigin = "https://relay.example.org";
const scope = `${communityOrigin}:${viewer}`;
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
});
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

function mount() {
  const listeners = new Set<() => void>();
  let entry: { id: string; target: unknown } = {
    id: "home",
    target: { kind: "home" },
  };
  // Stable between changes, as the real navigation snapshot is.
  let snapshot = { entry };
  const stop: (() => void)[] = [];
  const shortcuts = new Map<string, Shortcut>();
  let Overlay: ComponentType = () => null;
  apply({
    relay: {
      snapshot: () => ({ status: "connecting" }),
      subscribe: () => () => {},
    },
    navigation: {
      snapshot: () => snapshot,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => void listeners.delete(listener);
      },
    },
    pages: {
      registerOverlay(overlay: { component: ComponentType }) {
        Overlay = overlay.component;
      },
    },
    shortcuts: {
      register(shortcut: Shortcut) {
        shortcuts.set(shortcut.id, shortcut);
      },
    },
    effect: (body: () => () => void) => void stop.push(body()),
  } as unknown as Parameters<typeof apply>[0]);
  const notify = () => {
    snapshot = { entry };
    for (const listener of listeners) listener();
  };
  const visit = (id: string, channelId: string) => {
    entry = {
      id,
      target: {
        kind: "conversation",
        scope: { viewer, communityOrigin },
        channelId,
      },
    };
    notify();
  };
  const leave = () => {
    entry = { id: `home-${entry.id}`, target: { kind: "home" } };
    notify();
  };
  return {
    visit,
    leave,
    notify,
    shortcuts,
    overlay: () => <Overlay />,
    dispose: () => {
      for (const body of stop) body();
    },
  };
}

test("counts each visit to a conversation once", () => {
  const { visit, notify, dispose } = mount();
  visit("v1", "busy");
  // Navigation also notifies for attempts and other changes to one visit.
  notify();
  notify();
  visit("v2", "quiet");
  visit("v3", "quiet");
  expect(topInterest(scope, 5)).toEqual(["quiet", "busy"]);
  dispose();
  visit("v4", "busy");
  visit("v5", "busy");
  expect(topInterest(scope, 5)).toEqual(["quiet", "busy"]);
});

test("⌘P searches the open conversation, else all of Buzz; ⌘⇧P stays out of text fields", async () => {
  const { visit, leave, shortcuts, overlay } = mount();
  const find = shortcuts.get("open");
  const all = shortcuts.get("all");
  expect(find?.binding).toEqual({ key: "p", mod: true });
  expect(find?.allowInEditable).toBe(true);
  expect(all?.binding).toEqual({ key: "p", mod: true, shift: true });
  // The composer's Spoiler keeps ⌘⇧P while typing.
  expect(all?.allowInEditable).toBeFalsy();
  const selected = async () =>
    (await screen.findByRole("tab", { selected: true })).textContent;
  // Load the lazy dialog first, so its import time can't race the waits.
  await import("./FinderDialog");
  visit("v1", "crew");
  render(overlay());
  await act(async () => find?.run());
  expect(await selected()).toBe("This channel");
  await act(async () => all?.run());
  expect(await selected()).toBe("All of Buzz");
  await act(async () => find?.run());
  expect(await selected()).toBe("This channel");
  leave();
  await act(async () => find?.run());
  expect(await selected()).toBe("All of Buzz");
});
