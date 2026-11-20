import {
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { Avatar } from "../../shared/design-system/ui/Avatar";
import { Button } from "../../shared/design-system/ui/Button";
import { UnreadDmPreviews, type UnreadDmPreview } from "./SidebarUnread";
import { UNREAD_MARKERS } from "./conversation-rows";
import styles from "./Channels.module.css";

/** Marks a card row holding an unread DM, for the card's DM-only view. */
export const UNREAD_DM_ROW = "data-unread-dm-row";

type HiddenDm = { channelId: string } & UnreadDmPreview;

function unread(row: Element) {
  // Muting keeps unread evidence but never asks for attention.
  return [...row.querySelectorAll(UNREAD_MARKERS)].some(
    (marker) => !marker.hasAttribute("data-channel-muted"),
  );
}

/**
 * Who is waiting in a card's unread DMs that its cut hides: everything when
 * the card is collapsed, otherwise the rows below its clipped list. Shows up
 * to three faces and a count; clicking shows only those DMs, and the same
 * spot then reads Show all. The view ends by itself once none are unread.
 */
export function SidebarCardDms({
  open,
  filtering,
  onShow,
  onShowAll,
  onNoneLeft,
}: {
  open: boolean;
  filtering: boolean;
  onShow(): void;
  onShowAll(): void;
  onNoneLeft(): void;
}) {
  const previews = useContext(UnreadDmPreviews);
  const anchor = useRef<HTMLDivElement>(null);
  const [hidden, setHidden] = useState<HiddenDm[]>([]);
  // Unread DMs in the whole card; unknown until first measured.
  const [total, setTotal] = useState<number>();
  // Measure before paint, so moving between header and grip never shows the
  // DM-only view without its marked rows.
  useLayoutEffect(() => {
    const card = anchor.current?.closest<HTMLElement>("[data-sidebar-section]");
    if (!card || !previews) return;
    const list = () => card.querySelector<HTMLElement>(`.${styles.cardRows}`);
    let frame = 0;
    const measure = () => {
      frame = 0;
      const cut = open ? list()?.getBoundingClientRect().bottom : undefined;
      const next: HiddenDm[] = [];
      let count = 0;
      for (const row of card.querySelectorAll<HTMLElement>("[data-card-row]")) {
        const button = row.querySelector<HTMLElement>(
          "button[data-channel-id]",
        );
        const id = button?.dataset.channelId;
        const preview = id ? previews.get(id) : undefined;
        const waiting = !!button && !!preview && unread(button);
        row.toggleAttribute(UNREAD_DM_ROW, waiting);
        if (!waiting || !id || !preview) continue;
        count++;
        const below =
          !open ||
          (cut !== undefined && button.getBoundingClientRect().top >= cut - 1);
        if (below) next.push({ channelId: id, ...preview });
      }
      setTotal(count);
      setHidden((previous) =>
        previous.length === next.length &&
        previous.every(
          (dm, index) =>
            dm.channelId === next[index]?.channelId &&
            dm.src === next[index]?.src,
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
        "data-channel-activity",
        "data-channel-id",
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
      for (const row of card.querySelectorAll(`[${UNREAD_DM_ROW}]`))
        row.removeAttribute(UNREAD_DM_ROW);
    };
  }, [open, previews]);
  // Reading the last one ends the DM-only view; the card stays where it is.
  useEffect(() => {
    if (filtering && total === 0) onNoneLeft();
  }, [filtering, total, onNoneLeft]);

  const count = hidden.length;
  const faces = hidden.slice(0, 3);
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
          aria-label={`${count} unread ${count === 1 ? "DM" : "DMs"}, show only these`}
          onClick={onShow}
        >
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
            <span>·</span>
          </span>
          <span>{count} unread</span>
        </Button>
      ) : null}
    </div>
  );
}
