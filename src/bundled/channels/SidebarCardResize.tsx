import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { readView, subscribeView, writeView } from "../../shared/view-state";
import styles from "./Channels.module.css";

const heightsKey = "sidebar:card-heights";

function savedHeights(scope: string): Record<string, number> {
  const saved = readView<unknown>(scope, heightsKey, {});
  return saved && typeof saved === "object" && !Array.isArray(saved)
    ? Object.fromEntries(
        Object.entries(saved).filter(
          (entry): entry is [string, number] =>
            Number.isFinite(entry[1]) && entry[1] > 0,
        ),
      )
    : {};
}

/** A card's list height where its grip was left, remembered on this device. */
export function useSidebarCardHeight(scope: string, card: string) {
  const height = useSyncExternalStore(
    (change) => subscribeView(scope, change),
    () => savedHeights(scope)[card],
  );
  const resize = (next: number | undefined) => {
    const { [card]: _, ...rest } = savedHeights(scope);
    writeView(
      scope,
      heightsKey,
      next === undefined ? rest : { ...rest, [card]: next },
    );
  };
  return [height, resize] as const;
}

/**
 * A card's rows and the grip on its bottom edge. The rows clip to whatever
 * height the grip is dragged to. The drag follows the pointer exactly, then
 * settles onto the nearest whole row on release. Rows are the descendants
 * marked `data-card-row`.
 */
export function SidebarCardResize({
  label,
  height,
  onResize,
  children,
}: {
  label: string;
  /** Pixels; undefined shows every row. */
  height: number | undefined;
  /** A new height, or undefined to show every row again. */
  onResize(height: number | undefined): void;
  children: ReactNode;
}) {
  const list = useRef<HTMLDivElement>(null);
  const handle = useRef<HTMLHRElement>(null);
  const stop = useRef<() => void>(undefined);
  useEffect(() => () => stop.current?.(), []);
  // Only a card with more than one row has anything to hide.
  const [resizable, setResizable] = useState(false);
  useEffect(() => {
    const rows = list.current;
    if (!rows) return;
    const update = () =>
      setResizable(rows.querySelectorAll("[data-card-row]").length > 1);
    update();
    const observer = new MutationObserver(update);
    observer.observe(rows, { childList: true, subtree: true });
    return () => observer.disconnect();
  }, []);

  return (
    <>
      <div
        ref={list}
        className={styles.cardRows}
        style={height === undefined ? undefined : { maxHeight: height }}
      >
        {children}
      </div>
      {resizable && (
        <hr
          ref={handle}
          className={styles.cardResize}
          aria-label={`Resize ${label}`}
          aria-orientation="horizontal"
          aria-valuenow={height}
          tabIndex={0}
          onDoubleClick={() => onResize(undefined)}
          onKeyDown={(event) => {
            const rows = list.current;
            if (!rows || event.altKey || event.ctrlKey || event.metaKey) return;
            // Step one whole row from wherever the list ends now.
            const ends = stops(rows);
            const current = rows.offsetHeight;
            const last = ends.at(-1);
            if (event.key === "ArrowUp")
              onResize(
                ends.filter((end) => end < current - 1).at(-1) ?? ends[0],
              );
            else if (event.key === "ArrowDown") {
              const next = ends.find((end) => end > current + 1) ?? last;
              onResize(next === last ? undefined : next);
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
            // Rows sliding under the pointer must not take hover mid-drag.
            const surface = rows.closest("nav") ?? rows;
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
              // Released, the list glides onto the nearest whole row. Showing
              // every row saves no height, so new rows keep showing.
              const settled =
                event.type === "pointerup" ? nearest(rows, next) : height;
              const target = settled === max ? undefined : settled;
              rows.style.maxHeight = target === undefined ? "" : `${target}px`;
              if (target !== height) onResize(target);
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
          }}
        />
      )}
    </>
  );
}

/** Where the list ends after each row, from the first to the last. */
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
function nearest(list: HTMLElement, height: number) {
  return stops(list).reduce(
    (best, end) =>
      Math.abs(end - height) < Math.abs(best - height) ? end : best,
    Number.POSITIVE_INFINITY,
  );
}
