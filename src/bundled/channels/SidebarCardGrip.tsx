import type { DOMAttributes, PointerEvent } from "react";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { GripHorizontalIcon } from "../../shared/design-system/icons";
import styles from "./Channels.module.css";

/** Match the reference grip's one-handle-width proximity ramp without rerenders. */
export const sidebarGripPointerEvents = {
  onPointerMove(event: PointerEvent<HTMLElement>) {
    if (event.pointerType !== "mouse") return;
    for (const grip of event.currentTarget.querySelectorAll<HTMLElement>(
      "[data-sidebar-grip], [data-sidebar-reveal]",
    )) {
      const bounds = grip.getBoundingClientRect();
      const distance = Math.hypot(
        Math.max(bounds.left - event.clientX, 0, event.clientX - bounds.right),
        Math.max(bounds.top - event.clientY, 0, event.clientY - bounds.bottom),
      );
      grip.style.setProperty(
        "--sidebar-grabber-proximity",
        String(Math.max(0, 1 - distance / bounds.width)),
      );
    }
  },
  onPointerLeave(event: PointerEvent<HTMLElement>) {
    for (const grip of event.currentTarget.querySelectorAll<HTMLElement>(
      "[data-sidebar-grip], [data-sidebar-reveal]",
    ))
      grip.style.removeProperty("--sidebar-grabber-proximity");
  },
};

export function SidebarCardGrip({
  title,
  listeners,
  move,
}: {
  title: string;
  listeners?: DOMAttributes<HTMLElement> | undefined;
  move?:
    | { up?: (() => void) | undefined; down?: (() => void) | undefined }
    | undefined;
}) {
  return (
    <span data-sidebar-grip="" className={styles.sectionGrabber}>
      <IconButton
        {...listeners}
        aria-label={`Move ${title} section`}
        aria-keyshortcuts="ArrowUp ArrowDown"
        aria-description="Use the Up and Down arrow keys to move this section."
        icon={
          <GripHorizontalIcon
            size={24}
            fill="currentColor"
            className={`${styles.grabDots} text-subtle`}
          />
        }
        onKeyDown={(event) => {
          if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return;
          event.preventDefault();
          if (event.key === "ArrowUp") move?.up?.();
          else move?.down?.();
        }}
      />
    </span>
  );
}
