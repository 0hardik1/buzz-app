import { type ReactNode, useLayoutEffect, useRef, useState } from "react";
import { formatItemTimestamp } from "../../shared/datetime";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { useComposerScope } from "./composer-overlay";
import { readingOrigin, useReading } from "./inline-containers";
import styles from "./Messages.module.css";

const HEADING = /^H[1-6]$/;

/** The blocks the chat shows: the opening brief, after a leading heading when
 * an older details message has one. */
const shownBlocks = (blocks: Element[]) =>
  blocks[0] && HEADING.test(blocks[0].tagName) ? 2 : 1;

/** Whether the chat holds back any of the message: a later block, or a brief
 * longer than its lines. */
function holdsBack(clip: HTMLElement) {
  const text = clip.firstElementChild;
  if (!text) return false;
  const blocks = [...text.children];
  const shown = shownBlocks(blocks);
  return (
    blocks.length > shown ||
    blocks
      .slice(0, shown)
      .some((block) => block.scrollHeight > block.clientHeight + 1)
  );
}

/** A details message reads in the chat as its opening brief, in full, and
 * opens whole in a reader over the composer it is answered from: its
 * workspace draws that reader from the message's id. Without a workspace, as
 * in search previews, it reads in a dialog of its own. */
export function DetailsMessage({
  messageId,
  channelId,
  author,
  createdAt,
  preview,
  children,
}: {
  messageId: string;
  channelId: string;
  author: string;
  createdAt: number;
  /** The whole message as the chat renders it; only its brief shows. */
  preview: ReactNode;
  /** The reader's body, for its own dialog. */
  children: ReactNode;
}) {
  const reading = useReading();
  const composer = useComposerScope();
  const [own, setOwn] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const clip = useRef<HTMLDivElement>(null);
  const [clipped, setClipped] = useState(false);
  useLayoutEffect(() => {
    const element = clip.current;
    if (!element) return;
    const measure = () => setClipped(holdsBack(element));
    measure();
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(measure);
    observer?.observe(element);
    return () => observer?.disconnect();
  }, []);
  // A send from its composer closes it.
  const show = () => {
    if (!reading) setOwn(true);
    else
      reading.openDetails(
        { kind: "details", channelId, messageId },
        readingOrigin(composer),
        trigger.current,
      );
  };
  return (
    <div className={styles.detailsPreview} data-clipped={clipped || undefined}>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: Show more is the keyboard path; this only widens the pointer target. */}
      {/* biome-ignore lint/a11y/noStaticElementInteractions: Show more is the keyboard path; this only widens the pointer target. */}
      <div
        ref={clip}
        className={styles.detailsClip}
        onClick={(event) => {
          // Links, mentions and selected text keep their own meaning.
          if (
            !clipped ||
            (event.target instanceof Element &&
              event.target.closest("a, button, [role=button]")) ||
            !getSelection()?.isCollapsed
          )
            return;
          show();
        }}
      >
        {preview}
      </div>
      {clipped && (
        <span className={styles.detailsMore}>
          <Button
            ref={trigger}
            variant="link"
            size="inline"
            aria-haspopup="dialog"
            onClick={show}
          >
            Show more
          </Button>
        </span>
      )}
      {!reading && (
        <Dialog
          open={own}
          onOpenChange={setOwn}
          title={author}
          description={formatItemTimestamp(createdAt, { withTime: true })}
          closeLabel="Close details"
          finalFocus={trigger}
        >
          <div className={styles.detailsReader}>{children}</div>
        </Dialog>
      )}
    </div>
  );
}
