import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from "react";
import type { VirtualizerHandle } from "virtua";
import {
  GitHubIssueIcon,
  GitPullRequestIcon,
  GithubLogoIcon,
  PinIcon,
  PlayFilledIcon,
} from "../../shared/design-system/icons";
import { formatItemTimestamp } from "../../shared/datetime";
import type { Attachment, ChannelMessage } from "../relay/contracts";
import type { RelaySession } from "../relay/session";
import { usePinnedMessages } from "./use-pins";
import { type SidelineMarker, sidelineMarkers } from "./sideline-markers";
import styles from "./Sideline.module.css";

/** Sideline pixels per history pixel. */
const SCALE = 0.2;
const CARD = 40;
const CHIP = 26;
const GAP = 4;
const LABEL = 20;
/** Markers kept on each edge once they scroll past it. */
const STICKY = 3;
const MIN_WIDTH = 136;
const MAX_WIDTH = 232;

type Frame = Readonly<{
  visible: boolean;
  left: number;
  top: number;
  width: number;
  height: number;
  /** History coordinates: scroll extent, viewport and offset. */
  extent: number;
  viewport: number;
  offset: number;
  /** The sideline's own scroll: history at `y` draws at `y * SCALE - shift`. */
  shift: number;
  /** Each marker's history row center. */
  centers: ReadonlyMap<string, number>;
}>;

type Placed = Readonly<{
  marker: SidelineMarker;
  /** Where its row sits on the sideline, if within it. */
  exact: number | undefined;
  top: number;
  compact: boolean;
  edge?: "top" | "bottom";
}>;

const HIDDEN: Frame = {
  visible: false,
  left: 0,
  top: 0,
  width: 0,
  height: 0,
  extent: 0,
  viewport: 0,
  offset: 0,
  shift: 0,
  centers: new Map(),
};

function panelOpen(document: Document) {
  for (const panel of document.querySelectorAll("[data-panel-workspace]"))
    if (panel.getBoundingClientRect().width > 0) return true;
  return false;
}

/** Cards in history order, kept from overlapping: the nearest markers past
 * each edge stack there, and the rest stay as near their rows as they fit. */
export function placeMarkers(
  markers: readonly SidelineMarker[],
  at: (marker: SidelineMarker) => number | undefined,
  height: number,
): {
  placed: Placed[];
  earlier: number;
  later: number;
  /** Where the sticky stacks end, when there are any. */
  rules: readonly number[];
} {
  const above: SidelineMarker[] = [];
  const inside: { marker: SidelineMarker; y: number }[] = [];
  const below: SidelineMarker[] = [];
  for (const marker of markers) {
    const y = at(marker);
    if (y === undefined) continue;
    if (y < CHIP / 2) above.push(marker);
    else if (y > height - CHIP / 2) below.push(marker);
    else inside.push({ marker, y });
  }
  const top = above.slice(-STICKY);
  const bottom = below.slice(0, STICKY);
  const earlier = above.length - top.length;
  const later = below.length - bottom.length;
  const placed: Placed[] = [];
  let upper = earlier ? LABEL : 0;
  for (const marker of top) {
    placed.push({
      marker,
      exact: undefined,
      top: upper,
      compact: true,
      edge: "top",
    });
    upper += CHIP + GAP;
  }
  let lower = height - (later ? LABEL : 0);
  const stacked: Placed[] = [];
  for (const marker of [...bottom].reverse()) {
    lower -= CHIP;
    stacked.unshift({
      marker,
      exact: undefined,
      top: lower,
      compact: true,
      edge: "bottom",
    });
    lower -= GAP;
  }
  // Too many to show whole: they all shrink to chips.
  const compact = inside.length * (CARD + GAP) > lower - upper;
  const size = compact ? CHIP : CARD;
  const tops = inside.map(({ y }) => y - size / 2);
  for (let i = 0; i < tops.length; i++)
    tops[i] = Math.max(
      tops[i] ?? 0,
      upper,
      i ? (tops[i - 1] ?? 0) + size + GAP : upper,
    );
  for (let i = tops.length - 1; i >= 0; i--)
    tops[i] = Math.min(
      tops[i] ?? 0,
      lower - size,
      i < tops.length - 1 ? (tops[i + 1] ?? 0) - size - GAP : lower - size,
    );
  for (const [i, { marker, y }] of inside.entries())
    placed.push({
      marker,
      exact: y,
      top: Math.max(upper, tops[i] ?? 0),
      compact,
    });
  const rules = [
    ...(top.length ? [upper - GAP / 2] : []),
    ...(bottom.length ? [lower + GAP / 2] : []),
  ];
  return { placed: [...placed, ...stacked], earlier, later, rules };
}

function Thumbnail({
  attachment,
  source,
}: {
  attachment: Attachment;
  source: (url: string, size?: "small") => string | undefined;
}) {
  if (attachment.kind === "video")
    return (
      <span className={styles.thumbnail}>
        {attachment.previewUrl ? (
          <img src={source(attachment.previewUrl)} alt="" loading="lazy" />
        ) : (
          <video
            src={source(attachment.url)}
            preload="metadata"
            muted
            playsInline
          />
        )}
        <span className={styles.play} aria-hidden="true">
          <PlayFilledIcon size={10} />
        </span>
      </span>
    );
  return (
    <span className={styles.thumbnail}>
      <img src={source(attachment.url, "small")} alt="" loading="lazy" />
    </span>
  );
}

function describe(marker: SidelineMarker) {
  const link = marker.links[0];
  if (link) return `${link.label} ${link.title}`;
  if (marker.media.length)
    return `${marker.media[0]?.kind === "video" ? "Video" : "Image"}${marker.excerpt ? `: ${marker.excerpt}` : ""}`;
  return `Pinned: ${marker.excerpt || "message"}`;
}

function Card({
  marker,
  compact,
  inView,
  source,
  onJump,
}: {
  marker: SidelineMarker;
  compact: boolean;
  inView: boolean;
  source: (url: string, size?: "small") => string | undefined;
  onJump(id: string): void;
}) {
  const link = marker.links[0];
  const media = marker.media[0];
  const extra = link ? marker.links.length - 1 : 0;
  const icon = link ? (
    link.kind === "pull" ? (
      <GitPullRequestIcon size={14} />
    ) : link.kind === "issue" ? (
      <GitHubIssueIcon size={14} />
    ) : (
      <GithubLogoIcon size={14} />
    )
  ) : !media ? (
    <PinIcon size={14} />
  ) : null;
  const label = describe(marker);
  const kind = !media
    ? "Pinned message"
    : marker.media.length > 1
      ? `${marker.media.length} ${media.kind === "video" ? "videos" : "images"}`
      : media.kind === "video"
        ? "Video"
        : "Image";
  return (
    <button
      type="button"
      className={styles.card}
      data-sideline-marker={marker.id}
      data-compact={compact || undefined}
      data-in-view={inView || undefined}
      aria-label={`Jump to ${label}`}
      title={label}
      onClick={(event) => {
        event.stopPropagation();
        onJump(marker.id);
      }}
    >
      {media && !link ? (
        compact ? (
          <span className={styles.icon}>
            {media.kind === "video" ? <PlayFilledIcon size={12} /> : null}
            {media.kind === "image" && (
              <img
                className={styles.chipImage}
                src={source(media.url, "small")}
                alt=""
                loading="lazy"
              />
            )}
          </span>
        ) : (
          <Thumbnail attachment={media} source={source} />
        )
      ) : (
        <span className={styles.icon}>{icon}</span>
      )}
      <span className={styles.text}>
        <span className={styles.primary}>
          {link ? (
            <>
              <strong>{link.label}</strong> {link.title}
            </>
          ) : (
            marker.excerpt || kind
          )}
        </span>
        {!compact && (
          <span className={styles.secondary}>
            {[
              link
                ? link.title === link.repository
                  ? marker.excerpt
                  : link.repository
                : media
                  ? kind
                  : "Pinned",
              formatItemTimestamp(marker.createdAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          </span>
        )}
      </span>
      {(marker.pinned && (link || media)) || extra > 0 ? (
        <span className={styles.badges}>
          {extra > 0 && <span>+{extra}</span>}
          {marker.pinned && (link || media) && (
            <PinIcon size={12} aria-label="Pinned" />
          )}
        </span>
      ) : null}
    </button>
  );
}

/** A compressed timeline of a conversation's media, GitHub links and pins in
 * its right margin. It covers the loaded history, scrolls in step with it, and
 * keeps the nearest markers on its edges once they scroll past. */
export function Sideline({
  rows,
  channelId,
  session,
  scroller,
  handle,
  onJump,
  onSeek,
  onWheel,
}: {
  rows: readonly ChannelMessage[];
  channelId: string;
  session: RelaySession;
  scroller: RefObject<HTMLElement | null>;
  handle: RefObject<VirtualizerHandle | null>;
  onJump(id: string): void;
  /** Scroll history so `offset` is at the viewport's center. */
  onSeek(offset: number): void;
  onWheel(deltaY: number): void;
}) {
  const pins = usePinnedMessages(session, channelId);
  const markers = useMemo(
    () => sidelineMarkers(rows, pins.set),
    [rows, pins.set],
  );
  const indexes = useMemo(
    () => new Map(rows.map((row, index) => [row.id, index])),
    [rows],
  );
  const root = useRef<HTMLElement>(null);
  const [frame, setShownFrame] = useState<Frame>(HIDDEN);
  // Scroll and resize measure every frame; only a change renders.
  const shownSignature = useRef("");
  const setFrame = (next: Frame | ((current: Frame) => Frame)) =>
    setShownFrame((current) => {
      const value = typeof next === "function" ? next(current) : next;
      const signature = JSON.stringify({
        ...value,
        centers: [...value.centers],
      });
      if (signature === shownSignature.current) return current;
      shownSignature.current = signature;
      return value;
    });
  const measure = useRef<() => void>(() => {});
  measure.current = () => {
    const element = scroller.current;
    const aside = root.current;
    const virtualizer = handle.current;
    const list = element?.querySelector<HTMLElement>(":scope > ol");
    const parent = aside?.offsetParent;
    if (!element || !aside || !virtualizer || !list || !parent) {
      setFrame(HIDDEN);
      return;
    }
    const feed = element.getBoundingClientRect();
    const listRect = list.getBoundingClientRect();
    const origin = parent.getBoundingClientRect();
    const right = feed.left + element.clientLeft + element.clientWidth;
    // Rows span the feed; their column is the edge's measure, centered in it.
    const column = Math.min(
      listRect.width,
      element.querySelector<HTMLElement>(":scope > [data-timeline-edge]")
        ?.offsetWidth ?? listRect.width,
    );
    const columnRight = listRect.left + (listRect.width + column) / 2;
    const margin = right - columnRight;
    const width = Math.min(MAX_WIDTH, margin - 24);
    if (
      width < MIN_WIDTH ||
      panelOpen(element.ownerDocument) ||
      !markers.length
    ) {
      setFrame((current) => (current.visible ? HIDDEN : current));
      return;
    }
    const offset = element.scrollTop;
    const listTop = listRect.top - feed.top + offset;
    const centers = new Map<string, number>();
    for (const marker of markers) {
      const index = indexes.get(marker.id);
      if (index === undefined) continue;
      centers.set(
        marker.id,
        listTop +
          virtualizer.getItemOffset(index) +
          virtualizer.getItemSize(index) / 2,
      );
    }
    const extent = element.scrollHeight;
    const viewport = element.clientHeight;
    const track = extent * SCALE;
    const shift =
      track > viewport && extent > viewport
        ? (offset / (extent - viewport)) * (track - viewport)
        : 0;
    setFrame({
      visible: true,
      left: columnRight - origin.left + (margin - width) / 2,
      top: feed.top - origin.top,
      width,
      height: viewport,
      extent,
      viewport,
      offset,
      shift,
      centers,
    });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: New rows or markers move every marker.
  useLayoutEffect(() => {
    measure.current();
  }, [markers, indexes]);
  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    let pending: number | undefined;
    const schedule = () => {
      if (pending !== undefined) return;
      pending = requestAnimationFrame(() => {
        pending = undefined;
        measure.current();
      });
    };
    const resize = new ResizeObserver(schedule);
    resize.observe(element);
    const observed = new Set<Element>();
    const observeList = () => {
      const list = element.querySelector(":scope > ol");
      if (list && !observed.has(list)) {
        observed.add(list);
        resize.observe(list);
      }
    };
    observeList();
    const children = new MutationObserver(() => {
      observeList();
      schedule();
    });
    children.observe(element, { childList: true });
    // A panel opening elsewhere narrows the feed; this also hears one that doesn't.
    const panels = new MutationObserver(schedule);
    panels.observe(element.ownerDocument.body, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["data-panel-workspace", "hidden"],
    });
    element.addEventListener("scroll", schedule, { passive: true });
    window.addEventListener("resize", schedule);
    return () => {
      if (pending !== undefined) cancelAnimationFrame(pending);
      resize.disconnect();
      children.disconnect();
      panels.disconnect();
      element.removeEventListener("scroll", schedule);
      window.removeEventListener("resize", schedule);
    };
  }, [scroller]);

  const source = (url: string, size?: "small") =>
    session.media(url, size, channelId);
  const draw = (y: number) => y * SCALE - frame.shift;
  const { placed, earlier, later, rules } = frame.visible
    ? placeMarkers(
        markers,
        (marker) => {
          const center = frame.centers.get(marker.id);
          return center === undefined ? undefined : draw(center);
        },
        frame.height,
      )
    : { placed: [], earlier: 0, later: 0, rules: [] };
  const bandTop = draw(frame.offset);
  const bandHeight = frame.viewport * SCALE;
  const trackTop = Math.max(0, draw(0));
  const trackBottom = Math.min(frame.height, draw(frame.extent));
  return (
    <aside
      ref={root}
      className={styles.sideline}
      data-sideline=""
      data-visible={frame.visible || undefined}
      aria-label="Conversation sideline"
      aria-hidden={!frame.visible || undefined}
      style={
        frame.visible
          ? {
              left: frame.left,
              top: frame.top,
              width: frame.width,
              height: frame.height,
            }
          : undefined
      }
      onWheel={(event) => onWheel(event.deltaY)}
    >
      {frame.visible && (
        <>
          {/* biome-ignore lint/a11y/noStaticElementInteractions: Pointer seeking mirrors the markers, which are the keyboard path. */}
          {/* biome-ignore lint/a11y/useKeyWithClickEvents: The markers are the keyboard path. */}
          <div
            className={styles.track}
            onClick={(event) => {
              const y =
                event.clientY - event.currentTarget.getBoundingClientRect().top;
              onSeek((y + frame.shift) / SCALE);
            }}
          >
            <span
              className={styles.spine}
              style={{
                top: trackTop,
                height: Math.max(0, trackBottom - trackTop),
              }}
            />
            <span
              className={styles.band}
              data-sideline-viewport=""
              style={{ top: bandTop, height: bandHeight }}
            />
            <svg className={styles.links} aria-hidden="true">
              {placed.map(({ marker, exact, top, compact }) =>
                exact === undefined ? null : (
                  <path
                    key={marker.id}
                    d={`M 4 ${exact} C 10 ${exact}, 6 ${top + (compact ? CHIP : CARD) / 2}, 14 ${top + (compact ? CHIP : CARD) / 2}`}
                  />
                ),
              )}
            </svg>
            {placed.map(({ marker, exact }) =>
              exact === undefined ? null : (
                <span
                  key={marker.id}
                  className={styles.dot}
                  style={{ top: exact }}
                />
              ),
            )}
          </div>
          {rules.map((y) => (
            <span key={y} className={styles.rule} style={{ top: y }} />
          ))}
          {earlier > 0 && (
            <span className={styles.more} style={{ top: 0 }}>
              {earlier} earlier
            </span>
          )}
          {placed.map(({ marker, top, compact, edge }) => {
            const center = frame.centers.get(marker.id) ?? 0;
            return (
              <div
                key={marker.id}
                className={styles.slot}
                data-edge={edge}
                style={{ transform: `translateY(${top}px)` }}
              >
                <Card
                  marker={marker}
                  compact={compact}
                  inView={
                    center >= frame.offset &&
                    center <= frame.offset + frame.viewport
                  }
                  source={source}
                  onJump={onJump}
                />
              </div>
            );
          })}
          {later > 0 && (
            <span className={styles.more} style={{ bottom: 0 }}>
              {later} later
            </span>
          )}
        </>
      )}
    </aside>
  );
}
