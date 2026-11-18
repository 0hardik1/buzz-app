import { type RefObject, useEffect } from "react";

/**
 * Mouse-wheel easing for history scrollers.
 *
 * WebKit moves a notched mouse wheel's whole tick in one frame, so reading
 * with a wheel looks like a series of jumps. Chromium eases each tick instead.
 * An eased scroller animates each mouse-wheel tick over a short cubic-bezier
 * curve, retargeting as ticks arrive. Trackpads, Magic Mice and every
 * other precise input keep native scrolling and momentum.
 *
 * DOM wheel events do not say whether a wheel or a trackpad sent them. On
 * macOS the desktop shell reads AppKit's `hasPreciseScrollingDeltas` and sends
 * the kind as `buzz:wheel-input` (`src-tauri/src/wheel_input.rs`). Without that
 * signal (browsers, other platforms) nothing is eased.
 */

/** A slow-starting curve whose speed and stop time track Chromium-based
 * apps' mouse-wheel scrolling. */
export const WHEEL_EASING = {
  x1: 0.53,
  y1: 0.21,
  x2: 0.38,
  y2: 0.65,
  /** Duration of a small tick; larger moves take down to half of it. */
  duration: 190,
} as const;

/** WebKit and Chromium move 40px per wheel line. */
const LINE_PX = 40;

type WheelKind = "coarse" | "precise" | undefined;

declare global {
  interface Window {
    __buzzWheelInput?: WheelKind;
  }
  interface WindowEventMap {
    "buzz:wheel-input": CustomEvent<WheelKind>;
  }
}

/** The shell's latest report; it may have arrived before this module. */
let kind: WheelKind =
  typeof window === "undefined" ? undefined : window.__buzzWheelInput;
const controllers = new WeakMap<HTMLElement, Controller>();
const active = new Set<Controller>();
/** Installed scrollers' listener updates, run when the kind changes. */
const kindListeners = new Set<() => void>();

function setKind(next: WheelKind) {
  kind = next;
  // Precise input scrolls natively; a running tween would fight it.
  if (kind !== "coarse")
    for (const controller of [...active]) controller.stop();
  for (const update of kindListeners) update();
}

if (typeof window !== "undefined")
  window.addEventListener("buzz:wheel-input", (event) => setKind(event.detail));

/** Test hook: sets the input kind as the shell would. */
export function setWheelKindForTest(next: WheelKind) {
  setKind(next);
}

/** A cubic-bezier timing function from (0,0) to (1,1). */
export function cubicBezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  const x = (t: number) => ((ax * t + bx) * t + cx) * t;
  const y = (t: number) => ((ay * t + by) * t + cy) * t;
  const dx = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (u: number) => {
    if (!(u > 0)) return 0;
    if (u >= 1) return 1;
    let t = u;
    for (let i = 0; i < 8; i++) {
      const error = x(t) - u;
      if (Math.abs(error) < 1e-6) return y(t);
      const slope = dx(t);
      if (Math.abs(slope) < 1e-6) break;
      t -= error / slope;
      if (t < 0 || t > 1) break;
    }
    let low = 0;
    let high = 1;
    t = u;
    for (let i = 0; i < 40; i++) {
      if (x(t) < u) low = t;
      else high = t;
      t = (low + high) / 2;
    }
    return y(t);
  };
}

/** Small ticks take the full duration; a move of 480px or more takes half. */
export const tweenDuration = (distance: number) =>
  (WHEEL_EASING.duration * Math.min(12, Math.max(6, 14 - distance / 60))) / 12;

type Segment = {
  from: number;
  to: number;
  start: number;
  duration: number;
  ease: (u: number) => number;
};

const at = (segment: Segment, time: number) =>
  segment.from +
  (segment.to - segment.from) *
    segment.ease((time - segment.start) / segment.duration);

/**
 * One scroller's tween. Positions are offsets from where the tween started,
 * applied as deltas, so the timeline's own scroll corrections (prepends, row
 * measurement) keep their effect while a tween runs.
 */
class Controller {
  private segment: Segment | undefined;
  /** Displacement written to the scroller so far. */
  private written = 0;
  private frame: number | undefined;

  constructor(private readonly element: HTMLElement) {}

  wheel(delta: number, now: number) {
    const { element, segment } = this;
    const running = segment && now < segment.start + segment.duration;
    // A finished segment's last frame may not have been written yet.
    const current = !segment
      ? this.written
      : running
        ? at(segment, now)
        : segment.to;
    const velocity = running
      ? (at(segment, now) - at(segment, now - 8)) / 8
      : 0;
    // Keep the scroll inside the scroller as it is now.
    const offset = element.scrollTop - this.written;
    const max = element.scrollHeight - element.clientHeight - offset;
    const to = Math.max(
      -offset,
      Math.min(max, (segment ? segment.to : this.written) + delta),
    );
    const distance = to - current;
    if (Math.abs(distance) < 0.5) return;
    const duration = tweenDuration(Math.abs(distance));
    // Keep speed: start the new segment at the current velocity, as
    // Chromium's ease-in-out with initial slope does.
    let y1: number = WHEEL_EASING.y1;
    if (velocity)
      y1 = Math.max(
        y1,
        Math.min(20, Math.max(0, (velocity * duration) / distance)) *
          WHEEL_EASING.x1,
      );
    this.segment = {
      from: current,
      to,
      start: now,
      duration,
      ease: cubicBezier(WHEEL_EASING.x1, y1, WHEEL_EASING.x2, WHEEL_EASING.y2),
    };
    active.add(this);
    this.frame ??= requestAnimationFrame(this.step);
  }

  private readonly step = (time: number) => {
    this.frame = undefined;
    const { segment, element } = this;
    if (!segment) return;
    const done = time >= segment.start + segment.duration;
    const target = done ? segment.to : at(segment, time);
    const wanted = target - this.written;
    const before = element.scrollTop;
    element.scrollTop = before + wanted;
    const moved = element.scrollTop - before;
    this.written += moved;
    // At an edge the scroller stops moving; so does the tween.
    if (done || (Math.abs(wanted) >= 1 && Math.abs(moved) < 0.5)) this.stop();
    else this.frame = requestAnimationFrame(this.step);
  };

  stop() {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.frame = undefined;
    this.segment = undefined;
    this.written = 0;
    active.delete(this);
  }
}

const reducedMotion = () =>
  typeof matchMedia === "function" &&
  matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Whether an element between the target and the scroller scrolls this way. */
function innerScroller(
  target: EventTarget | null,
  scroller: HTMLElement,
  delta: number,
) {
  for (
    let node = target instanceof Element ? target : null;
    node && node !== scroller;
    node = node.parentElement
  ) {
    if (!(node instanceof HTMLElement)) continue;
    if (node.scrollHeight <= node.clientHeight) continue;
    const overflow = getComputedStyle(node).overflowY;
    if (overflow !== "auto" && overflow !== "scroll") continue;
    if (
      delta < 0
        ? node.scrollTop > 0
        : node.scrollTop + node.clientHeight < node.scrollHeight - 1
    )
      return true;
  }
  return false;
}

/** The wheel event's vertical movement in pixels. */
const pixels = (event: WheelEvent, scroller: HTMLElement) =>
  event.deltaY *
  (event.deltaMode === WheelEvent.DOM_DELTA_PAGE
    ? scroller.clientHeight
    : event.deltaMode === WheelEvent.DOM_DELTA_LINE
      ? LINE_PX
      : 1);

/**
 * Eases a mouse-wheel event on an eased scroller. Returns whether it did; the
 * event is then canceled. `target` is where the pointer is, when that is not
 * inside the scroller's own DOM (a top-layer popover).
 */
export function easeWheel(
  scroller: HTMLElement,
  event: WheelEvent,
  target: EventTarget | null = event.target,
) {
  const controller = controllers.get(scroller);
  if (
    !controller ||
    kind !== "coarse" ||
    event.defaultPrevented ||
    event.ctrlKey ||
    !event.deltaY ||
    event.deltaX ||
    reducedMotion() ||
    innerScroller(target, scroller, event.deltaY)
  )
    return false;
  event.preventDefault();
  controller.wheel(pixels(event, scroller), performance.now());
  return true;
}

/** Whether a tween is moving this scroller. */
export function wheelEasing(scroller: HTMLElement | null | undefined) {
  const controller = scroller && controllers.get(scroller);
  return !!controller && active.has(controller);
}

/** Stops a scroller's running tween, before another scroll takes over. */
export function stopWheelEasing(scroller: HTMLElement | null | undefined) {
  if (scroller) controllers.get(scroller)?.stop();
}

/**
 * Eases mouse-wheel ticks on a history scroller. A press or key anywhere stops
 * the tween, so scrollbar drags, jumps and keyboard scrolling take over.
 * Returns the cleanup.
 */
export function installWheelEasing(element: HTMLElement) {
  const controller = new Controller(element);
  controllers.set(element, controller);
  const wheel = (event: WheelEvent) => {
    easeWheel(element, event);
  };
  // A non-passive listener makes WebKit wait on this page before scrolling, so
  // it is attached only while the input is a mouse wheel.
  let attached = false;
  const update = () => {
    const wanted = kind === "coarse";
    if (wanted === attached) return;
    attached = wanted;
    if (wanted) element.addEventListener("wheel", wheel, { passive: false });
    else element.removeEventListener("wheel", wheel);
  };
  const stop = () => controller.stop();
  const document = element.ownerDocument;
  update();
  kindListeners.add(update);
  document.addEventListener("pointerdown", stop, true);
  document.addEventListener("keydown", stop, true);
  return () => {
    controller.stop();
    if (controllers.get(element) === controller) controllers.delete(element);
    kindListeners.delete(update);
    element.removeEventListener("wheel", wheel);
    document.removeEventListener("pointerdown", stop, true);
    document.removeEventListener("keydown", stop, true);
  };
}

export function useWheelEasing(scroller: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const element = scroller.current;
    return element ? installWheelEasing(element) : undefined;
  }, [scroller]);
}
