import {
  useCallback,
  useEffect,
  useEffectEvent,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { WorkspaceAsideWidth } from "../../features/conversation/contracts";
import {
  ReadingCovers,
  readingPositioned,
} from "../../features/messages/use-reading";
import styles from "./Channels.module.css";

const DEFAULT_WIDTH = 320;
/** The narrowest reader a docked aside leaves beside it. */
const MIN_READER = 600;

/**
 * Where an aside goes in a row this wide, and how wide it is. The only place
 * that decides the aside's placement, from the host's own row width; a later
 * width form adds its rule here.
 */
export function asideLayout(
  rowWidth: number,
  width: WorkspaceAsideWidth = DEFAULT_WIDTH,
) {
  const docked = rowWidth - width >= MIN_READER;
  return { docked, width: docked ? width : Math.min(width, rowWidth) };
}

type Props = {
  aside: ReactNode;
  width: WorkspaceAsideWidth | undefined;
  open: boolean | undefined;
  onOpenChange: ((open: boolean) => void) | undefined;
  children: ReactNode;
};

/**
 * A workspace's reader and its page's aside: a column beside the reader, or,
 * when the reader would get too narrow, an overlay over the history's end edge
 * while open. Rows under the overlay aren't read.
 */
export function WorkspaceRow({
  aside,
  width,
  open: controlled,
  onOpenChange,
  children,
}: Props) {
  const row = useRef<HTMLDivElement>(null);
  const reader = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [rowWidth, setRowWidth] = useState<number>();
  const [inner, setInner] = useState(true);
  const open = controlled ?? inner;
  const change = useEffectEvent((next: boolean) => {
    setInner(next);
    onOpenChange?.(next);
  });
  const layout =
    rowWidth === undefined ? undefined : asideLayout(rowWidth, width);
  const docked = layout?.docked ?? true;
  const floating = aside != null && !docked && open;

  useLayoutEffect(() => {
    const element = row.current;
    if (!element) return;
    const measure = () => setRowWidth(element.getBoundingClientRect().width);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Narrowing to a floating aside closes it; widening again restores the
  // docked state. An aside that first measures narrow narrows from docked.
  const dockedOpen = useRef(open);
  const transition = useEffectEvent((docked: boolean) => {
    if (!docked) {
      dockedOpen.current = open;
      if (open) change(false);
    } else if (open !== dockedOpen.current) change(dockedOpen.current);
  });
  const wasDocked = useRef(true);
  useLayoutEffect(() => {
    if (wasDocked.current === docked) return;
    wasDocked.current = docked;
    transition(docked);
  }, [docked]);

  // The overlay spans the history, beside its scrollbar, not the composer.
  // Its owner wakes reading whenever the overlay opens, moves or closes.
  const [geometry, setGeometry] = useState<CSSProperties>();
  const wasFloating = useRef(false);
  useLayoutEffect(() => {
    const scroller = reader.current?.querySelector<HTMLElement>(
      "[data-message-scroller]",
    );
    if (!floating) {
      setGeometry(undefined);
      if (wasFloating.current) readingPositioned(scroller ?? null);
      wasFloating.current = false;
      return;
    }
    wasFloating.current = true;
    const container = row.current;
    if (!container || !scroller) return;
    const measure = () => {
      const outer = container.getBoundingClientRect();
      const history = scroller.getBoundingClientRect();
      setGeometry({
        "--aside-top": `${history.top - outer.top}px`,
        "--aside-height": `${history.height}px`,
        "--aside-scrollbar": `${scroller.offsetWidth - scroller.clientWidth}px`,
      } as CSSProperties);
      readingPositioned(scroller);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(container);
    observer.observe(scroller);
    return () => observer.disconnect();
  }, [floating]);

  // A nested surface: Escape and a press elsewhere in the row close only it.
  useEffect(() => {
    const element = box.current;
    const container = row.current;
    if (!floating || !element || !container) return;
    const previous =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    element.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      event.preventDefault();
      event.stopPropagation();
      change(false);
      previous?.focus({ preventScroll: true });
    };
    const pointerdown = (event: PointerEvent) => {
      const target = event.target as Node;
      if (container.contains(target) && !element.contains(target))
        change(false);
    };
    element.addEventListener("keydown", keydown);
    document.addEventListener("pointerdown", pointerdown, true);
    return () => {
      element.removeEventListener("keydown", keydown);
      document.removeEventListener("pointerdown", pointerdown, true);
    };
  }, [floating]);

  // Stable, so opening the overlay doesn't rerender the readers.
  const covers = useCallback(() => {
    const element = box.current;
    return element?.dataset.workspaceAside === "floating" && !element.hidden
      ? [element.getBoundingClientRect()]
      : [];
  }, []);

  return (
    <div ref={row} className={styles.workspaceRow}>
      <div ref={reader} className={styles.workspaceReader}>
        <ReadingCovers value={covers}>{children}</ReadingCovers>
      </div>
      {aside != null && (
        <div
          ref={box}
          className={docked ? styles.workspaceAside : styles.floatingAside}
          data-workspace-aside={docked ? "docked" : "floating"}
          hidden={!open}
          tabIndex={docked ? undefined : -1}
          style={{ ...geometry, inlineSize: layout?.width ?? width }}
        >
          {aside}
        </div>
      )}
    </div>
  );
}
