// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  WHEEL_EASING,
  cubicBezier,
  easeWheel,
  installWheelEasing,
  setWheelKindForTest,
  stopWheelEasing,
  tweenDuration,
  wheelEasing,
} from "./wheel-easing";

let now = 0;
let frames: Array<[number, FrameRequestCallback]> = [];
let nextFrame = 1;
const cleanups: Array<() => void> = [];

/** Runs frames at 60 Hz until none are pending, or `limit` ms pass. */
function run(limit = 1000) {
  const end = now + limit;
  while (frames.length && now < end) {
    now += 1000 / 60;
    const pending = frames;
    frames = [];
    for (const [, callback] of pending) callback(now);
  }
}

function frame(count: number) {
  for (let i = 0; i < count; i++) {
    now += 1000 / 60;
    const pending = frames;
    frames = [];
    for (const [, callback] of pending) callback(now);
  }
}

function scroller({ top = 1000, height = 5000, viewport = 600 } = {}) {
  const element = document.createElement("section");
  let scrollTop = top;
  Object.defineProperties(element, {
    scrollTop: {
      get: () => scrollTop,
      set: (value: number) => {
        scrollTop = Math.max(0, Math.min(height - viewport, value));
      },
    },
    scrollHeight: { get: () => height },
    clientHeight: { get: () => viewport },
  });
  document.body.append(element);
  cleanups.push(installWheelEasing(element), () => element.remove());
  return element;
}

const wheel = (target: Element, deltaY: number, init: WheelEventInit = {}) => {
  const event = new WheelEvent("wheel", {
    deltaY,
    bubbles: true,
    cancelable: true,
    ...init,
  });
  target.dispatchEvent(event);
  return event;
};

beforeEach(() => {
  now = 0;
  frames = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    frames.push([nextFrame, callback]);
    return nextFrame++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => {
    frames = frames.filter(([frameId]) => frameId !== id);
  });
  vi.spyOn(performance, "now").mockImplementation(() => now);
  setWheelKindForTest("coarse");
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  setWheelKindForTest(undefined);
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("eases a mouse-wheel tick over several frames to its full distance", () => {
  const element = scroller();
  const event = wheel(element, 120);
  expect(event.defaultPrevented).toBe(true);
  expect(element.scrollTop).toBe(1000);

  const path: number[] = [];
  while (frames.length) {
    frame(1);
    path.push(element.scrollTop);
  }
  expect(element.scrollTop).toBe(1120);
  // The 190 ms curve spans about 11 frames and never moves backwards.
  expect(path.length).toBeGreaterThanOrEqual(10);
  expect(path.length).toBeLessThanOrEqual(13);
  expect(path).toEqual([...path].sort((a, b) => a - b));
  expect(path[0]).toBeLessThan(1060);
});

it("leaves trackpad and unknown input to native scrolling", () => {
  const element = scroller();
  for (const kind of ["precise", undefined] as const) {
    setWheelKindForTest(kind);
    expect(wheel(element, 120).defaultPrevented).toBe(false);
    expect(frames).toHaveLength(0);
  }
});

it("reads the kind the shell set before the module loaded", async () => {
  vi.resetModules();
  window.__buzzWheelInput = "coarse";
  try {
    const fresh = await import("./wheel-easing");
    const element = document.createElement("section");
    let top = 1000;
    Object.defineProperties(element, {
      scrollTop: { get: () => top, set: (v: number) => (top = v) },
      scrollHeight: { get: () => 5000 },
      clientHeight: { get: () => 600 },
    });
    cleanups.push(fresh.installWheelEasing(element));
    expect(wheel(element, 40).defaultPrevented).toBe(true);
    run();
    expect(top).toBe(1040);
  } finally {
    window.__buzzWheelInput = undefined;
  }
});

it("attaches a non-passive wheel listener only while the input is a wheel", () => {
  setWheelKindForTest("precise");
  const element = document.createElement("section");
  const add = vi.spyOn(element, "addEventListener");
  const remove = vi.spyOn(element, "removeEventListener");
  cleanups.push(installWheelEasing(element));
  expect(add.mock.calls.some(([type]) => type === "wheel")).toBe(false);
  setWheelKindForTest("coarse");
  expect(add).toHaveBeenCalledWith("wheel", expect.any(Function), {
    passive: false,
  });
  setWheelKindForTest("precise");
  expect(remove).toHaveBeenCalledWith("wheel", expect.any(Function));
});

it("leaves zoom, horizontal and canceled wheel events alone", () => {
  const element = scroller();
  expect(wheel(element, 40, { ctrlKey: true }).defaultPrevented).toBe(false);
  expect(wheel(element, 40, { deltaX: 10 }).defaultPrevented).toBe(false);
  expect(wheel(element, 0, { deltaX: 40 }).defaultPrevented).toBe(false);
  const canceled = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
  canceled.preventDefault();
  expect(easeWheel(element, canceled)).toBe(false);
  expect(frames).toHaveLength(0);
});

it("retargets from the running position and keeps its speed", () => {
  const element = scroller();
  wheel(element, 100);
  frame(4);
  const before = element.scrollTop;
  frame(1);
  const speed = element.scrollTop - before;
  expect(wheelEasing(element)).toBe(true);
  wheel(element, 100);
  const mid = element.scrollTop;
  frame(1);
  // The slow-starting curve would drop to a crawl without the carried slope.
  expect(element.scrollTop - mid).toBeGreaterThanOrEqual(speed * 0.8);
  run();
  expect(element.scrollTop).toBe(1200);
  expect(wheelEasing(element)).toBe(false);
});

it("keeps the timeline's own scroll corrections made during a tween", () => {
  const element = scroller();
  wheel(element, -120);
  frame(4);
  // A prepend shifts the content down; Virtua corrects the offset.
  element.scrollTop += 500;
  run();
  expect(element.scrollTop).toBe(1000 + 500 - 120);
});

it("stops at the scroller's edges", () => {
  const element = scroller({ top: 30 });
  wheel(element, -120);
  run();
  expect(element.scrollTop).toBe(0);
  expect(frames).toHaveLength(0);

  const bottom = scroller({ top: 4360 });
  wheel(bottom, 120);
  wheel(bottom, 120);
  run();
  expect(bottom.scrollTop).toBe(4400);
});

it("stops when the scroller stops moving mid-tween", () => {
  let height = 5000;
  const element = document.createElement("section");
  let top = 1000;
  Object.defineProperties(element, {
    scrollTop: {
      get: () => top,
      set: (v: number) => (top = Math.max(0, Math.min(height - 600, v))),
    },
    scrollHeight: { get: () => height },
    clientHeight: { get: () => 600 },
  });
  cleanups.push(installWheelEasing(element));
  wheel(element, 120);
  frame(3);
  // The list shrinks so the current offset is already the bottom.
  height = top + 600;
  frame(1);
  expect(frames).toHaveLength(0);
  expect(wheelEasing(element)).toBe(false);
});

it("lets an inner scroller under the pointer scroll natively", () => {
  const element = scroller();
  const inner = document.createElement("pre");
  inner.style.overflowY = "auto";
  let innerTop = 10;
  Object.defineProperties(inner, {
    scrollTop: { get: () => innerTop, set: (v: number) => (innerTop = v) },
    scrollHeight: { get: () => 400 },
    clientHeight: { get: () => 100 },
  });
  element.append(inner);
  expect(wheel(inner, 40).defaultPrevented).toBe(false);
  // At its end, the wheel chains to the history and is eased.
  innerTop = 300;
  expect(wheel(inner, 40).defaultPrevented).toBe(true);
});

it("stops on a press, a key, precise input or an explicit stop", () => {
  const element = scroller();
  const stops: Array<() => void> = [
    () => document.dispatchEvent(new Event("pointerdown")),
    () => document.dispatchEvent(new KeyboardEvent("keydown", { key: "End" })),
    () =>
      window.dispatchEvent(
        new CustomEvent("buzz:wheel-input", { detail: "precise" }),
      ),
    () => stopWheelEasing(element),
  ];
  for (const stop of stops) {
    setWheelKindForTest("coarse");
    const start = element.scrollTop;
    wheel(element, 120);
    frame(2);
    stop();
    const stopped = element.scrollTop;
    expect(stopped).toBeGreaterThan(start);
    expect(stopped).toBeLessThan(start + 120);
    run();
    expect(element.scrollTop).toBe(stopped);
  }
});

it("eases only scrollers that installed easing", () => {
  const plain = document.createElement("section");
  document.body.append(plain);
  cleanups.push(() => plain.remove());
  const event = new WheelEvent("wheel", { deltaY: 40, cancelable: true });
  expect(easeWheel(plain, event, null)).toBe(false);
  expect(event.defaultPrevented).toBe(false);
});

it("converts line and page deltas to pixels", () => {
  const element = scroller();
  wheel(element, 3, { deltaMode: WheelEvent.DOM_DELTA_LINE });
  run();
  expect(element.scrollTop).toBe(1120);
  wheel(element, 1, { deltaMode: WheelEvent.DOM_DELTA_PAGE });
  run();
  expect(element.scrollTop).toBe(1720);
});

it("uses the tuned curve and shortens long moves", () => {
  expect(cubicBezier(0.42, 0, 0.58, 1)(0.5)).toBeCloseTo(0.5, 4);
  const { x1, y1, x2, y2 } = WHEEL_EASING;
  const ease = cubicBezier(x1, y1, x2, y2);
  const samples = Array.from({ length: 21 }, (_, i) => ease(i / 20));
  expect(samples[0]).toBe(0);
  expect(samples[20]).toBe(1);
  expect(samples).toEqual([...samples].sort((a, b) => a - b));
  // It starts slowly: a tenth of the time covers under a tenth of the move.
  expect(ease(0.1)).toBeLessThan(0.1);
  expect(tweenDuration(40)).toBe(190);
  expect(tweenDuration(240)).toBeCloseTo(158.33, 1);
  expect(tweenDuration(2000)).toBe(95);
});
