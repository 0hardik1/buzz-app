import { useLayoutEffect, useRef, type ReactNode } from "react";
import { useReducedMotion } from "motion/react";
import styles from "./TeamCardTransition.module.css";

/** The toolbar stays still; only a user-selected view enters from its tab's side. */
export function TeamCardTransition({
  view,
  direction,
  children,
}: {
  view: string;
  direction: number;
  children: ReactNode;
}) {
  const content = useRef<HTMLDivElement>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const node = content.current;
    if (!node || reduced || !direction) return;
    const style = getComputedStyle(node);
    const animation = node.animate(
      [
        { transform: `translateX(${direction * 24}px)`, opacity: 0 },
        { transform: "translateX(0)", opacity: 1 },
      ],
      {
        id: `team-card-${view}`,
        duration:
          Number.parseFloat(style.getPropertyValue("--duration-fast")) || 150,
        easing:
          style.getPropertyValue("--easing-enter").trim() ||
          "cubic-bezier(0.23, 1, 0.32, 1)",
      },
    );
    return () => animation.cancel();
  }, [view, direction, reduced]);
  return (
    <div className={styles.viewport}>
      <div ref={content}>{children}</div>
    </div>
  );
}
