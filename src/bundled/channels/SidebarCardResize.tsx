import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { readView, subscribeView, writeView } from "../../shared/view-state";
import styles from "./Channels.module.css";

const heightsKey = "sidebar:card-heights";
/** Each full card's height from before it went full, for double-click back. */
const restoreKey = "sidebar:card-restore";
/** Rows a card shows until its grip is dragged. */
const DEFAULT_ROWS = 10;
/** The most rows a card shows; the rest wait for View all. */
const MAX_ROWS = 50;
/** The saved height of a card opened full. */
const ALL_ROWS = Number.MAX_SAFE_INTEGER;

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
 * until the grip is dragged, then clip to wherever it is left; full shows up
 * to fifty. The drag follows the pointer exactly, then settles onto the
 * nearest whole row on release; the bottom stop is full. Double-click toggles
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
  const saved = useRef(height);
  // Apply the saved height before paint, and again whenever rows come, go or
  // first get a size (a card opened after starting closed).
  useLayoutEffect(() => {
    saved.current = height;
    if (list.current && !stop.current) clip(list.current, height);
  }, [height]);
  useEffect(() => {
    const rows = list.current;
    if (!rows) return;
    const update = () => {
      setCount(rows.querySelectorAll("[data-card-row]").length);
      if (!stop.current) clip(rows, saved.current);
    };
    update();
    const added = new MutationObserver(update);
    added.observe(rows, { childList: true, subtree: true });
    const sized =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(() => {
            if (!stop.current) clip(rows, saved.current);
          });
    sized?.observe(rows);
    return () => {
      added.disconnect();
      sized?.disconnect();
    };
  }, []);

  return (
    <>
      <div ref={list} className={styles.cardRows}>
        {children}
      </div>
      {height === ALL_ROWS && count > MAX_ROWS && (
        <p className={`${styles.cardMore} text-caption`}>
          View all coming soon
        </p>
      )}
      {/* Only a card with more than one row has anything to hide. */}
      {count > 1 && (
        <hr
          ref={handle}
          className={styles.cardResize}
          aria-label={`Resize ${label}`}
          aria-orientation="horizontal"
          aria-valuenow={height === ALL_ROWS ? undefined : height}
          tabIndex={0}
          onDoubleClick={onToggle}
          onKeyDown={(event) => {
            const rows = list.current;
            if (!rows || event.altKey || event.ctrlKey || event.metaKey) return;
            // Step one whole row from wherever the list ends now.
            const ends = stops(rows);
            const [first, last] = [ends[0], ends.at(-1)];
            const current = rows.offsetHeight;
            if (first === undefined || last === undefined) return;
            if (event.key === "ArrowUp")
              onResize(ends.filter((end) => end < current - 1).at(-1) ?? first);
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
              if ("pointerId" in event && event.pointerId !== pointerId) return;
              stop.current?.();
              // Released, the list glides onto the nearest whole row. Dragged
              // to the bottom, it keeps showing every row as new ones arrive.
              // A click without a drag (half of a double-click) changes nothing.
              if (event.type !== "pointerup" || next === start)
                return clip(rows, height);
              const settled = nearest(rows, next);
              const target = settled >= max ? ALL_ROWS : settled;
              if (target === height) clip(rows, height);
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
            document.documentElement.style.cursor = "ns-resize";
            document.body.style.userSelect = "none";
            surface.style.pointerEvents = "none";
            grip.style.pointerEvents = "auto";
          }}
        />
      )}
    </>
  );
}

/** Clip the list to a saved height: ten rows when unset, fifty when full. */
function clip(list: HTMLElement, height: number | undefined) {
  let limit = height;
  if (height === undefined || height === ALL_ROWS) {
    const rows = height === undefined ? DEFAULT_ROWS : MAX_ROWS;
    const ends = stops(list);
    limit = ends.length >= rows ? ends[rows - 1] : undefined;
  }
  // A hidden card has no layout, so every stop is zero; it clips once shown.
  list.style.maxHeight = limit ? `${limit}px` : "";
}

/** Where the list ends after each of its first fifty rows. */
function stops(list: HTMLElement) {
  const top = list.getBoundingClientRect().top - list.scrollTop;
  const rows = [...list.querySelectorAll<HTMLElement>("[data-card-row]")];
  return rows.slice(0, MAX_ROWS).map((_, index) => {
    const after = rows[index + 1];
    return Math.round(
      after ? after.getBoundingClientRect().top - top : list.scrollHeight,
    );
  });
}

/** The whole-row height closest to a dragged one. */
function nearest(list: HTMLElement, height: number) {
  return stops(list).reduce(
    (best, end) =>
      Math.abs(end - height) < Math.abs(best - height) ? end : best,
    Number.POSITIVE_INFINITY,
  );
}
