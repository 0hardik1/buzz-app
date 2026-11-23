import { animate, motion, useReducedMotion, type Variants } from "motion/react";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import { readView, subscribeView, writeView } from "../../shared/view-state";
import { Tooltip } from "../../shared/design-system/ui/Tooltip";
import { Button } from "../../shared/design-system/ui/Button";
import { hasUnmutedUnread, waitsOnYou } from "./conversation-rows";
import { sidebarResetMs } from "./sidebar-sections";
import styles from "./Channels.module.css";

/** Set once someone drags or double-clicks any grip on this device. */
const learnedScope = "device";
const learnedKey = "sidebar:grip-learned";
const learn = () => writeView(learnedScope, learnedKey, true);
const reopenDragPx = 4;
const gripSpring = { type: "spring", stiffness: 380, damping: 20 } as const;
const gripWidths: Variants = {
  resting: { scaleX: 40 / 56 },
  highlighted: { scaleX: 1 },
  bouncing: {
    scaleX: [0.8, 1],
    transition: {
      duration: 0.65,
      ease: (progress) => (1 - Math.cos(Math.PI * progress)) / 2,
      repeat: Infinity,
      repeatType: "reverse",
    },
  },
};
export const sidebarHeightSpring = {
  type: "spring",
  stiffness: 360,
  damping: 40,
} as const;

/** The filter owns the default height. The grip adjusts the visible row count
 * for this mounted card without changing the filter. */
export function SidebarCardResize({
  label,
  controls,
  excludedRows,
  excludedCount,
  open = true,
  onMinimize,
  onExpand,
  renderBody,
  children,
}: {
  label: string;
  controls?: string;
  excludedRows?: (() => ReactNode) | undefined;
  excludedCount: number;
  open?: boolean;
  onMinimize?: (() => void) | undefined;
  onExpand?: (() => void) | undefined;
  renderBody?: (content: ReactNode) => ReactNode;
  children: ReactNode;
}) {
  const [baseCount, setBaseCount] = useState(0);
  const [rowOffset, setRowOffset] = useState(0);
  const [dragging, setDragging] = useState(false);
  const canContract = onMinimize !== undefined;
  const minOffset = canContract ? -baseCount : 0;
  const minAdjustment = Math.min(0, minOffset + 1);
  const offset = Math.max(minAdjustment, Math.min(rowOffset, excludedCount));
  const resizable = minOffset < 0 || excludedCount > 0;
  const showGrip = open ? resizable : !!onExpand;
  const reducedMotion = useReducedMotion();
  const list = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLDivElement>(null);
  const stop = useRef<() => void>(undefined);
  const spring = useRef<ReturnType<typeof animate>>(undefined);
  const fromHeight = useRef<number>(undefined);
  const [closing, setClosing] = useState(false);
  const resize = useCallback(
    (next: number) => {
      if (
        !reducedMotion &&
        list.current &&
        !list.current.closest("[hidden]") &&
        Math.max(minAdjustment, Math.min(next, excludedCount)) !== offset
      ) {
        fromHeight.current = list.current.getBoundingClientRect().height;
        setClosing(next <= 0 && offset > 0);
      }
      setRowOffset(next);
    },
    [excludedCount, minAdjustment, offset, reducedMotion],
  );
  const settle = (next: number) => {
    // With no matches, zero is already the normal filtered height.
    if (minOffset < 0 && next === minOffset) onMinimize?.();
    else resize(next);
  };
  const toggle = () => {
    if (!open) onExpand?.();
    else if (offset < 0 || (excludedCount > 0 && offset === excludedCount))
      resize(0);
    else settle(excludedCount > 0 ? Infinity : minOffset);
  };
  useEffect(() => {
    const rows = list.current;
    const grip = handle.current;
    const body = rows?.parentElement;
    if (!open || offset === 0 || dragging || !rows || !body || !grip) return;
    let timer: number;
    const expire = () => {
      const focused = document.activeElement;
      if (
        focused &&
        rows.contains(focused) &&
        focused.closest("[data-card-excluded]")
      )
        grip.focus({ preventScroll: true });
      resize(0);
    };
    const restart = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(expire, sidebarResetMs);
    };
    const activity = [
      "pointermove",
      "pointerdown",
      "keydown",
      "wheel",
      "focusin",
    ];
    restart();
    for (const element of [body, grip])
      for (const event of activity) element.addEventListener(event, restart);
    return () => {
      window.clearTimeout(timer);
      for (const element of [body, grip])
        for (const event of activity)
          element.removeEventListener(event, restart);
    };
  }, [open, offset, dragging, resize]);
  useEffect(
    () => () => {
      stop.current?.();
      spring.current?.stop();
    },
    [],
  );
  // Conversations past the edge that wait on you, and the lowest one's row.
  const [waiting, setWaiting] = useState<Waiting>(none);
  const apply = useCallback((rows: HTMLElement, adjustment: number) => {
    const extras = rows.querySelector<HTMLElement>("[data-card-excluded]");
    const all = cardRows(rows);
    const base = all.length - (extras ? cardRows(extras).length : 0);
    setBaseCount(base);
    const shown = Math.max(0, base + adjustment);
    if (shown >= all.length || !rows.closest("[hidden]")) {
      const focused = document.activeElement;
      if (focused && all.slice(shown).some((row) => row.contains(focused)))
        handle.current?.focus({ preventScroll: true });
      clip(rows, all, shown);
    }
    const next = extras && adjustment > 0 ? waitingPastEdge(extras) : none;
    setWaiting((previous) =>
      previous.count === next.count && previous.lowest === next.lowest
        ? previous
        : next,
    );
  }, []);
  useEffect(() => {
    if (open) return;
    stop.current?.();
    spring.current?.stop();
    spring.current = undefined;
    fromHeight.current = undefined;
    setDragging(false);
    setClosing(false);
    setRowOffset(0);
    if (list.current) apply(list.current, 0);
  }, [open, apply]);
  const current = useRef(offset);
  // The hint explains the grip until it has been used once.
  const learned = useSyncExternalStore(
    (change) => subscribeView(learnedScope, change),
    () => readView<unknown>(learnedScope, learnedKey, false) === true,
  );
  useLayoutEffect(() => {
    current.current = offset;
    if (!showGrip && stop.current) {
      stop.current();
      setDragging(false);
    }
    const rows = list.current;
    if (!rows || (dragging && showGrip)) return;
    const from = fromHeight.current;
    fromHeight.current = undefined;
    if (from === undefined && spring.current && !reducedMotion && resizable)
      return;
    spring.current?.stop();
    spring.current = undefined;
    apply(rows, offset);
    if (from === undefined || reducedMotion || !resizable) {
      if (closing) setClosing(false);
      return;
    }
    const to = rows.getBoundingClientRect().height;
    rows.style.maxHeight = `${from}px`;
    spring.current = animate(
      rows,
      { maxHeight: `${to}px` },
      {
        ...sidebarHeightSpring,
        onComplete: () => {
          spring.current = undefined;
          apply(rows, current.current);
          setClosing(false);
        },
      },
    );
  }, [offset, dragging, closing, resizable, showGrip, reducedMotion, apply]);
  useEffect(() => {
    const rows = list.current;
    if (!rows || (!canContract && excludedCount === 0)) return;
    const update = () => {
      if (!stop.current && !spring.current) apply(rows, current.current);
    };
    update();
    const added = new MutationObserver(update);
    // Unread markers come and go as rows change, so the badge stays current.
    added.observe(rows, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [
        "data-channel-unread",
        "data-channel-muted",
        "data-channel-waiting",
      ],
    });
    const sized =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (!stop.current && !spring.current) apply(rows, current.current);
          });
    sized?.observe(rows);
    return () => {
      added.disconnect();
      sized?.disconnect();
    };
  }, [apply, canContract, excludedCount]);

  const body = (
    <div className={styles.cardBody} data-card-body="">
      <div ref={list} className={styles.cardRows} data-card-rows="">
        {children}
        {(offset > 0 || (open && dragging) || closing) && excludedCount > 0 && (
          <div data-card-excluded="">{excludedRows?.()}</div>
        )}
      </div>
      {waiting.count > 0 && (
        <div className={styles.cardWaiting} data-card-waiting="">
          <Button
            variant="prominent"
            size="xs"
            shape="capsule"
            type="button"
            aria-label={`Show ${waiting.count} unread ${waiting.count === 1 ? "conversation" : "conversations"} below in ${label}`}
            onClick={(event) => {
              resize(waiting.lowest + 1);
              // From the keyboard, keep focus on the card as the badge goes.
              if (event.detail === 0) handle.current?.focus();
            }}
          >
            {waiting.count} unread
          </Button>
        </div>
      )}
    </div>
  );
  const visibleCount = open ? baseCount + offset : 0;
  return (
    <>
      {renderBody ? renderBody(body) : body}
      {showGrip && (
        <Tooltip
          side="bottom"
          closeOnClick={false}
          {...(learned && { open: false })}
          content={
            !open
              ? "Drag down or double-click to reopen"
              : offset < 0 || (excludedCount > 0 && offset === excludedCount)
                ? "Drag to resize · Double-click to restore filtered rows"
                : excludedCount > 0
                  ? "Drag to resize · Double-click to show all"
                  : "Drag up to show fewer rows or double-click to minimize"
          }
        >
          <motion.div
            ref={handle}
            role="separator"
            className={styles.cardResize}
            data-pulsing={
              (open && offset !== 0 && !dragging && !reducedMotion) || undefined
            }
            initial={false}
            animate={
              dragging || (open && offset !== 0 && reducedMotion)
                ? "highlighted"
                : open && offset !== 0
                  ? "bouncing"
                  : "resting"
            }
            {...((!open || offset === 0) && {
              whileHover: "highlighted",
              whileFocus: "highlighted",
            })}
            aria-label={`Resize ${label}`}
            aria-controls={controls}
            aria-orientation="horizontal"
            aria-valuemin={baseCount + minOffset}
            aria-valuemax={baseCount + excludedCount}
            aria-valuenow={visibleCount}
            aria-valuetext={
              open
                ? `${visibleCount} of ${baseCount + excludedCount} rows`
                : "Minimized"
            }
            aria-keyshortcuts="Enter"
            tabIndex={0}
            onDoubleClick={() => {
              learn();
              toggle();
            }}
            onKeyDown={(event) => {
              if (event.altKey || event.ctrlKey || event.metaKey) return;
              if (event.key === "Enter") {
                learn();
                toggle();
              } else if (event.key === "ArrowUp") {
                if (open) settle(Math.max(minOffset, offset - 1));
              } else if (event.key === "ArrowDown") {
                if (open) resize(Math.min(excludedCount, offset + 1));
                else onExpand?.();
              } else return;
              event.preventDefault();
            }}
            onPointerDown={(event) => {
              const rows = list.current;
              if (event.button !== 0 || stop.current || !rows) return;
              event.preventDefault();
              const { pointerId, clientY: startY } = event;
              const start = open ? rows.offsetHeight : 0;
              spring.current?.stop();
              spring.current = undefined;
              // Measure the real rows only when the grip is used. A filtered
              // card at rest does not mount excluded conversations.
              flushSync(() => {
                setClosing(false);
                setDragging(true);
              });
              let ends: number[] = [];
              if (open) {
                const all = cardRows(rows);
                clip(rows, all, baseCount + offset);
                ends = stops(rows, all).slice(baseCount + minOffset);
              }
              const [min = start] = ends;
              const max = ends.at(-1) ?? (open ? start : Infinity);
              // Rows sliding under the pointer must not take hover mid-drag. The
              // grip stays hit-testable, so a double-click still lands on it.
              const surface = rows.closest("nav") ?? rows;
              const grip = event.currentTarget;
              let next = start;
              let frame: number | undefined;
              // Preview on the element; the row count changes on release.
              const move = (event: PointerEvent) => {
                if (event.pointerId !== pointerId) return;
                event.preventDefault();
                next = Math.min(
                  max,
                  Math.max(min, start + event.clientY - startY),
                );
                if (!open) return;
                frame ??= requestAnimationFrame(() => {
                  frame = undefined;
                  rows.style.maxHeight = `${next}px`;
                });
              };
              const finish = (event: Event) => {
                if ("pointerId" in event && event.pointerId !== pointerId)
                  return;
                stop.current?.();
                setDragging(false);
                if (!open) {
                  if (event.type === "pointerup" && next >= reopenDragPx) {
                    learn();
                    onExpand?.();
                  }
                  return;
                }
                if (event.type !== "pointerup" || next === start) {
                  apply(rows, current.current);
                  return;
                }
                learn();
                const settled = ends.indexOf(nearest(ends, next)) + minOffset;
                settle(
                  excludedCount > 0 && settled === excludedCount
                    ? Infinity
                    : settled,
                );
              };
              stop.current = () => {
                stop.current = undefined;
                if (frame !== undefined) cancelAnimationFrame(frame);
                window.removeEventListener("pointermove", move);
                window.removeEventListener("pointerup", finish);
                window.removeEventListener("pointercancel", finish);
                window.removeEventListener("blur", finish);
                handle.current?.removeAttribute("data-resizing");
                rows.removeAttribute("data-resizing");
                document.documentElement.style.removeProperty("cursor");
                document.body.style.removeProperty("user-select");
                surface.style.removeProperty("pointer-events");
                grip.style.removeProperty("pointer-events");
              };
              window.addEventListener("pointermove", move);
              window.addEventListener("pointerup", finish);
              window.addEventListener("pointercancel", finish);
              window.addEventListener("blur", finish);
              event.currentTarget.setAttribute("data-resizing", "");
              rows.setAttribute("data-resizing", "");
              if (open) rows.style.maxHeight = `${start}px`;
              document.documentElement.style.cursor = "grabbing";
              document.body.style.userSelect = "none";
              surface.style.pointerEvents = "none";
              grip.style.pointerEvents = "auto";
            }}
          >
            <motion.span
              aria-hidden="true"
              className={styles.cardGrip}
              variants={gripWidths}
              transition={reducedMotion ? { duration: 0 } : gripSpring}
            />
          </motion.div>
        </Tooltip>
      )}
    </>
  );
}

/** Inert rows stay out of the tab order and sidebar keyboard navigation. */
function clip(list: HTMLElement, rows: readonly HTMLElement[], shown: number) {
  const firstClipped = rows[shown];
  list.style.maxHeight = firstClipped
    ? `${Math.round(firstClipped.getBoundingClientRect().top - list.getBoundingClientRect().top + list.scrollTop)}px`
    : "";
  rows.forEach((row, index) => {
    row.inert = index >= shown;
    row.toggleAttribute("data-card-clipped", row.inert);
  });
}

function cardRows(list: HTMLElement) {
  return [
    ...list.querySelectorAll<HTMLElement>(
      '[data-card-row]:not([aria-hidden="true"])',
    ),
  ];
}

type Waiting = { count: number; lowest: number };
const none: Waiting = { count: 0, lowest: -1 };

/**
 * Conversations past the card's edge whose unread waits on you, counted once
 * each, and the index of the lowest one's row.
 */
function waitingPastEdge(list: HTMLElement): Waiting {
  const seen = new Set<string>();
  let lowest = -1;
  cardRows(list).forEach((row, index) => {
    if (!row.hasAttribute("data-card-clipped")) return;
    const button = row.querySelector<HTMLElement>(
      "button[data-channel-id], button[data-solo-channel-id]",
    );
    if (!button || !hasUnmutedUnread(button) || !waitsOnYou(button)) return;
    seen.add(button.dataset.channelId ?? button.dataset.soloChannelId ?? "");
    lowest = index;
  });
  return seen.size ? { count: seen.size, lowest } : none;
}

/** Pixel stops at each row boundary and at the full list height. */
function stops(list: HTMLElement, rows: readonly HTMLElement[]) {
  const top = list.getBoundingClientRect().top - list.scrollTop;
  return [
    ...rows.map((row) => Math.round(row.getBoundingClientRect().top - top)),
    list.scrollHeight,
  ];
}

/** The whole-row height closest to a dragged one. */
function nearest(ends: readonly number[], height: number) {
  return ends.reduce(
    (best, end) =>
      Math.abs(end - height) < Math.abs(best - height) ? end : best,
    Number.POSITIVE_INFINITY,
  );
}
