// @vitest-environment jsdom
// The voice box wired to the sidebar, section, community, people, message and
// thread actions:
// typed text plus Enter reaches each action's own operation, and actions that
// take a name or touch everything wait for a second Enter.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Communities } from "../../features/communities/service";
import type {
  DecisionRequest,
  DecisionResult,
} from "../../features/decisions/service";
import type { Navigation } from "../../features/navigation/controller";
import type { ChannelSummary } from "../../features/relay/contracts";
import type { Shortcut } from "../../features/shortcuts/service";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { VoiceJump, type VoiceJumpServices } from "./VoiceJump";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../../features/search/voice-dictation", () => ({
  prepareVoice: () => {},
  useVoiceSearchAvailable: (enabled: boolean) => enabled,
  useVoiceDictation: () => ({
    state: "idle" as const,
    start: async () => {},
    stop: () => {},
    cancel: () => {},
  }),
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

const origin = "https://relay.example.org";
const viewer = "f".repeat(64);
const jonasPk = "b".repeat(64);
const msgId = "e".repeat(64);

/** Jev's answer: per question, the option whose label contains `picks[key]`
 * at probability `p`, else "none". Answers come from the request's own
 * labels, so the test never hardcodes the sentences the builder writes. */
function answering(picks: Record<string, string>, p = 0.95) {
  return vi.fn(async (request: DecisionRequest): Promise<DecisionResult> => {
    const answers: Record<string, unknown> = {};
    for (const [key, question] of Object.entries(request.questions)) {
      if (question.type !== "choice") continue;
      const want = picks[key];
      const choice =
        (want &&
          Object.keys(question.options).find((label) =>
            label.toLowerCase().includes(want.toLowerCase()),
          )) ||
        "none";
      answers[key] = {
        type: "choice",
        choice,
        confidence: p,
        probabilities: { [choice]: p },
      };
    }
    return {
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers,
    } as unknown as DecisionResult;
  });
}

function setup(decide: ReturnType<typeof answering>) {
  const channels: ChannelSummary[] = [
    {
      id: "sec",
      name: "buzz-security",
      channelType: "stream",
      members: [viewer],
      lastActivityAt: 200,
    } as ChannelSummary,
  ];
  const prefs = {
    writable: true,
    starWritable: true,
    muteWritable: true,
    filterWritable: true,
    sortWritable: true,
    sectionCreationWritable: true,
    sectionRenameWritable: true,
    ensure: async () => {},
    setStar: vi.fn(async () => []),
    assign: vi.fn(async () => ({})),
    setMute: vi.fn(async () => []),
    setFilter: vi.fn(async () => {}),
    createSection: vi.fn(async () => {}),
    snapshot: () => ({
      status: "ready",
      data: {
        sections: [{ id: "work", name: "Work", order: 0 }],
        assignments: {},
        starred: [],
        muted: [],
      },
    }),
  };
  const unread = {
    inbox: () => ({ items: [] }),
    sync: () => ({ capability: "frontier-sync" }),
    snapshot: () => ({ manual: "none", observedCount: 0 }),
    following: () => false,
    attention: () => ({ unread: false, forced: false }),
    markChannelRead: vi.fn(async () => ({})),
    markUnreadLocal: vi.fn(async () => ({})),
    markAllChannelsRead: vi.fn(async () => []),
    follow: vi.fn(),
    markMessageUnread: vi.fn(async () => ({})),
  };
  const messages = { react: vi.fn() };
  const session = {
    viewer,
    names: {
      subscribe: () => () => {},
      snapshot: () => ({}),
      resolve: (_pk: string, fallback: string) => fallback,
    },
    channels: {
      list: () => ({ status: "ready", channels }),
      get: (id: string) => channels.find((c) => c.id === id),
      window: (id: string) => ({
        channelId: id,
        status: "ready",
        rows: [],
        hasMore: false,
        loadingOlder: false,
        error: undefined,
      }),
    },
    unread,
    channelLifecycle: { available: false },
    sidebarPreferences: prefs,
    messages,
    profiles: { snapshot: () => new Map([[jonasPk, { name: "Jonas" }]]) },
    agentChoices: { snapshot: () => ({ identities: [] }) },
    directMessages: { available: true, open: vi.fn(async () => "dm-new") },
    outbox: { supports: () => false },
  };
  const relaySnapshot = {
    status: "ready" as const,
    scope: `${origin}:${viewer}`,
    session,
  };
  const setPreference = vi.fn();
  const communities = {
    subscribe: () => () => {},
    snapshot: () => ({
      selected: origin,
      viewer,
      memberships: [{ id: origin, name: "Example", url: origin }],
    }),
    relay: { subscribe: () => () => {}, snapshot: () => relaySnapshot },
    presence: { setPreference },
  } as unknown as Communities;
  let registered: Shortcut | undefined;
  const navOpen = vi.fn(async () => ({ status: "opened" as const }));
  const services: VoiceJumpServices = {
    communities,
    shortcuts: {
      registerHost(shortcut: Shortcut) {
        registered = shortcut;
        return () => {};
      },
    } as unknown as VoiceJumpServices["shortcuts"],
    navigation: {
      subscribe: () => () => {},
      snapshot: () => ({
        entry: { target: { kind: "conversation", channelId: "sec" } },
      }),
      open: navOpen,
    } as unknown as Navigation,
    decisions: { decide } as unknown as NonNullable<
      VoiceJumpServices["decisions"]
    >,
  };
  render(
    <ToastProvider>
      <div id="dom-fixture" />
      <VoiceJump services={services} />
    </ToastProvider>,
  );
  return {
    prefs,
    unread,
    messages,
    setPreference,
    navOpen,
    decide,
    /** Hovers `html`'s first element, presses the shortcut, types `text`
     * and presses Enter. */
    async say(text: string, html?: string, hover?: string) {
      const fixture = document.getElementById("dom-fixture");
      if (fixture && html) fixture.innerHTML = html;
      const target = hover
        ? fixture?.querySelector(hover)
        : fixture?.firstElementChild;
      document.elementsFromPoint = vi.fn(() => (target ? [target] : []));
      window.dispatchEvent(
        new MouseEvent("pointermove", { clientX: 10, clientY: 10 }),
      );
      act(() => registered?.run());
      const input = await screen.findByRole("searchbox");
      const user = userEvent.setup();
      await user.type(input, `${text}{Enter}`);
      return user;
    },
  };
}

const messageRow = `
  <section data-channel-timeline="sec">
    <div data-message-id="${msgId}"><p id="msg-text">Rotate the key</p></div>
  </section>`;
const channelRow = `<button type="button" data-channel-id="sec">buzz-security</button>`;
const closed = () =>
  waitFor(() =>
    expect(
      screen.queryByRole("dialog", { name: "Jump or act by voice" }),
    ).not.toBeInTheDocument(),
  );

describe("voice box → sidebar and people actions", () => {
  it("mutes the hovered channel from typed text", async () => {
    const h = setup(answering({ action: "Mute #buzz-security" }));
    await h.say("mute this", channelRow);
    await waitFor(() =>
      expect(h.prefs.setMute).toHaveBeenCalledWith("sec", true),
    );
    await closed();
  });

  it("asks before creating a section, showing the name it heard", async () => {
    const h = setup(answering({ action: "Create a new sidebar section" }));
    const user = await h.say("create a section called reading list");
    const chip = await screen.findByRole("region", {
      name: "Confirm voice action",
    });
    expect(chip).toHaveTextContent("Reading List");
    expect(h.prefs.createSection).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(h.prefs.createSection).toHaveBeenCalledWith({
        id: expect.any(String),
        name: "Reading List",
      }),
    );
  });

  it("asks for nothing when no name was said", async () => {
    const h = setup(answering({ action: "Create a new sidebar section" }));
    await h.say("create a section");
    await waitFor(() => expect(h.decide).toHaveBeenCalled());
    expect(
      screen.queryByRole("region", { name: "Confirm voice action" }),
    ).not.toBeInTheDocument();
    expect(h.prefs.createSection).not.toHaveBeenCalled();
  });

  it("filters a section named aloud, with nothing hovered", async () => {
    const h = setup(
      answering({
        action: "Show only unread channels in a sidebar section",
        section: "Work",
      }),
    );
    await h.say("only show unreads in work");
    await waitFor(() =>
      expect(h.prefs.setFilter).toHaveBeenCalledWith(
        "section:work",
        "unreads",
        ["work"],
      ),
    );
  });

  it("asks before marking everything read", async () => {
    const h = setup(
      answering({ action: "Mark everything in this community as read" }),
    );
    const user = await h.say("mark everything read");
    await screen.findByRole("region", { name: "Confirm voice action" });
    expect(h.unread.markAllChannelsRead).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(h.unread.markAllChannelsRead).toHaveBeenCalledOnce(),
    );
  });

  it("sets availability", async () => {
    const h = setup(answering({ action: "Set my availability to away" }));
    await h.say("set me to away");
    await waitFor(() => expect(h.setPreference).toHaveBeenCalledWith("away"));
  });

  it("opens a message draft to someone named aloud, sending nothing", async () => {
    const h = setup(answering({ action: "message", person: "Jonas" }));
    await h.say("message jonas");
    await waitFor(() =>
      expect(h.navOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "page",
          route: expect.objectContaining({
            params: expect.objectContaining({ to: jonasPk }),
          }),
        }),
      ),
    );
  });

  it("shows options, not an action, when Jev isn't sure", async () => {
    const h = setup(answering({ action: "Mute #buzz-security" }, 0.6));
    await h.say("mute this", channelRow);
    expect(
      await screen.findByRole("button", { name: /Mute #buzz-security/i }),
    ).toBeInTheDocument();
    expect(h.prefs.setMute).not.toHaveBeenCalled();
  });
});

describe("voice box → message and thread actions", () => {
  it("asks before reacting, then reacts", async () => {
    const h = setup(answering({ action: "React to", emoji: "thumbs up" }));
    const user = await h.say("thumbs up this", messageRow, "#msg-text");
    const chip = await screen.findByRole("region", {
      name: "Confirm voice action",
    });
    expect(chip).toHaveTextContent("👍");
    expect(h.messages.react).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    await waitFor(() =>
      expect(h.messages.react).toHaveBeenCalledWith(msgId, "👍"),
    );
  });

  it("follows the hovered message's thread", async () => {
    const h = setup(answering({ action: "Get notified of new replies" }));
    await h.say("follow this", messageRow, "#msg-text");
    await waitFor(() =>
      expect(h.unread.follow).toHaveBeenCalledWith("sec", msgId, true),
    );
  });

  it("marks the hovered message unread", async () => {
    const h = setup(answering({ action: "as unread" }));
    await h.say("mark this unread", messageRow, "#msg-text");
    await waitFor(() =>
      expect(h.unread.markMessageUnread).toHaveBeenCalledWith("sec", msgId),
    );
  });

  it("opens the hovered message's thread to reply", async () => {
    const h = setup(answering({ action: "Reply in a thread" }));
    await h.say("reply to this", messageRow, "#msg-text");
    await waitFor(() =>
      expect(h.navOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "conversation",
          channelId: "sec",
          threadRootId: msgId,
        }),
      ),
    );
  });
});
