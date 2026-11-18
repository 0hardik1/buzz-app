// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import { useVoiceDictation } from "./voice-dictation";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async () => "answer"),
}));
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

it.each(["offer", "local description"])(
  "does not request microphone access when cancelled during %s preparation",
  async (stage) => {
    let release: () => void = () => {};
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const offer = { type: "offer" as const, sdp: "offer" };
    const createOffer = vi.fn(() =>
      stage === "offer" ? pending.then(() => offer) : Promise.resolve(offer),
    );
    const setLocalDescription = vi.fn(() =>
      stage === "local description" ? pending : Promise.resolve(),
    );
    const close = vi.fn();
    const microphone = vi.fn();
    vi.stubGlobal(
      "navigator",
      Object.create(navigator, {
        mediaDevices: { value: { getUserMedia: microphone } },
      }),
    );
    vi.stubGlobal(
      "RTCPeerConnection",
      class {
        addTransceiver() {
          return { sender: { replaceTrack: vi.fn() } };
        }
        createDataChannel() {
          return new EventTarget();
        }
        createOffer = createOffer;
        setLocalDescription = setLocalDescription;
        close = close;
      },
    );
    const hook = renderHook(() =>
      useVoiceDictation({ onText: vi.fn(), onEnd: vi.fn() }),
    );
    let started: Promise<void> = Promise.resolve();
    try {
      act(() => {
        started = hook.result.current.start();
      });
      await vi.waitFor(() =>
        expect(
          stage === "offer" ? createOffer : setLocalDescription,
        ).toHaveBeenCalledOnce(),
      );
      act(() => hook.result.current.cancel());
      await act(async () => {
        release();
        await started;
      });
      expect(close).toHaveBeenCalledOnce();
      expect(microphone).not.toHaveBeenCalled();
      expect(invoke).not.toHaveBeenCalled();
      expect(hook.result.current.state).toBe("idle");
    } finally {
      release();
      await act(async () => {
        await started;
      });
    }
  },
);
