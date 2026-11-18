import {
  useCallback,
  useLayoutEffect,
  useState,
  type ReactNode,
  type RefObject,
} from "react";
import styles from "./SidebarFrame.module.css";
import { useScrollEdges } from "../../shared/design-system/ui/useScrollEdges";

type Props = {
  children: ReactNode;
  navigation?: {
    label: string;
    ref?: RefObject<HTMLElement | null>;
  };
  contentRef?: RefObject<HTMLDivElement | null>;
  overlay?: ReactNode;
};

export function SidebarList({
  children,
  navigation,
  contentRef,
  overlay,
}: Props) {
  const edges = useScrollEdges("block");
  const navigationRef = navigation?.ref;
  const [scroller, setScroller] = useState<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!scroller) return;
    const update = () => {
      for (const section of scroller.querySelectorAll(
        "[data-sticky-heading]",
      )) {
        const heading = section.querySelector(":scope > [data-disclosure]");
        if (!heading) continue;
        // A sticky heading only moves away from its section's natural top once
        // that section's content has started passing underneath it.
        const displaced =
          heading.getBoundingClientRect().top -
          section.getBoundingClientRect().top;
        section.toggleAttribute("data-heading-stuck", displaced > 1);
      }
    };
    update();
    scroller.addEventListener("scroll", update, { passive: true });
    const content = new MutationObserver(update);
    content.observe(scroller, { childList: true, subtree: true });
    const size =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    for (const box of [scroller, ...scroller.children]) size?.observe(box);
    return () => {
      scroller.removeEventListener("scroll", update);
      content.disconnect();
      size?.disconnect();
    };
  }, [scroller]);
  // Stable, so React does not detach and reattach the list on every render.
  const listRef = useCallback(
    (node: HTMLElement | null) => {
      edges(node);
      setScroller(node);
      if (navigationRef) navigationRef.current = node;
    },
    [edges, navigationRef],
  );
  const content = (
    <div
      data-sidebar-list-content=""
      ref={contentRef}
      className={styles.channelListContent}
    >
      {children}
    </div>
  );
  return (
    <div className={styles.channelListFrame}>
      {navigation ? (
        <nav
          ref={listRef}
          className={styles.channelList}
          data-scroll-fade="scrolled"
          aria-label={navigation.label}
        >
          {content}
        </nav>
      ) : (
        <div
          ref={listRef}
          className={styles.channelList}
          data-scroll-fade="scrolled"
        >
          {content}
        </div>
      )}
      {overlay}
    </div>
  );
}
