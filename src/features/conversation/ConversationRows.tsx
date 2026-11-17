import {
  Virtualizer,
  type CustomItemComponentProps,
  type CustomContainerComponentProps,
} from "virtua";
import {
  cloneElement,
  createContext,
  useContext,
  useState,
  type ComponentProps,
  type ReactElement,
  type RefObject,
  type SyntheticEvent,
} from "react";
import styles from "./FeedList.module.css";

export type VirtualRowProps = ComponentProps<"li">;
const ListLabel = createContext("Conversations");

/** Retain native list semantics while measuring the real row, not a wrapper. */
function MeasuredRow({ children, style, ref }: CustomItemComponentProps) {
  const row = children as ReactElement<{ virtualRow?: VirtualRowProps }>;
  return cloneElement(row, {
    virtualRow: { ...row.props.virtualRow, style, ref },
  });
}
function MeasuredList({ children, style, ref }: CustomContainerComponentProps) {
  return (
    <ul
      ref={ref}
      style={style}
      className={`${styles.list} ${styles.virtualList}`}
      aria-label={useContext(ListLabel)}
    >
      {children}
    </ul>
  );
}

/** Rail collections mount only the viewport and Virtua's overscan. */
export function ConversationRows({
  keys,
  label,
  scrollRef,
  children,
}: {
  keys: readonly string[];
  label: string;
  scrollRef?: RefObject<HTMLElement | null> | undefined;
  children(key: string, virtualRow?: VirtualRowProps): ReactElement;
}) {
  const [held, setHeld] = useState<string>();
  // Use one renderer as live rows arrive, so crossing a size threshold never
  // replaces the focused row's DOM. An empty collection has no rows to measure.
  if (!scrollRef || !keys.length)
    return (
      <ul className={styles.list} aria-label={label}>
        {keys.map((key) => children(key))}
      </ul>
    );
  const retain = (event: SyntheticEvent) => {
    const row =
      event.target instanceof Element
        ? event.target.closest("[aria-posinset]")
        : null;
    if (row) setHeld(keys[Number(row.getAttribute("aria-posinset")) - 1]);
  };
  const index = held === undefined ? -1 : keys.indexOf(held);
  return (
    <div
      className={styles.virtualFrame}
      onFocusCapture={retain}
      onPointerDownCapture={retain}
      onContextMenuCapture={retain}
    >
      <ListLabel value={label}>
        <Virtualizer
          data={keys}
          as={MeasuredList}
          item={MeasuredRow}
          scrollRef={scrollRef}
          keepMounted={index < 0 ? [] : [index]}
        >
          {(key, position) =>
            children(key, {
              "aria-posinset": position + 1,
              "aria-setsize": keys.length,
            })
          }
        </Virtualizer>
      </ListLabel>
    </div>
  );
}
