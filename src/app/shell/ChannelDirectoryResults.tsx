import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { channelIcon } from "../../features/channels/channel-icon";
import {
  useChannelDirectory,
  useMemberCounts,
} from "../../features/channels/useChannelDirectory";
import { useChannelRoster } from "../../features/relay/react";
import type { RelaySession } from "../../features/relay/session";
import { matchName } from "../../features/search/match";
import { MatchedLabel } from "../../features/search/MatchedLabel";
import { joinFailure } from "../../features/messages/ChannelJoinNotice";
import { UserIcon } from "../../shared/design-system/icons";
import { Button } from "../../shared/design-system/ui/Button";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { PreferenceRow } from "../../shared/design-system/ui/PreferenceRow";
import type { ChannelSummary } from "../../features/relay/contracts";
import {
  SearchChoices,
  type SearchDestination,
  type SearchInputProps,
  type SearchViews,
} from "./SearchChoices";

const collator = new Intl.Collator();
/** Rows drawn at first, and added each time the last ones near the view:
 * the list looks whole, without thousands of rows to lay out at once. */
const FIRST_ROWS = 100;
const MORE_ROWS = 100;
const GROW_AHEAD = 25;

/** A Join started from the list, until the list closes. */
type Join =
  | { status: "pending" }
  | { status: "joined" }
  | { status: "failed"; error: string };

/** Read-only isn't unjoined: guests and cached channels are members too.
 * The same rule as All's "Public channel · not joined". */
const isMember = (channel: ChannelSummary) =>
  !channel.readOnly || !!channel.cached || channel.viewerRole === "guest";

/** Browse channels, opened from the sidebar: one plain list, not the whole of
 * search. With nothing typed it lists the open channels the viewer can join,
 * A–Z. Typed text matches those and the viewer's own channels, which say
 * they're joined, so a joined name is never a dead end. */
export function ChannelDirectoryResults({
  session,
  query,
  onQueryChange,
  input,
  open,
  views,
  openConversation,
  openPreview,
}: Pick<SearchInputProps, "query" | "onQueryChange" | "input" | "open"> & {
  session: RelaySession;
  views: SearchViews;
  openConversation: (channelId: string) => void;
  /** Opens an open channel's read-only preview, where Join lives. */
  openPreview: (channelId: string) => void;
}) {
  const list = useChannelRoster(session.channels);
  const ready = list.status === "ready";
  const directory = useChannelDirectory(session.channels, ready);
  const members = useMemberCounts(session.channels);
  const needle = query.trim().toLowerCase().replace(/^#/, "");
  // Join from the list, as the preview does: a joined row keeps its place,
  // saying Joined, so the next one is where it was.
  const lifecycle = session.channelLifecycle;
  const [joins, setJoins] = useState<ReadonlyMap<string, Join>>(new Map());
  const joining = useRef(new Map<string, AbortController>());
  useEffect(() => {
    const running = joining.current;
    return () => {
      for (const controller of running.values()) controller.abort();
    };
  }, []);
  // The lifecycle runs one channel action at a time, so while a Join runs
  // the others wait, disabled, rather than fail.
  const busy = [...joins.values()].some(({ status }) => status === "pending");
  // Focus on a Join its row drops, joined or once membership shows after an
  // unconfirmed Join, returns to the field, which owns keyboard navigation.
  // Focus moved elsewhere forgets the Join; a removal moves it nowhere.
  const focusedJoin = useRef<HTMLElement | null>(null);
  useLayoutEffect(() => {
    if (!focusedJoin.current || focusedJoin.current.isConnected) return;
    focusedJoin.current = null;
    input.current?.focus();
  });
  const settle = (channelId: string, join: Join) =>
    setJoins((current) => new Map(current).set(channelId, join));
  const join = (channelId: string) => {
    if (!lifecycle?.available || busy) return;
    joining.current.get(channelId)?.abort();
    const controller = new AbortController();
    joining.current.set(channelId, controller);
    settle(channelId, { status: "pending" });
    // Closing the list cancels a Join not yet sent. A sent one finishes, so
    // the channel it joined lists; the closed list just ignores the result.
    lifecycle
      .run("join", channelId, undefined, () => !controller.signal.aborted)
      .then(
        () => {
          if (!controller.signal.aborted)
            settle(channelId, { status: "joined" });
        },
        (reason: unknown) => {
          if (!controller.signal.aborted)
            settle(channelId, {
              status: "failed",
              error: joinFailure(reason, "channel"),
            });
        },
      );
  };
  const { joined, member } = useMemo(
    () => ({
      joined: list.channels.filter(
        (channel) =>
          isMember(channel) &&
          !channel.archived &&
          !channel.huddle &&
          !channel.metadataPending &&
          (channel.channelType === "stream" || channel.channelType === "forum"),
      ),
      member: new Set(
        list.channels.filter(isMember).map((channel) => channel.id),
      ),
    }),
    [list.channels],
  );
  // Channels to join hold their places while later pages land: each page's
  // new rows join below the ones already shown, A–Z among themselves. A view
  // opened on a finished read is A–Z throughout. Joined matches, listed only
  // for typed text, follow them, so landing rows move only those down.
  const arrival = useRef({
    directory: directory.directory,
    page: 0,
    seen: new Map<string, number>(),
  });
  if (arrival.current.directory !== directory.directory) {
    arrival.current.directory = directory.directory;
    arrival.current.page += 1;
  }
  // Every directory row takes the page it first landed on, before any
  // filtering or sorting; joined rows, after them, are A–Z.
  for (const channel of directory.directory)
    if (!arrival.current.seen.has(channel.id))
      arrival.current.seen.set(channel.id, arrival.current.page);
  const landed = ({
    channel,
    joined,
  }: {
    channel: ChannelSummary;
    joined: boolean;
  }) =>
    joined ? 0 : (arrival.current.seen.get(channel.id) ?? arrival.current.page);
  // Sorted once per directory, query or roster change; counts and other
  // renders reuse it.
  // biome-ignore lint/correctness/useExhaustiveDependencies: `landed` reads the arrival ref the directory keys.
  const rows = useMemo(
    () =>
      [
        ...(needle
          ? joined
              // Joined from this list: already listed, in its place.
              .filter((channel) => !joins.has(channel.id))
              .map((channel) => ({ channel, joined: true }) as const)
          : []),
        ...directory.directory
          .filter(
            (channel) =>
              !channel.archived &&
              (!member.has(channel.id) || joins.has(channel.id)),
          )
          .map((channel) => ({ channel, joined: false }) as const),
      ]
        .flatMap((row) => {
          const match = needle
            ? matchName(row.channel.name, needle)
            : undefined;
          return !needle || match ? [{ ...row, match }] : [];
        })
        .sort(
          (a, b) =>
            (a.match?.rank ?? 0) - (b.match?.rank ?? 0) ||
            // Among equal matches, the channels to join lead: they're what
            // the list is for, and joined ones are marked and A–Z after them.
            Number(a.joined) - Number(b.joined) ||
            landed(a) - landed(b) ||
            collator.compare(a.channel.name, b.channel.name) ||
            a.channel.id.localeCompare(b.channel.id),
        ),
    [directory.directory, needle, joined, member, joins],
  );
  // A kept place reopens with its row drawn.
  const placed = () => {
    const key = views.place.anchor?.key ?? views.place.key;
    const index = key
      ? rows.findIndex(({ channel }) => `directory:${channel.id}` === key)
      : -1;
    return Math.max(FIRST_ROWS, index + MORE_ROWS);
  };
  const [drawing, setDrawing] = useState(() => ({
    needle,
    rows: placed(),
  }));
  // New typed text starts from the top, so it draws the first rows again.
  const drawn = drawing.needle === needle ? drawing.rows : FIRST_ROWS;
  const keyIndex = useMemo(
    () =>
      new Map(
        rows.map(({ channel }, index) => [`directory:${channel.id}`, index]),
      ),
    [rows],
  );
  const grow = (keys: readonly string[]) => {
    if (drawn >= rows.length) return;
    if (keys.some((key) => (keyIndex.get(key) ?? -1) >= drawn - GROW_AHEAD))
      setDrawing({ needle, rows: drawn + MORE_ROWS });
  };
  const destinations: SearchDestination[] = rows
    .slice(0, drawn)
    .map(({ channel, joined, match }) => {
      const people = members.counts.get(channel.id);
      const state = joins.get(channel.id);
      // Membership says Joined, so a Join that may not have landed is Joined
      // once it shows, and a row whose membership is then removed offers
      // Join again rather than a channel it can't open.
      const isJoined = joined || member.has(channel.id);
      const failure = state?.status === "failed" && !isJoined;
      // Shown after the name; the count has its own slot at the row's end.
      const about = [isJoined && "Joined", channel.description]
        .filter(Boolean)
        .join(" · ");
      // The row's accessible description: everything, the count included.
      const detail = failure
        ? state.error
        : [
            isJoined && "Joined",
            people !== undefined &&
              `${people.toLocaleString()} ${people === 1 ? "member" : "members"}`,
            channel.description,
          ]
            .filter(Boolean)
            .join(" · ");
      const Icon = channelIcon(channel);
      return {
        key: `directory:${channel.id}`,
        label: channel.name,
        ...(detail ? { detail } : {}),
        icon: Icon,
        content: (
          <PreferenceRow
            variant="search-compact"
            icon={<Icon size={21} />}
            // One line, the name first: details give way at the edge.
            title={
              <span className="flex min-w-0 gap-2">
                <span className="max-w-[60%] shrink-0 truncate">
                  <MatchedLabel
                    label={channel.name}
                    positions={match?.positions}
                  />
                </span>
                {about && (
                  <span className="min-w-0 truncate text-subtle">{about}</span>
                )}
              </span>
            }
            // A failure says what to do next, so it wraps on a line of its
            // own rather than being cut off; a retry makes the row one line.
            subtitle={
              failure && (
                <span className="text-danger" role="alert">
                  {state.error}
                </span>
              )
            }
            trailing={
              <>
                {
                  // Membership can show before the Join settles; the button
                  // stays, loading, until then.
                  (!isJoined || state?.status === "pending") &&
                    lifecycle?.available && (
                      // Shown on hover or highlight, and kept while joining
                      // or after a failure.
                      <span
                        data-search-reveal={
                          state?.status === "pending" || failure
                            ? undefined
                            : ""
                        }
                      >
                        <Button
                          onFocus={(event) => {
                            focusedJoin.current = event.currentTarget;
                          }}
                          onBlur={(event) => {
                            if (event.relatedTarget) focusedJoin.current = null;
                          }}
                          size="xs"
                          variant="outline"
                          aria-label={`Join ${channel.name}`}
                          loading={state?.status === "pending"}
                          disabled={busy && state?.status !== "pending"}
                          onClick={() => join(channel.id)}
                        >
                          Join
                        </Button>
                      </span>
                    )
                }
                {/* Counts arrive after their rows; the slot's width is held
                    from the start, so neither the line nor the column moves. */}
                <span
                  className="search-palette-count text-body-sm text-subtle"
                  aria-hidden="true"
                >
                  {people !== undefined && (
                    <>
                      <UserIcon size={14} />
                      {people.toLocaleString()}
                    </>
                  )}
                </span>
              </>
            }
          />
        ),
        run: () =>
          isJoined ? openConversation(channel.id) : openPreview(channel.id),
      };
    });
  const failed = list.status === "error" || directory.error;
  const settled = ready && !directory.loading && !failed;
  const count = rows.length;
  // One polite summary once a switch or filter settles, not per keystroke.
  const summary = settled
    ? needle
      ? `${count} ${count === 1 ? "channel matches" : "channels match"}`
      : `${count} ${count === 1 ? "channel" : "channels"} you can join`
    : "";
  const [announced, setAnnounced] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setAnnounced(summary), 500);
    return () => clearTimeout(timer);
  }, [summary]);
  const retry = () => {
    if (list.status === "error")
      void (session.channels.refreshList
        ? session.channels.refreshList()
        : session.channels.ensureList());
    else directory.retry();
    input.current?.focus();
  };
  return (
    <SearchChoices
      query={query}
      onQueryChange={onQueryChange}
      input={input}
      open={open}
      label="Search channels"
      placeholder="Search channels"
      views={views}
      fill
      highlightEmpty
      // Counts fill in for the rows in view, after the rows themselves.
      onRowsShown={(keys) => {
        members.show(keys.map((key) => key.slice("directory:".length)));
        grow(keys);
      }}
      groups={[
        {
          // Typed results sit under the Channels tab that names them.
          label: needle ? "Channels" : "Channels you can join",
          hideLabel: !!needle,
          destinations,
          total: count,
        },
      ]}
    >
      <p className="sr-only" aria-live="polite">
        {announced}
      </p>
      {count ? (
        <div
          className="space-y-2 px-3 text-body-sm text-subtle"
          aria-live="polite"
        >
          {failed && (
            <div>
              <p>Couldn’t load all channels.</p>
              <Button size="sm" variant="ghost" onClick={retry}>
                Retry channels
              </Button>
            </div>
          )}
          {settled && directory.partial && (
            <p>Only the newest open channels are shown.</p>
          )}
          {/* The first page shows at once; the rest join it as they land. */}
          {directory.loading && !failed && <p>Loading more channels…</p>}
        </div>
      ) : (
        // Nothing to list: the message takes the reserved results space.
        <div className="search-palette-centered" aria-live="polite">
          {failed ? (
            <>
              <p>Couldn’t load channels.</p>
              <Button size="sm" variant="ghost" onClick={retry}>
                Retry channels
              </Button>
            </>
          ) : settled ? (
            needle ? (
              <>
                <p>No matching channels.</p>
                <p>Private channels show up once someone invites you.</p>
              </>
            ) : (
              <p>
                {directory.partial
                  ? // A capped read can't say nothing else is left to join.
                    "You’ve joined all of the newest open channels."
                  : "You’ve joined every open channel."}
              </p>
            )
          ) : (
            // Rows show from the first page; this waits a second first.
            <LoadingRegion pending label="Loading channels…">
              {null}
            </LoadingRegion>
          )}
        </div>
      )}
    </SearchChoices>
  );
}
