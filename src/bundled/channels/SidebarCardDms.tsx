import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { Button } from "../../shared/design-system/ui/Button";
import {
  UnreadDmPreviews,
  audiblyUnread,
  waitsForYou,
  type UnreadDmPreview,
} from "./SidebarUnread";
import styles from "./Channels.module.css";

/** Marks a card row that is waiting for you, for the card's filtered view. */
export const WAITING_ROW = "data-waiting-row";

type Waiting = { channelId: string; preview?: UnreadDmPreview | undefined };

/**
 * What waits for you in a card below its cut: every dotted row when the card
 * is collapsed, otherwise those below its clipped list. Shows the faces of up
 * to three DMs and a count; clicking shows only those rows, and the same spot
 * then reads Show all. The conversation you have open never counts. The view ends
 * by itself once none are unread; a card it opened then waits for you to
 * leave the conversation you are in before it collapses again.
 */
export function SidebarCardDms({
  open,
  filtering,
  onShow,
  onShowAll,
  onNoneLeft,
  settling,
  onSettled,
}: {
  open: boolean;
  filtering: boolean;
  onShow(): void;
  onShowAll(): void;
  onNoneLeft(): void;
  /** Collapse once no conversation in the card is open. */
  settling: boolean;
  onSettled(): void;
}) {
  const previews = useContext(UnreadDmPreviews);
  const anchor = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<Waiting[]>([]);
  // Unread DMs in the whole card; unknown until first measured.
  const [total, setTotal] = useState<number>();
  const [holding, setHolding] = useState(false);
  // Measure before paint, so moving between header and grip never shows the
  // DM-only view without its marked rows.
  useLayoutEffect(() => {
    const card = anchor.current?.closest<HTMLElement>("[data-sidebar-section]");
    if (!card) return;
    const list = () => card.querySelector<HTMLElement>(`.${styles.cardRows}`);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const cut = open ? list()?.getBoundingClientRect().bottom : undefined;
      const next: Waiting[] = [];
      let count = 0;
      let selected = false;
      for (const row of card.querySelectorAll<HTMLElement>("[data-card-row]")) {
        const button = row.querySelector<HTMLElement>(
          "button[data-channel-id]",
        );
        const id = button?.dataset.channelId;
        const current = row.querySelector("[data-selected]") !== null;
        selected ||= current;
        // The same rule as the sidebar's unread cue, so the two always agree.
        const waiting =
          !current &&
          !!button &&
          !!id &&
          audiblyUnread(button) &&
          waitsForYou(button);
        row.toggleAttribute(WAITING_ROW, waiting);
        if (!waiting || !id) continue;
        count++;
        const below =
          !open ||
          (cut !== undefined && button.getBoundingClientRect().top >= cut - 1);
        if (below) next.push({ channelId: id, preview: previews?.get(id) });
      }
      setTotal(count);
      setHolding(selected);
      setHidden((previous) =>
        previous.length === next.length &&
        previous.every(
          (dm, index) =>
            dm.channelId === next[index]?.channelId &&
            dm.preview?.src === next[index]?.preview?.src,
        )
          ? previous
          : next,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(measure);
    };
    const mutations = new MutationObserver(schedule);
    mutations.observe(card, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: [
        "style",
        "open",
        "data-channel-unread",
        "data-channel-muted",
        "data-priority",
        "data-channel-activity",
        "data-channel-id",
        "data-selected",
      ],
    });
    const sized =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(schedule);
    sized?.observe(card);
    measure();
    return () => {
      cancelAnimationFrame(frame);
      mutations.disconnect();
      sized?.disconnect();
      for (const row of card.querySelectorAll(`[${WAITING_ROW}]`))
        row.removeAttribute(WAITING_ROW);
    };
  }, [open, previews]);
  // Reading the last one ends the DM-only view; the card stays where it is.
  useEffect(() => {
    if (filtering && total === 0) onNoneLeft();
  }, [filtering, total, onNoneLeft]);
  useEffect(() => {
    if (settling && !holding) onSettled();
  }, [settling, holding, onSettled]);

  const count = hidden.length;
  // Faces belong to DMs; mentions and thread replies add to the count.
  const faces = hidden
    .flatMap((waiting) =>
      waiting.preview
        ? [{ channelId: waiting.channelId, ...waiting.preview }]
        : [],
    )
    .slice(0, 3);
  const counted = count > 1 || faces.length === 0;
  return (
    <div
      ref={anchor}
      className={styles.cardDms}
      hidden={!filtering && count === 0}
    >
      {filtering ? (
        <Button
          variant="subtle"
          size="xs"
          shape="capsule"
          type="button"
          aria-label="Show all conversations"
          onClick={onShowAll}
        >
          Show all
        </Button>
      ) : count > 0 ? (
        <Button
          variant="prominent"
          size="xs"
          shape="capsule"
          type="button"
          aria-label={`${count} unread for you, show only these`}
          onClick={onShow}
        >
          {faces.length > 0 && (
            <span className={styles.unreadDmPreviews} aria-hidden="true">
              <span className={styles.unreadDmStack}>
                {faces.map((dm, index) => (
                  <span
                    key={dm.channelId}
                    className={styles.unreadDmAvatar}
                    style={{ zIndex: faces.length - index }}
                  >
                    <Avatar
                      src={dm.src}
                      alt=""
                      fallback={dm.name}
                      size="fill"
                      shape={dm.isAgent ? "squircle" : "circle"}
                    />
                  </span>
                ))}
              </span>
              {/* One face says it all; otherwise the count follows. */}
              {faces.length > 0 && counted && <span>·</span>}
            </span>
          )}
          {counted && <span>{count} unread</span>}
        </Button>
      ) : null}
    </div>
  );
}
