import { useLayoutEffect, useRef, type ReactNode } from "react";
import { usePresence } from "motion/react";
import { Panel } from "../../shared/design-system/ui/Panel";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { XIcon } from "../../shared/design-system/icons";
import styles from "./RailCardSheet.module.css";

/** A local collection layer: the reader stays available and keeps its place. */
export function RailCardSheet({
  opener,
  close,
  children,
}: {
  opener: HTMLElement | null;
  close(): void;
  children(closeActionSpace: ReactNode): ReactNode;
}) {
  const frame = useRef<HTMLDivElement>(null);
  const dismiss = useRef<HTMLButtonElement>(null);
  const [present, remove] = usePresence();
  useLayoutEffect(() => {
    if (present) return;
    // CSS owns the interruptible transition; presence only retains its exit.
    const animations = frame.current?.getAnimations() ?? [];
    let current = true;
    void Promise.all(
      animations.map((animation) => animation.finished.catch(() => {})),
    ).then(() => {
      if (current) remove?.();
    });
    return () => {
      current = false;
    };
  }, [present, remove]);
  useLayoutEffect(() => {
    dismiss.current?.focus({ preventScroll: true });
    const element = frame.current;
    return () => {
      if (
        opener?.isConnected &&
        (element?.contains(document.activeElement) ||
          document.activeElement === document.body)
      )
        opener.focus({ preventScroll: true });
    };
  }, [opener]);
  return (
    <div
      ref={frame}
      className={styles.sheet}
      data-rail-card-sheet=""
      data-leaving={!present || undefined}
      inert={!present}
      aria-hidden={!present || undefined}
      onKeyDown={(event) => {
        if (
          event.key === "Escape" &&
          !event.shiftKey &&
          !event.defaultPrevented
        ) {
          event.preventDefault();
          event.stopPropagation();
          close();
        }
      }}
    >
      <Panel as="div">
        <div className={styles.content}>
          {children(<span className={styles.actionSpace} aria-hidden="true" />)}
        </div>
        <div className={styles.dismiss}>
          <IconButton
            ref={dismiss}
            aria-label="Close expanded card"
            icon={<XIcon size={20} aria-hidden="true" />}
            onClick={close}
          />
        </div>
      </Panel>
    </div>
  );
}
