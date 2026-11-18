import { demoWidgetKind } from "./demo-widget-sections";
import { accepts, railSections } from "./rail-sections";
// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { parseRailLayout, useRailLayout } from "./rail-layout";
import type { RailEntry } from "./rail-pins";
import { readView } from "../../shared/view-state";

const entry: RailEntry = {
  id: "channel:planning",
  label: "Planning",
  kind: "channel",
  target: {
    version: 1,
    kind: "conversation",
    channelId: "planning",
    scope: { viewer: "a".repeat(64), communityOrigin: "https://example.org" },
  },
};
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.restoreAllMocks();
});

test("live filters survive remounts and renames locally without changing the signed layout schema, and are erased on removal", () => {
  const rule = { version: 1 as const, dms: true, people: ["c".repeat(64)] };
  const first = renderHook(() => useRailLayout("live-account:community"));
  act(() => {
    expect(
      first.result.current.create("live", "Avery", undefined, undefined, rule),
    ).toBe(true);
  });
  expect(
    readView("live-account:community", "navigation-layout:v2", null),
  ).toMatchObject({ sections: [{ id: "custom:live", title: "Avery" }] });
  expect(
    JSON.stringify(
      readView("live-account:community", "navigation-layout:v2", null),
    ),
  ).not.toContain(rule.people[0]);
  act(() => {
    first.result.current.rename("custom:live", "People");
  });
  first.unmount();
  const restored = renderHook(({ scope }) => useRailLayout(scope), {
    initialProps: { scope: "live-account:community" },
  });
  expect(restored.result.current.layout.sections).toEqual([
    { id: "custom:live", title: "People", live: rule },
  ]);
  restored.rerender({ scope: "other-account:community" });
  expect(restored.result.current.layout.sections).toEqual([]);
  restored.rerender({ scope: "live-account:community" });
  act(() => {
    expect(restored.result.current.remove("custom:live")).toBe(true);
  });
  expect(
    readView("live-account:community", "navigation-live-sections:v1", null),
  ).toEqual({});
});

test("a failed layout write rolls back its local live filter so retry does not accumulate orphaned rules", () => {
  const scope = "failed-live";
  const { result } = renderHook(() => useRailLayout(scope));
  const write = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
    this: Storage,
    key,
    value,
  ) {
    if (
      key === `buzz-view.v1:${JSON.stringify([scope, "navigation-layout:v2"])}`
    )
      throw new Error("Storage full");
    return write.call(this, key, value);
  });
  act(() => {
    expect(
      result.current.create("live", "People", undefined, undefined, {
        version: 1,
        dms: true,
        people: [],
      }),
    ).toBe(false);
  });
  expect(result.current.layout.sections).toEqual([]);
  expect(readView(scope, "navigation-live-sections:v1", null)).toEqual({});
});

test("a saved section that isn't shown keeps its place through reorders and new sections", () => {
  const { result, unmount } = renderHook(() => useRailLayout("order"));
  act(() => {
    result.current.reorder("solo", "pins", [
      "pins",
      "example.plugin/section",
      "solo",
    ]);
  });
  expect(result.current.layout.order).toEqual([
    "solo",
    "pins",
    "example.plugin/section",
  ]);
  // The plugin is starting or disabled: its section isn't shown.
  act(() => {
    result.current.reorder("pins", "solo", ["solo", "pins"]);
    result.current.create("project", "Project");
  });
  unmount();
  const restored = renderHook(() => useRailLayout("order"));
  expect(restored.result.current.layout.order).toEqual([
    "pins",
    "solo",
    "example.plugin/section",
  ]);
  expect(restored.result.current.layout.sections).toEqual([
    { id: "custom:project", title: "Project" },
  ]);
});

// Storage failure and account switches are state-owner contracts; pointer/drop
// geometry and the naming/cancel flow belong to messages-layout.spec.mjs.
test("a saved arrangement survives remounts, stays scoped, and retains confirmed placement after a failed write", () => {
  const first = renderHook(({ scope }) => useRailLayout(scope), {
    initialProps: { scope: "account-a:community-a" },
  });
  act(() => {
    expect(first.result.current.create("project", "Project", entry)).toBe(true);
    expect(
      first.result.current.reorder("solo", "pins", [
        "pins",
        "team",
        "solo",
        "custom:project",
      ]),
    ).toBe(true);
  });
  first.rerender({ scope: "account-a:community-b" });
  expect(first.result.current.layout.placements).toEqual([]);
  first.rerender({ scope: "account-b:community-a" });
  expect(first.result.current.layout.sections).toEqual([]);
  first.unmount();
  const restored = renderHook(() => useRailLayout("account-a:community-a"));
  expect(restored.result.current.layout.order).toEqual([
    "solo",
    "pins",
    "team",
    "custom:project",
  ]);
  expect(restored.result.current.layout.placements).toEqual([
    { section: "custom:project", entry },
  ]);
  const write = vi
    .spyOn(Storage.prototype, "setItem")
    .mockImplementation(() => {
      throw new Error("Storage unavailable");
    });
  act(() => {
    expect(restored.result.current.move(entry, "custom:other")).toBe(false);
  });
  expect(restored.result.current.layout.placements).toEqual([
    { section: "custom:project", entry },
  ]);
  write.mockRestore();
  act(() => {
    expect(restored.result.current.remove("custom:project")).toBe(true);
  });
  expect(restored.result.current.layout.sections).toEqual([]);
  expect(restored.result.current.layout.placements).toEqual([]);
});

test("cards, expanded lists, and routing share contributed section membership", () => {
  const model = railSections(
    {
      order: [],
      sections: [],
      placements: [{ section: "example.plugin/section", entry }],
    },
    [{ id: "example.plugin/section", title: "Plugin work" }],
  );
  expect(model.sections.get("example.plugin/section")).toBe("Plugin work");
  expect(model.owner((candidate) => candidate.id === entry.id)).toBe(
    "example.plugin/section",
  );
  // The section holds a copy: the conversation stays in its own list.
  expect(model.entries("team", [entry])).toEqual([entry]);
  expect(model.entries("example.plugin/section", [])).toEqual([entry]);
  // Disabling the contribution leaves only the conversation's own list.
  const disabled = railSections({
    order: [],
    sections: [],
    placements: [{ section: "example.plugin/section", entry }],
  });
  expect(
    disabled.owner((candidate) => candidate.id === entry.id),
  ).toBeUndefined();
  expect(disabled.entries("team", [entry])).toEqual([entry]);
});

test("manual rows synchronized from another device cannot enter a live collection", () => {
  const section = "custom:live:query";
  const model = railSections({
    order: [],
    sections: [{ id: section, title: "Live DMs" }],
    placements: [{ section, entry }],
  });
  expect(model.entries(section, [])).toEqual([]);
  expect(model.entries("team", [entry])).toEqual([entry]);
});

test("a conversation keeps its own list while sections a person made hold copies", () => {
  const saved = (placements: { section: string; entry: typeof entry }[]) =>
    railSections({
      order: [],
      sections: [
        { id: "custom:work", title: "Work" },
        { id: "custom:later", title: "Later" },
      ],
      placements,
    });
  const copied = saved([
    { section: "custom:work", entry },
    { section: "custom:later", entry },
  ]);
  expect(copied.entries("team", [entry])).toEqual([entry]);
  expect(copied.entries("custom:work", [])).toEqual([entry]);
  expect(copied.entries("custom:later", [])).toEqual([entry]);
  // An arrangement saved earlier could put a conversation in Solo or Plugins.
  const misplaced = saved([{ section: "solo", entry }]);
  expect(misplaced.entries("solo", [])).toEqual([]);
  expect(misplaced.entries("team", [entry])).toEqual([entry]);
});

test("Team keeps to its own pages: another app's row saved there stays out", () => {
  const page = (id: string) => ({
    ...entry,
    id,
    kind: "page" as const,
  });
  const agents = page("buzz.agents/agents");
  const drafts = page("buzz.drafts-and-sent/drafts-sent");
  expect(accepts(agents, "team")).toBe(false);
  expect(accepts(drafts, "team")).toBe(true);
  expect(accepts(agents, "pins")).toBe(true);
  const model = railSections({
    order: [],
    sections: [],
    placements: [
      { section: "team", entry: agents },
      { section: "team", entry: drafts },
    ],
  });
  expect(model.entries("team", [])).toEqual([drafts]);
  // The app's row is back in its own section.
  expect(model.entries("navigation", [agents])).toEqual([agents]);
});

test("an arrangement saved under Team's earlier section id still places it", () => {
  expect(
    parseRailLayout({ order: ["solo", "messages"], sections: [] }).order,
  ).toEqual(["solo", "team"]);
});

test("widget sections persist locally through reload and rename, reject conversation drops, and forget on removal", () => {
  const scope = "widget-account:community";
  const first = renderHook(() => useRailLayout(scope));
  act(() => {
    expect(
      first.result.current.create(
        "widget:notes",
        "Notes",
        undefined,
        undefined,
        undefined,
        "sticky-note",
      ),
    ).toBe(true);
    first.result.current.rename("custom:widget:notes", "Scratchpad");
  });
  first.unmount();
  const restored = renderHook(() => useRailLayout(scope));
  expect(restored.result.current.layout.sections).toEqual([
    { id: "custom:widget:notes", title: "Scratchpad" },
  ]);
  expect(demoWidgetKind(scope, "custom:widget:notes")).toBe("sticky-note");
  expect(
    demoWidgetKind("another-account", "custom:widget:notes"),
  ).toBeUndefined();
  expect(accepts(entry, "custom:widget:notes")).toBe(false);
  act(() => {
    expect(restored.result.current.remove("custom:widget:notes")).toBe(true);
  });
  expect(demoWidgetKind(scope, "custom:widget:notes")).toBeUndefined();
  expect(restored.result.current.layout.sections).toEqual([]);
});

test.each(["navigation-demo-widgets:v1", "navigation-layout:v2"])(
  "failed %s writes cannot create a partial widget section",
  (failedKey) => {
    const scope = "failed-widget";
    const { result } = renderHook(() => useRailLayout(scope));
    const write = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (
      this: Storage,
      key,
      value,
    ) {
      if (key === `buzz-view.v1:${JSON.stringify([scope, failedKey])}`)
        throw new Error("Storage full");
      return write.call(this, key, value);
    });
    act(() => {
      expect(
        result.current.create(
          "widget:notes",
          "Notes",
          undefined,
          undefined,
          undefined,
          "sticky-note",
        ),
      ).toBe(false);
    });
    expect(result.current.layout.sections).toEqual([]);
    expect(demoWidgetKind(scope, "custom:widget:notes")).toBeUndefined();
  },
);
