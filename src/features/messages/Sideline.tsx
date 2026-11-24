import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
  type RefObject,
} from "react";
import type { VirtualizerHandle } from "virtua";
import "../../shared/design-system/styles/avatar-shape.css";
import {
  GitHubIssueIcon,
  GitPullRequestIcon,
  PinIcon,
  PlayFilledIcon,
} from "../../shared/design-system/icons";
import { Tooltip } from "../../shared/design-system/ui/Tooltip";
import {
  ContributionBoundary,
  contributionKey,
} from "../conversation/ContributionBoundary";
import type {
  ContributionReader,
  LinkRenderer,
} from "../conversation/contracts";
import {
  LinkDescriptionContext,
  LinkGlyphContext,
} from "../conversation/LinkLabelContext";
import { resolveLink } from "../conversation/MessageLink";
import type { ChannelMessage } from "../relay/contracts";
import type { RelaySession } from "../relay/session";
import { usePinnedMessages } from "./use-pins";
import { type SidelineMarker, sidelineMarkers } from "./sideline-markers";
import styles from "./Sideline.module.css";

/** Sideline pixels per history pixel. */
const SCALE = 0.2;
/** An icon's size, and the sideline's width around its line. */
const ICON = 20;
const WIDTH = 28;
/** How far apart icons stacked on an edge sit, overlapping. */
const STACK = 5;
/** The closest crowded icons come, overlapping, before they push apart. */
const CROWD = 12;
/** Icons kept on each edge once they scroll past it. */
const STICKY = 4;

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
  top: number;
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

/** Icons in history order at their rows. The nearest ones past each edge
 * stack tightly there, and crowded ones overlap before they push apart. Later
 * entries draw over earlier ones, so each stack's nearest icon is in front. */
export function placeMarkers(
  markers: readonly SidelineMarker[],
  at: (marker: SidelineMarker) => number | undefined,
  height: number,
  /** An edge whose stack the pointer has spread out, to reach each icon. */
  fanned?: "top" | "bottom",
): Placed[] {
  const above: SidelineMarker[] = [];
  const inside: { marker: SidelineMarker; y: number }[] = [];
  const below: SidelineMarker[] = [];
  for (const marker of markers) {
    const y = at(marker);
    if (y === undefined) continue;
    if (y < ICON / 2) above.push(marker);
    else if (y > height - ICON / 2) below.push(marker);
    else inside.push({ marker, y });
  }
  const top = above.slice(-STICKY);
  const bottom = below.slice(0, STICKY);
  const step = (edge: "top" | "bottom") => (edge === fanned ? ICON + 2 : STACK);
  const upper = top.length ? (top.length - 1) * step("top") + CROWD : 0;
  const lower =
    height - (bottom.length ? (bottom.length - 1) * step("bottom") + CROWD : 0);
  const tops = inside.map(({ y }) => y - ICON / 2);
  for (let i = 0; i < tops.length; i++)
    tops[i] = Math.max(
      tops[i] ?? 0,
      upper,
      i ? (tops[i - 1] ?? 0) + CROWD : upper,
    );
  for (let i = tops.length - 1; i >= 0; i--)
    tops[i] = Math.min(
      tops[i] ?? 0,
      lower - ICON,
      i < tops.length - 1 ? (tops[i + 1] ?? 0) - CROWD : lower - ICON,
    );
  return [
    ...inside.map(({ marker }, i) => ({
      marker,
      top: Math.max(upper, tops[i] ?? 0),
    })),
    ...top.map((marker, i) => ({
      marker,
      top: i * step("top"),
      edge: "top" as const,
    })),
    ...[...bottom].reverse().map((marker, i) => ({
      marker,
      top: height - ICON - (bottom.length - 1 - i) * step("bottom"),
      edge: "bottom" as const,
    })),
  ];
}

/** A GitHub link as its renderer's icon, which shows a pull request's or
 * issue's state where a plugin knows it, with the name it reports. */
function LinkGlyph({
  url,
  registry,
  fallback,
  onName,
  onDescription,
}: {
  url: string;
  registry: ContributionReader<LinkRenderer> | undefined;
  fallback: ReactNode;
  onName(name: string | undefined): void;
  onDescription(description: string | undefined): void;
}) {
  const renderers = useSyncExternalStore(
    registry?.subscribe ?? noRenderers.subscribe,
    registry?.snapshot ?? noRenderers.snapshot,
    registry?.snapshot ?? noRenderers.snapshot,
  );
  const renderer = resolveLink(url, renderers);
  if (!renderer) return fallback;
  const Content = renderer.component;
  return (
    <ContributionBoundary
      key={`${contributionKey(renderer)}:${url}`}
      fallback={fallback}
    >
      <LinkGlyphContext.Provider value={onName}>
        <LinkDescriptionContext.Provider value={onDescription}>
          <Content url={url} />
        </LinkDescriptionContext.Provider>
      </LinkGlyphContext.Provider>
    </ContributionBoundary>
  );
}
const noRenderers = {
  snapshot: () => [],
  subscribe: () => () => {},
};

function Marker({
  marker,
  registry,
  source,
  onJump,
}: {
  marker: SidelineMarker;
  registry: ContributionReader<LinkRenderer> | undefined;
  source: (url: string, size?: "small") => string | undefined;
  onJump(id: string): void;
}) {
  const [name, setName] = useState<string>();
  const [description, setDescription] = useState<string>();
  const link = marker.links[0];
  const media = marker.media[0];
  let kind: string;
  let label: string;
  let face: ReactNode;
  if (link) {
    kind = "github";
    const repo = link.repository.slice(link.repository.indexOf("/") + 1);
    const authored = link.title !== link.repository ? link.title : undefined;
    const shown = name ?? `${repo}${link.label}`;
    label =
      authored && !name?.includes(" · ") ? `${shown} · ${authored}` : shown;
    if (marker.links.length > 1) label += ` (+${marker.links.length - 1})`;
    const Neutral =
      link.kind === "issue" ? GitHubIssueIcon : GitPullRequestIcon;
    face = (
      <span className={styles.glyph}>
        <LinkGlyph
          url={link.url}
          registry={registry}
          fallback={<Neutral aria-hidden="true" />}
          onName={setName}
          onDescription={setDescription}
        />
      </span>
    );
  } else if (media?.kind === "image") {
    kind = "image";
    label = marker.excerpt ? `Image · ${marker.excerpt}` : "Image";
    face = (
      <img
        className={styles.thumbnail}
        src={source(media.url, "small")}
        alt=""
        loading="lazy"
      />
    );
  } else if (media) {
    kind = "video";
    label = marker.excerpt ? `Video · ${marker.excerpt}` : "Video";
    face = media.previewUrl ? (
      <>
        <img
          className={styles.thumbnail}
          src={source(media.previewUrl, "small")}
          alt=""
          loading="lazy"
        />
        <span className={styles.play}>
          <PlayFilledIcon size={8} aria-hidden="true" />
        </span>
      </>
    ) : (
      <span className={styles.glyph}>
        <PlayFilledIcon aria-hidden="true" />
      </span>
    );
  } else {
    kind = "pin";
    label = marker.excerpt || "Pinned message";
    face = (
      <span className={styles.glyph}>
        <PinIcon aria-hidden="true" />
      </span>
    );
  }
  if (marker.pinned && kind !== "pin") label = `Pinned · ${label}`;
  return (
    <Tooltip content={label}>
      <button
        type="button"
        className={styles.marker}
        data-sideline-marker={marker.id}
        data-kind={kind}
        aria-label={`Jump to ${label}`}
        aria-description={description}
        onClick={(event) => {
          event.stopPropagation();
          onJump(marker.id);
        }}
      >
        <span className={styles.face} data-avatar-shape="squircle">
          <span className={styles.art} data-avatar-shape="squircle">
            {face}
          </span>
        </span>
      </button>
    </Tooltip>
  );
}

/** A compressed timeline of a conversation's media, GitHub links and pins in
 * its right margin. It covers the loaded history, scrolls in step with it, and
 * keeps the nearest markers on its edges once they scroll past. */
export function Sideline({
  rows,
  channelId,
  session,
  links,
  scroller,
  handle,
  onJump,
  onSeek,
  onWheel,
}: {
  rows: readonly ChannelMessage[];
  channelId: string;
  session: RelaySession;
  /** The conversation's link renderers, for a GitHub link's state icon. */
  links: ContributionReader<LinkRenderer> | undefined;
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
    const width = WIDTH;
    if (
      margin < width + 24 ||
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
  const [fanned, setFanned] = useState<"top" | "bottom">();
  const placed = frame.visible
    ? placeMarkers(
        markers,
        (marker) => {
          const center = frame.centers.get(marker.id);
          return center === undefined ? undefined : draw(center);
        },
        frame.height,
        fanned,
      )
    : [];
  const trackTop = Math.max(0, draw(0));
  const trackBottom = Math.min(frame.height, draw(frame.extent));
  const bandTop = Math.max(trackTop, draw(frame.offset));
  const bandBottom = Math.min(trackBottom, draw(frame.offset + frame.viewport));
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
      onPointerLeave={() => setFanned(undefined)}
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
              className={styles.line}
              style={{
                top: trackTop,
                height: Math.max(0, trackBottom - trackTop),
              }}
            />
            <span
              className={styles.viewport}
              data-sideline-viewport=""
              style={{
                top: bandTop,
                height: Math.max(0, bandBottom - bandTop),
              }}
            />
          </div>
          {placed.map(({ marker, top, edge }) => (
            <div
              key={marker.id}
              className={styles.slot}
              data-edge={edge}
              style={{ transform: `translateY(${top}px)` }}
              onPointerEnter={() => setFanned(edge)}
            >
              <Marker
                marker={marker}
                registry={links}
                source={source}
                onJump={onJump}
              />
            </div>
          ))}
        </>
      )}
    </aside>
  );
}
