// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { createRelaySession } from "../../features/relay/session";
import type {
  ChannelSummary,
  ChannelWindow,
} from "../../features/relay/contracts";
import type {
  DecisionResult,
  Decisions,
} from "../../features/decisions/service";
import { VoiceJump, type VoiceJumpServices } from "./VoiceJump";

vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => true,
  invoke: vi.fn(async (command: string) =>
    command === "voice_search_available"
      ? true
      : command === "voice_search_connect"
        ? "answer"
        : undefined,
  ),
}));
const originalMediaDevices = Object.getOwnPropertyDescriptor(
  navigator,
  "mediaDevices",
);
beforeEach(() => {
  // Typed-decision cases do not request a real microphone.
  vi.stubGlobal(
    "RTCPeerConnection",
    class {
      constructor() {
        throw new DOMException(
          "Microphone unavailable in this fixture",
          "NotAllowedError",
        );
      }
    },
  );
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
  vi.useRealTimers();
  vi.unstubAllGlobals();
  if (originalMediaDevices)
    Object.defineProperty(navigator, "mediaDevices", originalMediaDevices);
  else Reflect.deleteProperty(navigator, "mediaDevices");
});

const chosen: DecisionResult = {
  outcome: "answered",
  backend: "test",
  model: "test",
  answers: {
    place: {
      type: "choice",
      choice: "#Design",
      confidence: 1,
      probabilities: { "#Design": 1, none: 0 },
    },
  },
};
function deferred() {
  let resolve: (value: DecisionResult) => void = () => {};
  const promise = new Promise<DecisionResult>((done) => {
    resolve = done;
  });
  return { resolve, promise };
}
function setup() {
  const owner = createRelaySession(null);
  const viewer = "a".repeat(64);
  const session = (id: string) => {
    const channel: ChannelSummary = {
      id,
      name: "Design",
      channelType: "stream",
    };
    const history: ChannelWindow = {
      channelId: id,
      status: "ready",
      rows: [],
      hasMore: false,
      loadingOlder: false,
      error: undefined,
    };
    return {
      ...owner.session,
      channels: {
        ...owner.session.channels,
        list: () => ({ status: "ready" as const, channels: [channel] }),
        window: () => history,
        get: () => channel,
      },
    };
  };
  let connection = {
    session: session("first"),
    generation: 1,
    status: "ready" as const,
    scope: `https://first.example:${viewer}`,
  };
  let community = { viewer, selected: "https://first.example" };
  const listeners = new Set<() => void>();
  const decide = vi.fn<Decisions["decide"]>().mockResolvedValue(chosen);
  const open = vi.fn(async () => {});
  const services = {
    decisions: { decide },
    shortcuts: { registerHost: () => () => {} },
    navigation: { open },
    communities: {
      snapshot: () => community,
      relay: {
        snapshot: () => connection,
        subscribe: (listener: () => void) => {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
      },
    },
  } as unknown as VoiceJumpServices;
  const user = userEvent.setup();
  render(<VoiceJump services={services} />);
  const selectSecond = (ready: boolean) =>
    act(() => {
      community = { ...community, selected: "https://second.example" };
      if (ready)
        connection = {
          session: session("second"),
          generation: 2,
          status: "ready",
          scope: `https://second.example:${viewer}`,
        };
      for (const listener of listeners) listener();
    });
  return {
    user,
    decide,
    open,
    viewer,
    selectSecond,
    dispose: () => {
      cleanup();
      owner.dispose();
    },
  };
}

it.each(["dismissal", "community change", "selection before relay"])(
  "retires a pending voice match on %s",
  async (exit) => {
    const t = setup();
    const pending = deferred();
    t.decide.mockImplementationOnce(() => pending.promise);
    try {
      await t.user.click(
        await screen.findByRole("button", { name: "Jump by voice" }),
      );
      await t.user.type(
        await screen.findByRole("searchbox", { name: "Where to" }),
        "Design",
      );
      await t.user.keyboard("{Enter}");
      await waitFor(() => expect(t.decide).toHaveBeenCalledOnce());
      if (exit === "dismissal") {
        await t.user.keyboard("{Escape}");
        await waitFor(() =>
          expect(
            screen.queryByRole("dialog", { name: "Jump by voice" }),
          ).not.toBeInTheDocument(),
        );
      } else t.selectSecond(exit === "community change");
      await act(async () => {
        pending.resolve(chosen);
        await pending.promise;
      });
      expect(t.open).not.toHaveBeenCalled();
      if (exit === "selection before relay") t.selectSecond(true);
      if (exit === "dismissal")
        await t.user.click(
          screen.getByRole("button", { name: "Jump by voice" }),
        );
      await t.user.type(
        await screen.findByRole("searchbox", { name: "Where to" }),
        "Design",
      );
      await t.user.keyboard("{Enter}");
      await waitFor(() => expect(t.open).toHaveBeenCalledOnce());
      expect(t.open).toHaveBeenCalledWith(
        expect.objectContaining({
          channelId: exit === "dismissal" ? "first" : "second",
          scope: {
            viewer: t.viewer,
            communityOrigin:
              exit === "dismissal"
                ? "https://first.example"
                : "https://second.example",
          },
        }),
      );
    } finally {
      pending.resolve(chosen);
      t.dispose();
    }
  },
);

it.each([false, true])(
  "waits for the newest spoken words when an older match returns (paused=%s)",
  async (paused) => {
    const channel = new EventTarget();
    const connected = vi.fn(async () => {});
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: async () => ({
          getAudioTracks: () => [{}],
          getTracks: () => [{ stop() {} }],
        }),
      },
    });
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        addTransceiver() {
          return { sender: { replaceTrack: async () => {} } };
        }
        createDataChannel() {
          return channel;
        }
        async createOffer() {
          return { type: "offer", sdp: "offer" };
        }
        async setLocalDescription() {}
        setRemoteDescription = connected;
        close() {}
      },
    );
    const t = setup();
    const older = deferred(),
      newer = deferred();
    t.decide
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);
    const say = (delta: string) =>
      act(() =>
        channel.dispatchEvent(
          new MessageEvent("message", {
            data: JSON.stringify({
              type: "conversation.item.input_audio_transcription.delta",
              delta,
            }),
          }),
        ),
      );
    try {
      await t.user.click(
        await screen.findByRole("button", { name: "Jump by voice" }),
      );
      await waitFor(() => expect(connected).toHaveBeenCalledOnce());
      // Real async setup reaches a connected WebRTC session before the clock
      // controls speech pauses. Live-only ordering needs no fake clock.
      if (paused)
        vi.useFakeTimers({
          toFake: ["setTimeout", "clearTimeout"],
          shouldClearNativeTimers: true,
        });
      say("Design");
      expect(t.decide).toHaveBeenCalledOnce();
      if (paused) await act(() => vi.advanceTimersByTimeAsync(800));
      say(" systems");
      await act(async () => {
        older.resolve(chosen);
        await older.promise;
      });
      expect(t.decide).toHaveBeenCalledTimes(2);
      expect(t.open).not.toHaveBeenCalled();
      await act(async () => {
        newer.resolve(chosen);
        await newer.promise;
      });
      expect(t.open).toHaveBeenCalledOnce();
    } finally {
      older.resolve(chosen);
      newer.resolve(chosen);
      t.dispose();
    }
  },
);
