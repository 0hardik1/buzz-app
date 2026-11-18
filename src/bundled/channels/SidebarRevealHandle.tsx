import { useEffect, useRef, type PointerEvent } from "react";
import styles from "./SoloWorkspaces.module.css";

/** A row-sized reveal control; the workspace owns preview and durable state. */
export function SidebarRevealHandle({
  label,
  value,
  min,
  max,
  shown,
  onPreview,
  onCommit,
  onCancel,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  shown: number;
  onPreview(value: number): void;
  onCommit(value: number): void;
  onCancel(): void;
}) {
  const drag = useRef<{
    pointer: number;
    y: number;
    value: number;
    rowHeight: number;
    next: number;
  } | null>(null);
  const callbacks = useRef({ onCancel });
  callbacks.current = { onCancel };
  useEffect(() => {
    const cancel = () => {
      if (!drag.current) return;
      drag.current = null;
      callbacks.current.onCancel();
    };
    window.addEventListener("blur", cancel);
    return () => {
      window.removeEventListener("blur", cancel);
      cancel();
    };
  }, []);
  const clamp = (next: number) => Math.min(max, Math.max(min, next));
  const nextValue = (event: PointerEvent) => {
    const active = drag.current;
    return active
      ? clamp(
          active.value +
            Math.round((event.clientY - active.y) / active.rowHeight),
        )
      : value;
  };
  const cancel = () => {
    if (!drag.current) return;
    drag.current = null;
    onCancel();
  };
  return (
    <hr
      data-sidebar-reveal=""
      className={styles.revealHandle}
      tabIndex={0}
      aria-label={label}
      aria-orientation="horizontal"
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={value}
      aria-valuetext={`${shown} of ${max} chats shown`}
      title="Drag to show more or fewer chats · Double-click to reset"
      onDoubleClick={() => onCommit(min)}
      onKeyDown={(event) => {
        if (event.key === "Escape" && drag.current) {
          event.preventDefault();
          event.stopPropagation();
          cancel();
          return;
        }
        const next =
          event.key === "ArrowDown"
            ? value + 1
            : event.key === "ArrowUp"
              ? value - 1
              : event.key === "PageDown"
                ? value + 10
                : event.key === "PageUp"
                  ? value - 10
                  : event.key === "Home"
                    ? min
                    : event.key === "End"
                      ? max
                      : undefined;
        if (next === undefined) return;
        event.preventDefault();
        onCommit(clamp(next));
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        event.stopPropagation();
        const handle = event.currentTarget;
        const row = handle.parentElement?.querySelector<HTMLElement>(
          "[data-solo-menu-id]",
        );
        const rowHeight =
          row?.getBoundingClientRect().height ||
          parseFloat(getComputedStyle(handle).fontSize) * 1.75;
        drag.current = {
          pointer: event.pointerId,
          y: event.clientY,
          value,
          rowHeight,
          next: value,
        };
        handle.focus({ preventScroll: true });
        handle.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const next = nextValue(event);
        if (next === drag.current.next) return;
        drag.current.next = next;
        onPreview(next);
      }}
      onPointerUp={(event) => {
        if (drag.current?.pointer !== event.pointerId) return;
        const next = nextValue(event);
        drag.current = null;
        onCommit(next);
        event.currentTarget.releasePointerCapture(event.pointerId);
      }}
      onPointerCancel={cancel}
      onLostPointerCapture={cancel}
    />
  );
}
