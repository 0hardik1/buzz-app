import { createContext, useLayoutEffect, useRef } from "react";
import type { ThreadPanelProps } from "./ThreadPanel";

export type DetailTab = {
  id: string;
  title: string;
  canonical?: boolean;
  node: HTMLElement;
  close(): void;
};
/** The conversation workspace owns promotion; the reader keeps its live content. */
export const DetailTabContext = createContext<
  ((tab: DetailTab) => () => void) | undefined
>(undefined);

/** Current requests stay with the existing tab owner after a reader moves. */
export const RetainedThreadContext = createContext<
  ReadonlyMap<
    string,
    Pick<
      ThreadPanelProps,
      | "messageId"
      | "active"
      | "navigation"
      | "onRetryNavigation"
      | "onResolvedRoot"
      | "onDifferentThread"
      | "replyRequest"
      | "focusRequest"
      | "revealSelected"
      | "revealRequest"
      | "unreadRequest"
    >
  >
>(new Map());

/** A message renderer can hold its existing virtualized row while a reader is open. */
export const DetailLifetimeContext = createContext<
  (() => () => void) | undefined
>(undefined);

function readingState(node: HTMLElement) {
  return {
    scroll: [node, ...node.querySelectorAll<HTMLElement>("*")]
      .filter((element) => element.scrollTop || element.scrollLeft)
      .map((element) => ({
        element,
        top: element.scrollTop,
        left: element.scrollLeft,
      })),
    media: [...node.querySelectorAll<HTMLMediaElement>("video, audio")].map(
      (element) => ({
        element,
        src: element.currentSrc,
        time: element.currentTime,
        paused: element.paused,
      }),
    ),
  };
}
const detachedState = new WeakMap<
  HTMLElement,
  ReturnType<typeof readingState>
>();

export function DetailTabSlot({
  node,
  onAttached,
  close,
}: {
  node: HTMLElement;
  onAttached?: (() => void) | undefined;
  close?: (() => void) | undefined;
}) {
  const slot = useRef<HTMLDivElement>(null);
  const attached = useRef(onAttached);
  attached.current = onAttached;
  const dismiss = useRef(close);
  dismiss.current = close;
  useLayoutEffect(() => {
    const parent = slot.current;
    if (!parent) return;
    const saved = node.isConnected
      ? readingState(node)
      : (detachedState.get(node) ?? readingState(node));
    const recoveries: (() => void)[] = [];
    let moveFrame: number | undefined;
    // Atomic moves preserve media playback and focused editing in supporting
    // browsers; append remains the fallback for initial attachment/older hosts.
    if (node.isConnected && parent.isConnected && parent.moveBefore)
      parent.moveBefore(node, null);
    else {
      const restoreReady: (() => void)[] = [];
      // WebKit lacks atomic DOM moves and can reload moved media. Restore only
      // this source, after its own metadata handlers finish initializing it.
      for (const { element, src, time, paused } of saved.media) {
        let live = true;
        const restore = () => {
          if (
            !live ||
            !element.isConnected ||
            element.currentSrc !== src ||
            element.readyState < 1
          )
            return;
          if (Math.abs(element.currentTime - time) > 0.01)
            element.currentTime = time;
          if (paused) element.pause();
          else void element.play().catch(() => {});
        };
        const metadata = () => queueMicrotask(restore);
        restoreReady.push(restore);
        element.addEventListener("loadedmetadata", metadata, { once: true });
        recoveries.push(() => {
          live = false;
          element.removeEventListener("loadedmetadata", metadata);
        });
      }
      parent.append(node);
      for (const restore of restoreReady) restore();
      // WebKit can reset time in the media removal steps after the move's
      // synchronous work, without another metadata event. Restore before paint.
      if (restoreReady.length)
        moveFrame = requestAnimationFrame(() => {
          for (const restore of restoreReady) restore();
        });
    }
    for (const { element, top, left } of saved.scroll) {
      element.scrollTop = top;
      element.scrollLeft = left;
    }
    attached.current?.();
    // Retained children have their own React portal ancestry. Listen at their
    // actual parent, after nested editors/menus have handled the event.
    const handleEscape = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape" ||
        event.shiftKey ||
        event.defaultPrevented ||
        event.isComposing ||
        event.keyCode === 229 ||
        !dismiss.current
      )
        return;
      event.stopPropagation();
      dismiss.current();
    };
    parent.addEventListener("keydown", handleEscape);
    return () => {
      parent.removeEventListener("keydown", handleEscape);
      if (moveFrame !== undefined) cancelAnimationFrame(moveFrame);
      for (const release of recoveries) release();
      if (node.parentElement === parent) {
        detachedState.set(node, readingState(node));
        node.remove();
      }
    };
  }, [node]);
  return (
    <div
      ref={slot}
      style={{
        display: "flex",
        flex: 1,
        minHeight: 0,
        containerType: "inline-size",
        containerName: "detail-reader",
        flexDirection: "column",
      }}
    />
  );
}
