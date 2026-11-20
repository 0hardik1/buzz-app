import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { readView, subscribeView, writeView } from "../../shared/view-state";
import { Tooltip } from "../../shared/design-system/ui/Tooltip";
import { Button } from "../../shared/design-system/ui/Button";
import { ArrowDownIcon } from "../../shared/design-system/icons/index";
import { hasUnmutedUnread, waitsOnYou } from "./conversation-rows";
import styles from "./Channels.module.css";

const heightsKey = "sidebar:card-heights";
/** Each full card's height from before it went full, for double-click back. */
const restoreKey = "sidebar:card-restore";
/** Rows a card shows until its grip is dragged. */
const DEFAULT_ROWS = 10;
/** The saved height of a card opened full. */
const ALL_ROWS = Number.MAX_SAFE_INTEGER;
/** Set once someone drags or double-clicks any grip on this device. */
const learnedScope = "device";
const learnedKey = "sidebar:grip-learned";
const learn = () => writeView(learnedScope, learnedKey, true);

function savedHeights(scope: string, key: string): Record<string, number> {
  const saved = readView<unknown>(scope, key, {});
  return saved && typeof saved === "object" && !Array.isArray(saved)
    ? Object.fromEntries(
        Object.entries(saved).filter(
          (entry): entry is [string, number] =>
            Number.isFinite(entry[1]) && entry[1] > 0,
        ),
      )
    : {};
}

/**
 * A card's height, remembered on this device: where its grip was left, or
 * full. Dragging sets it. Toggling switches between full and the height from
 * before full, which is the first ten rows when there was none.
 */
export function useSidebarCardHeight(scope: string, card: string) {
  const height = useSyncExternalStore(
    (change) => subscribeView(scope, change),
    () => savedHeights(scope, heightsKey)[card],
  );
  const save = (key: string, next: number | undefined) => {
    const { [card]: _, ...rest } = savedHeights(scope, key);
    writeView(
      scope,
      key,
      next === undefined ? rest : { ...rest, [card]: next },
    );
  };
  const resize = (next: number | undefined) => {
    save(restoreKey, undefined);
    save(heightsKey, next);
  };
  const toggle = () => {
    const back = savedHeights(scope, restoreKey)[card];
    save(restoreKey, height === ALL_ROWS ? undefined : height);
    save(heightsKey, height === ALL_ROWS ? back : ALL_ROWS);
  };
  return [height, resize, toggle] as const;
}

/**
 * A card's rows and the grip on its bottom edge. The rows show the first ten
 * until the grip is dragged, then clip to wherever it is left; full shows
 * every row. The drag follows the pointer exactly, then settles onto the
 * nearest whole row on release; the bottom stop is full. Double-click or Enter toggles
 * full. Rows are the descendants marked `data-card-row`.
 */
export function SidebarCardResize({
  label,
  height,
  onResize,
  onToggle,
  children,
}: {
  label: string;
  /** Pixels, ALL_ROWS for full, or undefined for the first ten. */
  height: number | undefined;
  /** A height the grip settled on, ALL_ROWS at its bottom stop. */
  onResize(height: number): void;
  /** Switch between full and the height from before full. */
  onToggle(): void;
  children: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLHRElement>(null);
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);
  const [count, setCount] = useState(0);
  // Rows the card shows now, for assistive technology.
  const [shown, setShown] = useState(0);
  // Conversations past the edge that wait on you, and the lowest one's row.
  const [waiting, setWaiting] = useState<Waiting>(none);
  const apply = useCallback((rows: HTMLElement, height: number | undefined) => {
    setShown(clip(rows, height));
    const next = waitingPastEdge(rows);
    setWaiting((previous) =>
      previous.count === next.count && previous.lowest === next.lowest
        ? previous
        : next,
    );
  }, []);
  // The badge's width, so the last row that shows can make room beside it.
  const badge = useCallback((node: HTMLSpanElement | null) => {
    if (node)
      list.current?.style.setProperty(
        "--card-badge-width",
        `${node.offsetWidth}px`,
      );
  }, []);
  const saved = useRef(height);
  // The hint explains the grip until it has been used once.
  const learned = useSyncExternalStore(
    (change) => subscribeView(learnedScope, change),
    () => readView<unknown>(learnedScope, learnedKey, false) === true,
  );
  // Apply the saved height before paint, and again whenever rows come, go or
  // first get a size (a card opened after starting closed).
  useLayoutEffect(() => {
    saved.current = height;
    if (list.current && !stop.current) apply(list.current, height);
  }, [height, apply]);
  useEffect(() => {
    const rows = list.current;
    if (!rows) return;
    const update = () => {
      setCount(rows.querySelectorAll("[data-card-row]").length);
      if (!stop.current) apply(rows, saved.current);
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
        "data-channel-activity",
        "data-channel-type",
        "data-priority",
      ],
    });
    const sized =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (!stop.current) apply(rows, saved.current);
          });
    sized?.observe(rows);
    return () => {
      added.disconnect();
      sized?.disconnect();
    };
  }, [apply]);

  return (
    <>
      <div className={styles.cardBody}>
        <div ref={list} className={styles.cardRows} data-card-rows="">
          {children}
        </div>
        {waiting.count > 0 && (
          <span ref={badge} className={styles.cardWaiting}>
            <Button
              variant="prominent"
              size="xs"
              shape="capsule"
              type="button"
              aria-label={`Show ${waiting.count} unread ${waiting.count === 1 ? "conversation" : "conversations"} below in ${label}`}
              onClick={(event) => {
                const rows = list.current;
                if (!rows) return;
                // Open just far enough to show the lowest one, like a drag.
                const ends = stops(rows);
                const end = ends[waiting.lowest];
                if (end === undefined) return;
                onResize(waiting.lowest === ends.length - 1 ? ALL_ROWS : end);
                // From the keyboard, keep focus on the card as the badge goes.
                if (event.detail === 0) handle.current?.focus();
              }}
            >
              <ArrowDownIcon aria-hidden="true" />
              {waiting.count}
            </Button>
          </span>
        )}
      </div>
      {/* Only a card with more than one row has anything to hide. */}
      {count > 1 && (
        <Tooltip
          side="bottom"
          closeOnClick={false}
          {...(learned && { open: false })}
          content={
            height === ALL_ROWS
              ? "Drag to resize · Double-click to show less"
              : "Drag to resize · Double-click to show all"
          }
        >
          <hr
            ref={handle}
            className={styles.cardResize}
            aria-label={`Resize ${label}`}
            aria-orientation="horizontal"
            aria-valuemin={1}
            aria-valuemax={count}
            aria-valuenow={shown}
            aria-valuetext={`${shown} of ${count} rows`}
            // Rows past the edge keep the handle showing, so the card reads
            // as having more.
            data-more={shown < count ? "" : undefined}
            aria-keyshortcuts="Enter"
            tabIndex={0}
            onDoubleClick={() => {
              learn();
              onToggle();
            }}
            onKeyDown={(event) => {
              const rows = list.current;
              if (!rows || event.altKey || event.ctrlKey || event.metaKey)
                return;
              // Step one whole row from wherever the list ends now.
              const ends = stops(rows);
              const [first, last] = [ends[0], ends.at(-1)];
              const current = rows.offsetHeight;
              if (first === undefined || last === undefined) return;
              if (event.key === "Enter") {
                learn();
                onToggle();
              } else if (event.key === "ArrowUp")
                onResize(
                  ends.filter((end) => end < current - 1).at(-1) ?? first,
                );
              else if (event.key === "ArrowDown") {
                const next = ends.find((end) => end > current + 1) ?? last;
                onResize(next === last ? ALL_ROWS : next);
              } else return;
              event.preventDefault();
            }}
            onPointerDown={(event) => {
              const rows = list.current;
              if (event.button !== 0 || stop.current || !rows) return;
              event.preventDefault();
              const { pointerId, clientY: startY } = event;
              const start = rows.offsetHeight;
              const ends = stops(rows);
              const [min = 0] = ends;
              const max = ends.at(-1) ?? start;
              // Rows sliding under the pointer must not take hover mid-drag. The
              // grip stays hit-testable, so a double-click still lands on it.
              const surface = rows.closest("nav") ?? rows;
              const grip = event.currentTarget;
              let next = start;
              let frame: number | undefined;
              // Preview on the element; the saved height changes on release.
              const move = (event: PointerEvent) => {
                if (event.pointerId !== pointerId) return;
                event.preventDefault();
                next = Math.min(
                  max,
                  Math.max(min, start + event.clientY - startY),
                );
                frame ??= requestAnimationFrame(() => {
                  frame = undefined;
                  rows.style.maxHeight = `${next}px`;
                });
              };
              const finish = (event: Event) => {
                if ("pointerId" in event && event.pointerId !== pointerId)
                  return;
                stop.current?.();
                // Released, the list glides onto the nearest whole row. Dragged
                // to the bottom, it keeps showing every row as new ones arrive.
                // A click without a drag (half of a double-click) changes nothing.
                if (event.type !== "pointerup" || next === start)
                  return apply(rows, height);
                learn();
                const settled = nearest(stops(rows), next);
                const target = settled >= max ? ALL_ROWS : settled;
                if (target === height) apply(rows, height);
                else onResize(target);
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
              rows.style.maxHeight = `${start}px`;
              document.documentElement.style.cursor = "grabbing";
              document.body.style.userSelect = "none";
              surface.style.pointerEvents = "none";
              grip.style.pointerEvents = "auto";
            }}
          />
        </Tooltip>
      )}
    </>
  );
}

/**
 * Clip the list to a saved height: ten rows when unset, none when full. A
 * saved height lands on a whole row even after text size changes. Rows past
 * the clip are inert, so focus and the keyboard skip what the card hides.
 * Returns how many rows show.
 */
function clip(list: HTMLElement, height: number | undefined): number {
  const ends = stops(list);
  const full = ends.at(-1) ?? 0;
  // A hidden card has no layout, so every stop is zero: keep the saved
  // height as it is until the card is shown and can be measured.
  if (!full) {
    list.style.maxHeight =
      height !== undefined && height !== ALL_ROWS ? `${height}px` : "";
    return ends.length;
  }
  const limit =
    height === ALL_ROWS
      ? undefined
      : height === undefined
        ? ends[DEFAULT_ROWS - 1]
        : nearest(ends, height);
  const clipped = limit !== undefined && limit < full;
  list.style.maxHeight = clipped ? `${limit}px` : "";
  let shown = 0;
  list
    .querySelectorAll<HTMLElement>("[data-card-row]")
    .forEach((row, index) => {
      const hidden = clipped && (ends[index - 1] ?? 0) >= limit;
      // Only undo inertness this clip gave: a row leaving the list keeps its own.
      if (hidden) row.inert = true;
      else if (row.hasAttribute("data-card-clipped")) row.inert = false;
      row.toggleAttribute("data-card-clipped", hidden);
      if (!hidden) shown++;
    });
  return shown;
}

type Waiting = { count: number; lowest: number };
const none: Waiting = { count: 0, lowest: -1 };

/**
 * Conversations past the card's edge whose unread waits on you, counted once
 * each, and the index of the lowest one's row. Marks the last row that
 * shows when there are any.
 */
function waitingPastEdge(list: HTMLElement): Waiting {
  const seen = new Set<string>();
  let lowest = -1;
  list
    .querySelectorAll<HTMLElement>("[data-card-row]")
    .forEach((row, index) => {
      if (!row.hasAttribute("data-card-clipped")) return;
      const button = row.querySelector<HTMLElement>(
        "button[data-channel-id], button[data-solo-channel-id]",
      );
      if (!button || !hasUnmutedUnread(button) || !waitsOnYou(button)) return;
      seen.add(button.dataset.channelId ?? button.dataset.soloChannelId ?? "");
      lowest = index;
    });
  // The last row that shows narrows to make room for the badge.
  let last: Element | undefined;
  for (const row of list.querySelectorAll("[data-card-row]")) {
    row.removeAttribute("data-card-beside-badge");
    if (!row.hasAttribute("data-card-clipped")) last = row;
  }
  if (seen.size) last?.setAttribute("data-card-beside-badge", "");
  return seen.size ? { count: seen.size, lowest } : none;
}

/** Where the list ends after each of its rows. */
function stops(list: HTMLElement) {
  const top = list.getBoundingClientRect().top - list.scrollTop;
  const rows = [...list.querySelectorAll<HTMLElement>("[data-card-row]")];
  return rows.map((_, index) => {
    const after = rows[index + 1];
    return Math.round(
      after ? after.getBoundingClientRect().top - top : list.scrollHeight,
    );
  });
}

/** The whole-row height closest to a dragged one. */
function nearest(ends: readonly number[], height: number) {
  return ends.reduce(
    (best, end) =>
      Math.abs(end - height) < Math.abs(best - height) ? end : best,
    Number.POSITIVE_INFINITY,
  );
}
