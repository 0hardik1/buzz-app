import { createContext, useContext, type RefObject } from "react";

/** Only a completed pointer drop opts the next card arrangement into motion. */
export const SidebarCardReorder = createContext<RefObject<boolean> | null>(
  null,
);

export function useSidebarCardMotion() {
  const drop = useContext(SidebarCardReorder);
  return {
    layout: "position" as const,
    initial: false as const,
    layoutDependency: drop?.current ?? false,
    transition: {
      layout: drop?.current
        ? { type: "spring" as const, duration: 0.28, bounce: 0.15 }
        : { duration: 0 },
    },
    onKeyDownCapture: () => {
      if (drop) drop.current = false;
    },
    onLayoutAnimationComplete: () => {
      if (drop) drop.current = false;
    },
  };
}
