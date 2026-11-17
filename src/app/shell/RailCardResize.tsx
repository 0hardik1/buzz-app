import { useRef, useState } from "react";
import styles from "./RailCardResize.module.css";

/** A row-count resize grip: preview while dragging, persist only on release. */
export function RailCardResize({
  title,
  count,
  max,
  onPreview,
  onCommit,
  onCancel,
}: {
  title: string;
  count: number;
  max: number;
  onPreview(count: number): void;
  onCommit(count: number): void;
  onCancel(): void;
}) {
  const drag = useRef<{
    pointer: number;
    y: number;
    count: number;
    step: number;
    next: number;
  } | null>(null);
  const [active, setActive] = useState(false);
  const clamp = (value: number) => Math.max(1, Math.min(max, value));
  const cancel = () => {
    if (!drag.current) return;
    drag.current = null;
    setActive(false);
    onCancel();
  };
  return (
    <div
      className={styles.handle}
      role="slider"
      tabIndex={0}
      aria-label={`${title} visible rows`}
      aria-orientation="vertical"
      aria-valuemin={1}
      aria-valuemax={max}
      aria-valuenow={count}
      aria-valuetext={`${count} rows`}
      data-resizing={active || undefined}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
        event.stopPropagation();
        const rows =
          event.currentTarget.parentElement?.querySelectorAll<HTMLElement>(
            "[data-rail-row]",
          );
        const first = rows?.[0]?.getBoundingClientRect();
        const second = rows?.[1]?.getBoundingClientRect();
        const step = first
          ? second
            ? second.top - first.top
            : first.height
          : 0;
        if (step <= 0) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.currentTarget.focus();
        drag.current = {
          pointer: event.pointerId,
          y: event.clientY,
          count,
          step,
          next: count,
        };
        setActive(true);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        const next = clamp(
          start.count + Math.round((event.clientY - start.y) / start.step),
        );
        if (next !== start.next) {
          start.next = next;
          onPreview(next);
        }
      }}
      onPointerUp={(event) => {
        const start = drag.current;
        if (!start || start.pointer !== event.pointerId) return;
        drag.current = null;
        setActive(false);
        onCommit(start.next);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          cancel();
          return;
        }
        const next =
          event.key === "ArrowDown" || event.key === "ArrowRight"
            ? count + 1
            : event.key === "ArrowUp" || event.key === "ArrowLeft"
              ? count - 1
              : event.key === "Home"
                ? 1
                : event.key === "End"
                  ? max
                  : undefined;
        if (next === undefined) return;
        event.preventDefault();
        event.stopPropagation();
        onCommit(clamp(next));
      }}
    />
  );
}
