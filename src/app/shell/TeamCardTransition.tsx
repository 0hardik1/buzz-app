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
  const running = useRef<Animation | null>(null);
  useLayoutEffect(() => () => running.current?.cancel(), []);
  useLayoutEffect(() => {
    const node = content.current;
    if (!node) return;
    if (reduced || !direction) {
      running.current?.cancel();
      running.current = null;
      return;
    }
    const style = getComputedStyle(node);
    const interrupted =
      running.current?.playState === "running" ||
      running.current?.playState === "paused";
    const from = interrupted
      ? {
          transform: style.transform,
          opacity: style.opacity,
          filter: style.filter,
        }
      : {
          transform: `translateX(calc(${direction} * var(--space-6)))`,
          opacity: "0.5",
          filter: "blur(var(--space-half))",
        };
    running.current?.cancel();
    const animation = node.animate(
      [from, { transform: "translateX(0)", opacity: 1, filter: "blur(0px)" }],
      {
        id: `team-card-${view}`,
        duration:
          Number.parseFloat(style.getPropertyValue("--duration-panel-enter")) ||
          180,
        easing:
          style.getPropertyValue("--easing-enter").trim() ||
          "cubic-bezier(0.23, 1, 0.32, 1)",
      },
    );
    running.current = animation;
  }, [view, direction, reduced]);
  return (
    <div className={styles.viewport}>
      <div ref={content}>{children}</div>
    </div>
  );
}
