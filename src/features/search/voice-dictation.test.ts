// @vitest-environment jsdom
import { invoke } from "@tauri-apps/api/core";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { PAUSE_MS, useVoiceDictation } from "./voice-dictation";

type Send = (event: unknown) => void;
let send: Send = () => {};

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  Channel: class {
    constructor(onmessage: Send) {
      send = onmessage;
    }
  },
}));

let answer: (session: number) => void = () => {};
beforeEach(() => {
  vi.useFakeTimers();
  vi.mocked(invoke).mockReset();
  vi.mocked(invoke).mockImplementation(async (command) => {
    if (command !== "voice_search_start") return undefined;
    return new Promise<number>((resolve) => {
      answer = resolve;
    });
  });
});
afterEach(() => vi.useRealTimers());

function dictation() {
  const onText = vi.fn();
  const onPause = vi.fn();
  const onEnd = vi.fn();
  const onError = vi.fn();
  const hook = renderHook(() =>
    useVoiceDictation({ onText, onPause, onEnd, onError }),
  );
  return { hook, onText, onPause, onEnd, onError };
}

const calls = (command: string) =>
  vi.mocked(invoke).mock.calls.filter(([name]) => name === command);

it("streams the transcript, reports a pause, and ends with the final words", async () => {
  const { hook, onText, onPause, onEnd } = dictation();
  let started!: Promise<void>;
  act(() => {
    started = hook.result.current.start(["buzz security"]);
  });
  expect(hook.result.current.state).toBe("starting");
  expect(calls("voice_search_start")[0]?.[1]).toMatchObject({
    hints: ["buzz security"],
  });
  await act(async () => {
    answer(7);
    await started;
  });
  act(() => send({ kind: "listening" }));
  expect(hook.result.current.state).toBe("listening");
  act(() => send({ kind: "text", text: "take me to bus" }));
  act(() => send({ kind: "text", text: "take me to Buzz security" }));
  expect(onText).toHaveBeenLastCalledWith("take me to Buzz security");
  act(() => vi.advanceTimersByTime(PAUSE_MS - 1));
  expect(onPause).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onPause).toHaveBeenCalledWith("take me to Buzz security");

  act(() => hook.result.current.stop());
  expect(calls("voice_search_finish")).toEqual([
    ["voice_search_finish", { session: 7 }],
  ]);
  // Listening goes on until the final transcript arrives.
  expect(onEnd).not.toHaveBeenCalled();
  act(() => send({ kind: "ended", text: "Take me to Buzz security." }));
  expect(onEnd).toHaveBeenCalledWith("Take me to Buzz security.");
  expect(hook.result.current.state).toBe("idle");
  act(() => send({ kind: "text", text: "late" }));
  expect(onText).not.toHaveBeenCalledWith("late");
});

it("reports what was heard when the final transcript doesn't come", async () => {
  const { hook, onEnd } = dictation();
  await act(async () => {
    const started = hook.result.current.start();
    answer(1);
    await started;
  });
  act(() => send({ kind: "listening" }));
  act(() => send({ kind: "text", text: "design" }));
  act(() => hook.result.current.stop());
  act(() => vi.advanceTimersByTime(999));
  expect(onEnd).not.toHaveBeenCalled();
  act(() => vi.advanceTimersByTime(1));
  expect(onEnd).toHaveBeenCalledWith("design");
  expect(hook.result.current.state).toBe("idle");
});

it("cancels a listen that native code starts after it was cancelled", async () => {
  const { hook, onEnd } = dictation();
  let started!: Promise<void>;
  act(() => {
    started = hook.result.current.start();
  });
  act(() => hook.result.current.cancel());
  expect(hook.result.current.state).toBe("idle");
  await act(async () => {
    answer(3);
    await started;
  });
  expect(calls("voice_search_cancel")).toEqual([
    ["voice_search_cancel", { session: 3 }],
  ]);
  expect(onEnd).not.toHaveBeenCalled();
});

it("finishes a listen stopped before native code answered", async () => {
  const { hook } = dictation();
  let started!: Promise<void>;
  act(() => {
    started = hook.result.current.start();
  });
  act(() => hook.result.current.stop());
  await act(async () => {
    answer(4);
    await started;
  });
  expect(calls("voice_search_finish")).toEqual([
    ["voice_search_finish", { session: 4 }],
  ]);
});

it("reports a failure without ending on words", async () => {
  const { hook, onEnd, onError } = dictation();
  await act(async () => {
    const started = hook.result.current.start();
    answer(5);
    await started;
  });
  act(() => send({ kind: "text", text: "half" }));
  act(() =>
    send({
      kind: "error",
      message: "Allow Buzz to use your microphone to search by voice.",
    }),
  );
  expect(onError).toHaveBeenCalledWith(
    "Allow Buzz to use your microphone to search by voice.",
  );
  expect(onEnd).not.toHaveBeenCalled();
  expect(hook.result.current.state).toBe("idle");
});

it("ends a listen that hears nothing", async () => {
  const { hook, onEnd } = dictation();
  await act(async () => {
    const started = hook.result.current.start();
    answer(6);
    await started;
  });
  act(() => send({ kind: "listening" }));
  act(() => vi.advanceTimersByTime(8_000));
  expect(calls("voice_search_finish")).toHaveLength(1);
  act(() => send({ kind: "ended", text: "" }));
  expect(onEnd).not.toHaveBeenCalled();
  expect(hook.result.current.state).toBe("idle");
});
