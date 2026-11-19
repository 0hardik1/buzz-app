// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
const byId = (id: string) => {
  const el = document.getElementById(id);
  assert(el);
  return el;
};
import type { DecisionResult } from "../../features/decisions/service";
import type { Communities } from "../../features/communities/service";
import type { Navigation } from "../../features/navigation/controller";
import type {
  ChannelMessage,
  ChannelSummary,
} from "../../features/relay/contracts";
import type { Shortcut } from "../../features/shortcuts/service";
import { ACTION_NAVIGATE_OPTION } from "../../features/search/voice-actions";
import { ToastProvider } from "../../shared/design-system/ui/Toast";
import { VoiceJump, type VoiceJumpServices } from "./VoiceJump";

const dictationHandlers = vi.hoisted(() => ({
  current: undefined as
    | {
        onText: (next: string) => void;
        onPause: (spoken: string) => void;
        onEnd: (spoken: string) => void;
        onError: (message: string) => void;
      }
    | undefined,
  start: vi.fn(async () => {}),
  stop: vi.fn(),
  cancel: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
}));

vi.mock("../../features/search/voice-dictation", () => ({
  prepareVoice: () => {},
  useVoiceSearchAvailable: (enabled: boolean) => enabled,
  useVoiceDictation: (callbacks: typeof dictationHandlers.current) => {
    dictationHandlers.current = callbacks;
    return {
      state: "listening" as const,
      start: dictationHandlers.start,
      stop: dictationHandlers.stop,
      cancel: dictationHandlers.cancel,
    };
  },
}));

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  dictationHandlers.current = undefined;
  vi.clearAllMocks();
});

const origin = "https://relay.example.org";
const viewer = "f".repeat(64);
const alexPk = "a".repeat(64);
const alicePk = "d".repeat(64);
const msgId = "e".repeat(64);

function setup(
  decideImpl: (req: { state: string }) => Promise<DecisionResult>,
) {
  const setStar = vi.fn(async () => ["sec"]);
  const assign = vi.fn(async () => ({ sections: [], assignments: {} }));
  const openDm = vi.fn(async () => "dm-alex");
  const forward = vi.fn(() => "sent-fwd-1");
  const delivered = vi.fn(async () => {});
  const acknowledge = vi.fn(async () => {});
  const navOpen = vi.fn(async () => ({ status: "opened" as const }));

  const channels: ChannelSummary[] = [
    {
      id: "sec",
      name: "buzz-security",
      channelType: "stream",
      lastActivityAt: 200,
    } as ChannelSummary,
    {
      id: "design",
      name: "design",
      channelType: "stream",
      lastActivityAt: 100,
    } as ChannelSummary,
  ];
  const row: ChannelMessage = {
    id: msgId,
    channelId: "sec",
    authorId: alicePk,
    createdAt: 190,
    content: "Please review this",
    mentions: [],
    attachments: [],
    reactions: [],
    replyCount: 0,
    participants: [],
  } as ChannelMessage;

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
        rows: id === "sec" ? [row] : [],
        hasMore: false,
        loadingOlder: false,
        error: undefined,
      }),
    },
    unread: {
      inbox: () => ({ items: [] }),
      sync: () => ({ capability: "frontier-sync" }),
      snapshot: () => ({ manual: "none", observedCount: 0 }),
    },
    channelLifecycle: { available: false },
    sidebarPreferences: {
      writable: true,
      starWritable: true,
      ensure: async () => {},
      setStar,
      assign,
      snapshot: () => ({
        status: "ready",
        data: {
          sections: [{ id: "work", name: "Work", order: 0 }],
          assignments: {},
          starred: [],
          muted: [],
        },
      }),
    },
    profiles: {
      snapshot: () =>
        new Map([
          [alicePk, { name: "Alice" }],
          [alexPk, { name: "Alex", isAgent: true }],
        ]),
    },
    agentChoices: {
      snapshot: () => ({
        identities: [
          {
            pubkey: alexPk,
            name: "Alex",
            managed: true,
            messageable: true,
          },
        ],
      }),
    },
    directMessages: {
      available: true,
      open: openDm,
      delivered,
    },
    messages: {
      forwardProblem: () => undefined,
      forward,
    },
    outbox: {
      supports: () => false,
      acknowledge,
    },
  };

  const client = {
    selected: origin,
    viewer,
    memberships: [{ id: origin, name: "Example", url: origin }],
  };
  const relaySnapshot = {
    status: "ready" as const,
    scope: `${origin}:${viewer}`,
    session,
  };
  const communities = {
    subscribe: () => () => {},
    snapshot: () => client,
    relay: { subscribe: () => () => {}, snapshot: () => relaySnapshot },
  } as unknown as Communities;

  let registered: Shortcut | undefined;
  const shortcuts = {
    registerHost(shortcut: Shortcut) {
      registered = shortcut;
      return () => {};
    },
  } as unknown as VoiceJumpServices["shortcuts"];

  const navigation = {
    subscribe: () => () => {},
    snapshot: () => ({
      entry: { target: { kind: "conversation", channelId: "sec" } },
    }),
    open: navOpen,
  } as unknown as Navigation;

  const decisions = {
    decide: vi.fn(decideImpl),
  } as unknown as NonNullable<VoiceJumpServices["decisions"]>;

  const services: VoiceJumpServices = {
    communities,
    shortcuts,
    navigation,
    decisions,
  };

  render(
    <ToastProvider>
      <div id="dom-fixture" />
      <VoiceJump services={services} />
    </ToastProvider>,
  );

  return {
    triggerShortcut: () => act(() => registered?.run()),
    setStar,
    assign,
    openDm,
    forward,
    navOpen,
    decisions,
  };
}

describe("VoiceJump contextual voice actions", () => {
  it("captures hovered channel on shortcut press and auto-runs star without confirmation", async () => {
    const h = setup(async () => ({
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers: {
        action: {
          type: "choice",
          choice: "Star #buzz-security (pin to Starred / Favorites)",
          confidence: 0.96,
          probabilities: {
            "Star #buzz-security (pin to Starred / Favorites)": 0.96,
          },
        },
        place: {
          type: "choice",
          choice: "none",
          confidence: 0.9,
          probabilities: { none: 0.9 },
        },
      },
    }));

    const fixture = byId("dom-fixture");
    fixture.innerHTML = `<button type="button" data-channel-id="sec">buzz-security</button>`;
    const row = (() => {
      const el = fixture.querySelector('[data-channel-id="sec"]');
      assert(el);
      return el;
    })();
    document.elementsFromPoint = vi.fn(() => [row]);
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 25, clientY: 35 }),
    );

    h.triggerShortcut();

    expect(await screen.findByText("#buzz-security")).toBeInTheDocument();

    act(() => {
      dictationHandlers.current?.onText("star this");
    });

    await waitFor(() => expect(h.setStar).toHaveBeenCalledWith("sec", true));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Jump or act by voice" }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByText("Starred #buzz-security"),
    ).toBeInTheDocument();
  });

  it("moves a hovered channel to a sidebar section end-to-end", async () => {
    const h = setup(async () => ({
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers: {
        action: {
          type: "choice",
          choice: "Move #buzz-security into a sidebar section",
          confidence: 0.94,
          probabilities: {
            "Move #buzz-security into a sidebar section": 0.94,
          },
        },
        section: {
          type: "choice",
          choice: "Work",
          confidence: 0.93,
          probabilities: { Work: 0.93 },
        },
        place: {
          type: "choice",
          choice: "none",
          confidence: 0.95,
          probabilities: { none: 0.95 },
        },
      },
    }));

    const fixture = byId("dom-fixture");
    fixture.innerHTML = `<button type="button" data-channel-id="sec">buzz-security</button>`;
    const row = (() => {
      const el = fixture.querySelector('[data-channel-id="sec"]');
      assert(el);
      return el;
    })();
    document.elementsFromPoint = vi.fn(() => [row]);
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 25, clientY: 35 }),
    );

    h.triggerShortcut();
    await screen.findByText("#buzz-security");

    act(() => {
      dictationHandlers.current?.onEnd("move this to work");
    });

    await waitFor(() => expect(h.assign).toHaveBeenCalledWith("sec", "work"));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Jump or act by voice" }),
      ).not.toBeInTheDocument(),
    );
  });

  it("never fires confirm-gated forward on partial speech, shows confirm chip on pause, and sends on Enter", async () => {
    const h = setup(async () => ({
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers: {
        action: {
          type: "choice",
          choice:
            'Forward message from Alice: "Please review this" to a person or agent (DM)',
          confidence: 0.95,
          probabilities: {
            'Forward message from Alice: "Please review this" to a person or agent (DM)': 0.95,
          },
        },
        person: {
          type: "choice",
          choice: "Alex",
          confidence: 0.94,
          probabilities: { Alex: 0.94 },
        },
        place: {
          type: "choice",
          choice: "none",
          confidence: 0.95,
          probabilities: { none: 0.95 },
        },
      },
    }));

    const fixture = byId("dom-fixture");
    fixture.innerHTML = `
      <section data-channel-timeline="sec">
        <div data-message-id="${msgId}">
          <span data-message-author="">Alice</span>
          <p id="msg-text">Please review this</p>
        </div>
      </section>
    `;
    const msgEl = byId("msg-text");
    document.elementsFromPoint = vi.fn(() => [msgEl]);
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 40, clientY: 60 }),
    );

    h.triggerShortcut();
    expect(
      await screen.findByText('message from Alice: "Please review this"'),
    ).toBeInTheDocument();

    // Partial live speech must NEVER forward immediately.
    act(() => {
      dictationHandlers.current?.onText("send this to Alex");
    });
    await waitFor(() => expect(h.decisions.decide).toHaveBeenCalled());
    expect(h.forward).not.toHaveBeenCalled();
    expect(h.openDm).not.toHaveBeenCalled();

    // Pause presents the confirm chip.
    act(() => {
      dictationHandlers.current?.onPause("send this to Alex");
    });

    const confirmRegion = await screen.findByRole("region", {
      name: "Confirm voice action",
    });
    expect(confirmRegion).toHaveTextContent(
      'Forward message from Alice: "Please review this" to Alex',
    );
    expect(h.forward).not.toHaveBeenCalled();

    // Pressing Enter executes the forward.
    const user = userEvent.setup();
    await user.keyboard("{Enter}");

    await waitFor(() => expect(h.forward).toHaveBeenCalledOnce());
    expect(h.openDm).toHaveBeenCalledWith([alexPk], expect.any(AbortSignal));
  });

  it("cancels confirm chip cleanly on Escape without forwarding", async () => {
    const h = setup(async () => ({
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers: {
        action: {
          type: "choice",
          choice:
            'Forward message from Alice: "Please review this" to a person or agent (DM)',
          confidence: 0.95,
          probabilities: {
            'Forward message from Alice: "Please review this" to a person or agent (DM)': 0.95,
          },
        },
        person: {
          type: "choice",
          choice: "Alex",
          confidence: 0.94,
          probabilities: { Alex: 0.94 },
        },
        place: {
          type: "choice",
          choice: "none",
          confidence: 0.95,
          probabilities: { none: 0.95 },
        },
      },
    }));

    const fixture = byId("dom-fixture");
    fixture.innerHTML = `
      <section data-channel-timeline="sec">
        <div data-message-id="${msgId}">
          <p id="msg-text">Please review this</p>
        </div>
      </section>
    `;
    document.elementsFromPoint = vi.fn(() => [byId("msg-text")]);
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 40, clientY: 60 }),
    );

    h.triggerShortcut();
    act(() => {
      dictationHandlers.current?.onEnd("send this to Alex");
    });

    await screen.findByRole("region", { name: "Confirm voice action" });
    const user = userEvent.setup();
    await user.keyboard("{Escape}");

    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Jump or act by voice" }),
      ).not.toBeInTheDocument(),
    );
    expect(h.forward).not.toHaveBeenCalled();
  });

  it("warms the Decisions connection when the voice box opens", async () => {
    const h = setup(async () => ({
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers: { warm: { type: "yes_no", probability: 1 } },
    }));
    const decisions = h.decisions as unknown as {
      status?: () => string;
      decide: ReturnType<typeof vi.fn>;
    };
    decisions.status = () => "ready";

    h.triggerShortcut();
    await waitFor(() =>
      expect(decisions.decide).toHaveBeenCalledWith(
        expect.objectContaining({
          state: "{}",
          questions: { warm: { type: "yes_no", instructions: "ok" } },
          timeoutMs: 2000,
        }),
      ),
    );
  });

  it("runs actions from typed input + Enter and shows clickable options below 0.7", async () => {
    const h = setup(async () => ({
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers: {
        action: {
          type: "choice",
          choice: "Star #buzz-security (pin to Starred / Favorites)",
          confidence: 0.58,
          probabilities: {
            "Star #buzz-security (pin to Starred / Favorites)": 0.58,
          },
        },
        place: {
          type: "choice",
          choice: "none",
          confidence: 0.9,
          probabilities: { none: 0.9 },
        },
      },
    }));

    const fixture = byId("dom-fixture");
    fixture.innerHTML = `<button type="button" data-channel-id="sec">buzz-security</button>`;
    const row = (() => {
      const el = fixture.querySelector('[data-channel-id="sec"]');
      assert(el);
      return el;
    })();
    document.elementsFromPoint = vi.fn(() => [row]);
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 25, clientY: 35 }),
    );

    h.triggerShortcut();
    const input = await screen.findByRole("searchbox");
    const user = userEvent.setup();
    await user.type(input, "star this{Enter}");

    // At 0.58 (< 0.7), it does not auto-run and instead shows the clickable option.
    const option = await screen.findByRole("button", {
      name: /Star #buzz-security/i,
    });
    expect(h.setStar).not.toHaveBeenCalled();

    await user.click(option);
    await waitFor(() => expect(h.setStar).toHaveBeenCalledWith("sec", true));
  });

  it("ignores hover and navigates when Jev picks navigate", async () => {
    const h = setup(async () => ({
      outcome: "answered",
      backend: "test",
      model: "jev",
      answers: {
        action: {
          type: "choice",
          choice: ACTION_NAVIGATE_OPTION,
          confidence: 0.93,
          probabilities: { [ACTION_NAVIGATE_OPTION]: 0.93 },
        },
        place: {
          type: "choice",
          choice: "#design",
          confidence: 0.91,
          probabilities: { "#design": 0.91 },
        },
      },
    }));

    const fixture = byId("dom-fixture");
    fixture.innerHTML = `<button type="button" data-channel-id="sec">buzz-security</button>`;
    document.elementsFromPoint = vi.fn(() => [
      (() => {
        const el = fixture.querySelector('[data-channel-id="sec"]');
        assert(el);
        return el;
      })(),
    ]);
    window.dispatchEvent(
      new MouseEvent("pointermove", { clientX: 15, clientY: 15 }),
    );

    h.triggerShortcut();
    act(() => {
      dictationHandlers.current?.onText("take me to design");
    });

    await waitFor(() =>
      expect(h.navOpen).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "conversation",
          channelId: "design",
        }),
      ),
    );
    expect(h.setStar).not.toHaveBeenCalled();
  });
});
