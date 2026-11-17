// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import { RailArrangement, RailGroup } from "./RailArrangement";
import { writeView } from "../../shared/view-state";
import type { RailEntry } from "./rail-pins";

beforeEach(() => {
  vi.stubGlobal("matchMedia", (media: string) => ({
    media,
    matches: false,
    addEventListener() {},
    removeEventListener() {},
  }));
});
const noEntries = new Map<string, RailEntry>();
afterEach(() => {
  cleanup();
  localStorage.clear();
  vi.unstubAllGlobals();
});

// Live component refreshes can retain an element's previous component identity.
// A real React wrapper exercises that boundary without mocking React's lifecycle.
test.each([false, true])(
  "row previews keep four objects with leading destinations: %s",
  (withLeading) => {
    const leading: RailEntry[] = withLeading
      ? ["activity", "drafts"].map((id) => ({
          id,
          label: id,
          kind: "page",
          target: {
            version: 1,
            kind: "page",
            pluginId: `example.${id}`,
            pageId: id,
          },
        }))
      : [];
    const entries: RailEntry[] = Array.from({ length: 6 }, (_, index) => ({
      id: `chat-${index}`,
      label: `Chat ${index + 1}`,
      kind: "chat",
      target: {
        version: 1,
        kind: "conversation",
        channelId: `chat-${index}`,
        scope: {
          viewer: "a".repeat(64),
          communityOrigin: "https://example.org",
        },
      },
    }));
    const openSection = vi.fn();
    const rail = () => (
      <RailArrangement
        current={noEntries}
        partition="preview-test"
        selectedSection="solo"
        isPinned={() => false}
        onTogglePin={() => {}}
        openSection={openSection}
        renderEntry={(entry) => <NavigationItem label={entry.label} />}
        sections={[
          {
            id: "solo",
            title: "Solo",
            content: (
              <RailGroup
                id="solo"
                title="Solo"
                leadingEntryIds={leading.map((entry) => entry.id)}
                rows={[...leading, ...entries].map((entry) => ({
                  entry,
                  content: <NavigationItem label={entry.label} />,
                }))}
              />
            ),
          },
        ]}
      />
    );
    const view = render(rail());
    view.rerender(rail());
    expect(screen.getByRole("button", { name: "Chat 4" })).not.toBeNull();
    expect(screen.queryByRole("button", { name: "Chat 5" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Chat 6" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Open Solo" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Solo" }));
    expect(openSection).toHaveBeenCalledWith("solo");
    if (withLeading) {
      const activity = screen.getByRole("button", {
        name: "activity",
      });
      const drafts = screen.getByRole("button", {
        name: "drafts",
      });
      expect(activity.compareDocumentPosition(drafts)).toBe(
        Node.DOCUMENT_POSITION_FOLLOWING,
      );
      expect(
        drafts.compareDocumentPosition(
          screen.getByRole("button", { name: "Chat 1" }),
        ),
      ).toBe(Node.DOCUMENT_POSITION_FOLLOWING);
    }
  },
);

test("Pins are one list: its drop target and the row menu both pin, and neither moves the row", async () => {
  const page: RailEntry = {
    id: "example.notes/notes",
    label: "Notes",
    kind: "page",
    target: {
      version: 1,
      kind: "page",
      pluginId: "example.notes",
      pageId: "notes",
    },
  };
  const placements = [{ section: "custom:work", entry: page }];
  writeView("pins", "navigation-layout:v2", {
    order: [],
    sections: [{ id: "custom:work", title: "Work" }],
    placements,
  });
  const pinned = new Set<string>();
  const onTogglePin = vi.fn((entry: RailEntry, next: boolean) => {
    if (next) pinned.add(entry.id);
    else pinned.delete(entry.id);
  });
  const cards = () => (
    <RailArrangement
      current={noEntries}
      partition="pins"
      isPinned={(entry) => pinned.has(entry.id)}
      onTogglePin={onTogglePin}
      openSection={() => {}}
      renderEntry={(item) => <NavigationItem label={item.label} />}
      sections={[
        {
          id: "pins",
          title: "Pins",
          content: (
            <RailGroup
              id="pins"
              title="Pins"
              rows={[...pinned].map(() => ({
                entry: page,
                content: <NavigationItem label={page.label} />,
              }))}
            />
          ),
        },
      ]}
    />
  );
  const view = render(cards());
  const card = (id: string) => {
    const node = view.container.querySelector(`[data-rail-section="${id}"]`);
    if (!(node instanceof HTMLElement)) throw new Error(`Missing ${id}`);
    return node;
  };
  // Moving a row to Pins is a pin: the arrangement's drop goes there too.
  fireEvent.contextMenu(
    within(card("custom:work")).getByRole("button", { name: "Notes" }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "Move page" }));
  fireEvent.click(await screen.findByRole("menuitem", { name: "Pins" }));
  expect(onTogglePin).toHaveBeenLastCalledWith(page, true);
  view.rerender(cards());
  // A pinned page placed in a section shows in both, and its menu unpins.
  expect(
    within(card("pins")).getByRole("button", { name: "Notes" }),
  ).not.toBeNull();
  fireEvent.contextMenu(
    within(card("custom:work")).getByRole("button", { name: "Notes" }),
  );
  fireEvent.click(await screen.findByRole("menuitem", { name: "Unpin" }));
  expect(onTogglePin).toHaveBeenLastCalledWith(page, false);
  view.rerender(cards());
  expect(within(card("pins")).queryByRole("button", { name: "Notes" })).toBe(
    null,
  );
  // Pinning and unpinning leave the page where it was placed.
  expect(
    within(card("custom:work")).getByRole("button", { name: "Notes" }),
  ).not.toBeNull();
  expect(onTogglePin).toHaveBeenCalledTimes(2);
});

test("a row saved in a section shows the conversation's current name", () => {
  const saved: RailEntry = {
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
  writeView("renamed", "navigation-layout:v2", {
    order: [],
    sections: [{ id: "custom:work", title: "Work" }],
    placements: [{ section: "custom:work", entry: saved }],
  });
  render(
    <RailArrangement
      partition="renamed"
      current={new Map([[saved.id, { ...saved, label: "Roadmap" }]])}
      isPinned={() => false}
      onTogglePin={() => {}}
      openSection={() => {}}
      renderEntry={(item) => <NavigationItem label={item.label} />}
      sections={[]}
    />,
  );
  expect(screen.getByRole("button", { name: "Roadmap" })).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Planning" })).toBeNull();
});

test("a section a person made is renamed by double-clicking its title", async () => {
  writeView("rename", "navigation-layout:v2", {
    order: [],
    sections: [{ id: "custom:work", title: "Work" }],
    placements: [],
  });
  render(
    <RailArrangement
      current={noEntries}
      partition="rename"
      renderEntry={() => null}
      isPinned={() => false}
      onTogglePin={() => {}}
      openSection={() => {}}
      sections={[
        {
          id: "team",
          title: "Team",
          content: <RailGroup id="team" title="Team" />,
        },
      ]}
    />,
  );
  // Team's name is the app's own.
  fireEvent.doubleClick(screen.getByRole("button", { name: "Team" }));
  expect(screen.queryByRole("textbox")).toBeNull();
  // Escape keeps the name.
  fireEvent.doubleClick(screen.getByRole("button", { name: "Work" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Section name" }), {
    target: { value: "Dropped" },
  });
  fireEvent.keyDown(screen.getByRole("textbox"), { key: "Escape" });
  fireEvent.doubleClick(screen.getByRole("button", { name: "Work" }));
  const field = screen.getByRole("textbox", { name: "Section name" });
  fireEvent.change(field, { target: { value: "Projects" } });
  fireEvent.keyDown(field, { key: "Enter" });
  expect(
    await screen.findByRole("button", { name: "Projects" }),
  ).not.toBeNull();
  expect(screen.queryByRole("button", { name: "Work" })).toBeNull();
});

test("a restriction shows one card under its banner and no way to add sections", () => {
  const cards = (only?: { section: string; banner: React.ReactNode }) => (
    <RailArrangement
      current={noEntries}
      partition="restricted"
      isPinned={() => false}
      onTogglePin={() => {}}
      openSection={() => {}}
      renderEntry={(item) => <NavigationItem label={item.label} />}
      only={only}
      sections={["team", "solo"].map((id) => ({
        id,
        title: id === "solo" ? "Solo" : "Team",
        content: <RailGroup id={id} title={id === "solo" ? "Solo" : "Team"} />,
      }))}
    />
  );
  const view = render(cards());
  expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "New section" })).toBeTruthy();
  view.rerender(cards({ section: "solo", banner: <p>Focus is on</p> }));
  expect(screen.getByText("Focus is on")).toBeTruthy();
  expect(screen.getByRole("heading", { name: "Solo" })).toBeTruthy();
  expect(screen.queryByRole("heading", { name: "Team" })).toBeNull();
  expect(screen.queryByRole("button", { name: "New section" })).toBeNull();
  view.rerender(cards());
  expect(screen.getByRole("heading", { name: "Team" })).toBeTruthy();
});

test("Team and Solo row counts persist independently within their account/community", () => {
  const entries: RailEntry[] = Array.from({ length: 6 }, (_, index) => ({
    id: `channel:resize-${index}`,
    label: `Resize chat ${index + 1}`,
    kind: "chat",
    target: {
      version: 1,
      kind: "conversation",
      channelId: `resize-${index}`,
      scope: { viewer: "a".repeat(64), communityOrigin: "https://example.org" },
    },
  }));
  const rail = (partition: string) => (
    <RailArrangement
      partition={partition}
      current={new Map(entries.map((entry) => [entry.id, entry]))}
      renderEntry={(entry) => <NavigationItem label={entry.label} />}
      isPinned={() => false}
      onTogglePin={() => {}}
      openSection={() => {}}
      sections={["team", "solo"].map((id) => ({
        id,
        title: id,
        content: (
          <RailGroup
            id={id}
            title={id}
            rows={entries.map((entry) => ({
              entry,
              content: <NavigationItem label={entry.label} />,
            }))}
          />
        ),
      }))}
    />
  );
  const view = render(rail("resize-account-one"));
  const team = screen.getByRole("slider", { name: "team visible rows" });
  expect(team).toHaveAttribute("aria-valuenow", "4");
  fireEvent.keyDown(team, { key: "ArrowDown" });
  expect(team).toHaveAttribute("aria-valuenow", "5");
  expect(screen.getByRole("button", { name: "Resize chat 5" })).toBeVisible();
  expect(
    screen.getByRole("slider", { name: "solo visible rows" }),
  ).toHaveAttribute("aria-valuenow", "4");
  view.unmount();
  const restored = render(rail("resize-account-one"));
  expect(
    screen.getByRole("slider", { name: "team visible rows" }),
  ).toHaveAttribute("aria-valuenow", "5");
  restored.rerender(rail("resize-account-two"));
  expect(
    screen.getByRole("slider", { name: "team visible rows" }),
  ).toHaveAttribute("aria-valuenow", "4");
  fireEvent.keyDown(screen.getByRole("slider", { name: "solo visible rows" }), {
    key: "Home",
  });
  expect(
    screen.getByRole("slider", { name: "solo visible rows" }),
  ).toHaveAttribute("aria-valuenow", "1");
});
