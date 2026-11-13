// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { expect, it, vi } from "vitest";
import { stubAvatarBrowserApis } from "../../features/agents/avatar-testing";
import type { RelaySession } from "../../features/relay/session";
import { setClockPreference } from "../../shared/clock-preference";
import { ChatCircleIcon } from "../../shared/design-system/icons";
import { SearchPreview } from "./SearchPreview";

stubAvatarBrowserApis();

it.each([
  ["ordinary prose", "Find the needle here", "needle"],
  ["a Solo link", "buzz://channel/channel", "buzz"],
  [
    "prose with a Solo link",
    "See buzz://channel/channel for release notes",
    "release",
  ],
  ["a time-prefixed comment", "⏱ 0:42 — Check the release", "release"],
])(
  "keeps %s and highlights intact with live timestamp preferences",
  async (_case, content, term) => {
    vi.useFakeTimers();
    const noon = new Date(2026, 10, 13, 12, 0, 0);
    vi.setSystemTime(noon);
    const profiles = new Map();
    const channel = { id: "channel", name: "Solo", channelType: "solo" };
    const list = { status: "ready", channels: [channel] };
    const session = {
      viewer: "viewer",
      media: () => undefined,
      profiles: {
        snapshot: () => profiles,
        subscribe: () => () => {},
        ensure: async () => {},
      },
      channels: {
        get: () => channel,
        list: () => list,
        subscribeList: () => () => {},
      },
      readPage: async () => ({
        events: [
          {
            id: "message",
            kind: 9,
            pubkey: "author",
            created_at: noon.getTime() / 1000,
            content,
            tags: [["h", "channel"]],
          },
        ],
      }),
    } as unknown as RelaySession;
    try {
      setClockPreference({
        hourCycle: "h12",
        seconds: false,
        messageTimestamps: "show",
      });
      render(
        <SearchPreview
          session={session}
          row={{
            key: "channel",
            label: "Solo",
            icon: ChatCircleIcon,
            peek: { kind: "channel", channelId: "channel" },
            run() {},
          }}
          tone="chat"
          terms={[term]}
          nameOf={() => "Alex"}
          whereOf={() => "Solo"}
        />,
      );
      await act(async () => {
        await vi.advanceTimersByTimeAsync(150);
      });
      expect(screen.getByText(/^12:00\s?PM$/)).toBeVisible();
      expect(screen.getByText(term, { selector: "mark" })).toBeVisible();
      expect(document.querySelector(".search-peek-text")?.textContent).toBe(
        content,
      );
      expect(screen.queryByRole("link")).not.toBeInTheDocument();
      if (content.startsWith("⏱")) {
        expect(
          screen.getByRole("listitem").textContent?.match(/0:42/g),
        ).toHaveLength(1);
      }
      act(() => setClockPreference({ messageTimestamps: "hide-solo" }));
      expect(screen.queryByText(/^12:00\s?PM$/)).not.toBeInTheDocument();
      expect(document.querySelector("time")).toHaveTextContent("2026");
      act(() => setClockPreference({ messageTimestamps: "show" }));
      expect(screen.getByText(/^12:00\s?PM$/)).toBeVisible();
    } finally {
      cleanup();
      setClockPreference({
        hourCycle: "system",
        seconds: false,
        messageTimestamps: "show",
      });
      vi.useRealTimers();
    }
  },
);
