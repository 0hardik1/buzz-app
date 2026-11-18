import {
  backgroundId,
  backgroundKey,
  setHomeBackground,
} from "../../features/home/background";
import { HomeBackground } from "./HomeBackground";
import { HomeConversationPin } from "./HomeConversationPin";
import { ChecklistWidget, FocusWidget, WorldClockWidget } from "./HomeWidgets";
import { BuzzLinkPreview } from "../../features/conversation/BuzzLinkPreview";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { canvasFile } from "../../features/home/canvas-files";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { RelayData } from "../../features/relay/service";
import type { RelaySession } from "../../features/relay/session";
import type { ConversationExtensions } from "../../features/conversation/contracts";
import type { ConversationHostServices } from "../../features/conversation/ConversationHost";
import type { PageNavigation } from "../../features/navigation/service";
import type { OpenTarget } from "../../features/navigation/targets";
import type { InboxItem } from "../../features/relay/inbox";
import {
  useChannelList,
  useChannelWindow,
  useRelayConnection,
} from "../../features/relay/react";
import { splitPartition } from "../../features/relay/partition";
import { useIdentityNames } from "../../features/identity-names/react";
import { EmbeddedConversation } from "../../features/conversation/EmbeddedThread";
import {
  ConversationComposer,
  ConversationThread,
  ConversationTimeline,
} from "../../features/conversation/Conversation";
import { ConversationPresentation } from "../../features/conversation/ConversationPresentation";
import { NewMessage } from "../../features/direct-messages/NewMessage";
import { useSavedAgentState } from "../../features/solo/default-agent";
import { useAgentChoices } from "../../features/agents/use-choices";
import { canMessageAgent } from "../../features/agents/choices";
import { stageBestieRequest } from "./bestie-request";
import { AvatarStack } from "../../shared/design-system/ui/AvatarStack";
import { avatarMedia } from "../../shared/avatar-source";
import { dmLabel } from "../../features/conversation/dm-label";
import type { ChannelSummary } from "../../features/relay/contracts";
import { ChannelAvatar } from "../../features/channels/ChannelAvatar";
import { subscribeView, viewRevision } from "../../shared/view-state";
import { shortTime } from "../../shared/relative-timestamp";
import {
  ArrowSquareOutIcon,
  BestieIcon,
  ImageIcon,
  CheckIcon,
  HouseIcon,
  MessageReplyIcon,
  PaperclipIcon,
  PinIcon,
  PlusIcon,
} from "../../shared/design-system/icons";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Panel } from "../../shared/design-system/ui/Panel";
import {
  PanelHeader,
  PanelHeaderLabel,
} from "../../shared/design-system/ui/PanelHeader";
import { DetailsSheet } from "../../features/messages/DetailsSheet";
import {
  overlayHostFor,
  type ComposerOverlayHost,
} from "../../features/messages/composer-overlay";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { EmptyState } from "../../shared/design-system/ui/EmptyState";
import { LoadingRegion } from "../../shared/design-system/ui/LoadingRegion";
import { Tabs } from "../../shared/design-system/ui/Tabs";
import { Input } from "../../shared/design-system/ui/Input";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import { Calendar } from "../../shared/design-system/ui/Calendar";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import {
  MenuRoot,
  MenuTrigger,
  MenuPopup,
  MenuItem,
} from "../../shared/design-system/ui/Menu";
import {
  hasUnread,
  incompletePreview,
  InboxRowButton,
  rowIdentity,
} from "../inbox/InboxRow";
import { bestieChat } from "../bestie/chat";
import { CanvasObject, ClockWidget, LocalFile } from "./CanvasObject";
import {
  canvasKey,
  readObjects,
  updateObjects,
  type CanvasObject as ObjectValue,
  type Point,
} from "./canvas-state";
import { homeReader, type HomeReader } from "./route";
import styles from "./HomeCanvas.module.css";

type HomeProps = {
  relay: RelayData;
  host: ConversationHostServices;
  extensions: ConversationExtensions;
  navigation?: PageNavigation | undefined;
};
const isHome = (target: OpenTarget) =>
  target.kind === "page" &&
  target.pluginId === "buzz.home" &&
  target.pageId === "home";

export function HomeCanvas(props: HomeProps) {
  const connection = useRelayConnection(props.relay);
  const ready =
    connection.status === "ready" &&
    !!connection.viewer &&
    !!connection.scope?.endsWith(`:${connection.viewer}`);
  return ready && connection.scope ? (
    <ConnectedHome
      key={`${connection.scope}:${connection.generation}`}
      {...props}
      session={connection.session}
      scope={connection.scope}
    />
  ) : (
    <div className={styles.page}>
      <PanelHeader
        title={<PanelHeaderLabel title="Home" icon={<HouseIcon />} />}
      />
      <EmptyState
        icon={<HouseIcon />}
        title={
          connection.status === "connecting"
            ? "Connecting to Home…"
            : "Choose a community to open Home"
        }
        description={
          connection.error ??
          "Your messages, pins, and personal canvas live here."
        }
        action={
          connection.status === "error" ? (
            <Button onClick={props.relay.tryAgain}>Retry connection</Button>
          ) : undefined
        }
      />
    </div>
  );
}

function ConnectedHome({
  session,
  scope,
  ...props
}: HomeProps & { session: RelaySession; scope: string }) {
  const list = useChannelList(session.channels);
  const inbox = useSyncExternalStore(
    session.unread.subscribeInbox,
    session.unread.inbox,
  );
  const feed = useSyncExternalStore(
    session.inboxFeed.subscribe,
    session.inboxFeed.snapshot,
  );
  const profiles = useSyncExternalStore(
    session.profiles.subscribe,
    session.profiles.snapshot,
  );
  const name = useIdentityNames(session.names);
  const saved = useSavedAgentState(session, scope);
  const choices = useAgentChoices(session, true, true);
  const bestie = choices.selectable.find(
    (choice) => choice.pubkey === saved.agent && canMessageAgent(choice),
  );
  const revision = useSyncExternalStore(
    useCallback((notify) => subscribeView(scope, notify), [scope]),
    () => viewRevision(scope, canvasKey),
  );
  const objects = useMemo(() => {
    void revision;
    return readObjects(scope);
  }, [scope, revision]);
  const backgroundRevision = useSyncExternalStore(
    useCallback((notify) => subscribeView(scope, notify), [scope]),
    () => viewRevision(scope, backgroundKey),
  );
  const background = useMemo(() => {
    void backgroundRevision;
    return backgroundId(scope);
  }, [scope, backgroundRevision]);
  const [filter, setFilter] = useState("unread");
  const [error, setError] = useState("");
  const [working, setWorking] = useState<string>();
  const busy = useRef(false);
  const lifetime = useRef<AbortController | null>(null);
  useEffect(() => {
    const owned = new AbortController();
    lifetime.current = owned;
    return () => owned.abort();
  }, []);
  const [pinning, setPinning] = useState(false);
  const [query, setQuery] = useState("");
  const viewport = useRef<HTMLElement>(null);
  const compose = useRef<HTMLDivElement>(null);
  const readerTrigger = useRef<HTMLElement | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const backgroundInput = useRef<HTMLInputElement>(null);
  const world = useRef<HTMLDivElement>(null);
  const [pan, setPan] = useState<Point>({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const panStart = useRef<{
    x: number;
    y: number;
    point: Point;
    last: Point;
    pointerId: number;
  }>(undefined);
  const finishPan = (event: { pointerId: number }) => {
    const gesture = panStart.current;
    if (gesture && gesture.pointerId !== event.pointerId) return;
    panStart.current = undefined;
    if (gesture) setPan(gesture.last);
  };
  const reader = useMemo(
    () =>
      props.navigation?.target.kind === "page"
        ? homeReader(props.navigation.target.route?.params)
        : undefined,
    [props.navigation?.target],
  );
  const [shownReader, setShownReader] = useState(reader);
  if (reader && reader !== shownReader) setShownReader(reader);
  const navigationScope = splitPartition(scope) ?? {
    viewer: session.viewer ?? "",
    communityOrigin: "",
  };
  const base = {
    version: 1,
    kind: "page",
    pluginId: "buzz.home",
    pageId: "home",
    scope: navigationScope,
  } as const;
  const openReader = (next: HomeReader) => {
    readerTrigger.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;
    void props.host.navigation.open({
      ...base,
      route: { version: 1, params: { ...next } },
    });
  };
  const ownsReader = (target: OpenTarget) =>
    isHome(target) &&
    target.kind === "page" &&
    target.scope?.viewer === navigationScope.viewer &&
    target.scope?.communityOrigin === navigationScope.communityOrigin &&
    !!homeReader(target.route?.params);
  const closeReader = () => props.host.navigation.dismiss(ownsReader, base);
  const mutate = (change: (items: ObjectValue[]) => ObjectValue[]) => {
    try {
      updateObjects(scope, change);
      setError("");
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Your canvas could not be saved.",
      );
      return false;
    }
  };
  const objectPoint = (): Point => {
    const width = viewport.current?.clientWidth ?? 1000;
    return { x: (-width / 2 + 24 - pan.x) / scale, y: (32 - pan.y) / scale };
  };
  const add = (
    kind:
      | "attention"
      | "note"
      | "clock"
      | "calendar"
      | "focus"
      | "checklist"
      | "world-clock",
    title: string,
  ) => {
    return mutate((items) =>
      kind === "attention" && items.some((item) => item.kind === "attention")
        ? items
        : [
            ...items,
            {
              id: crypto.randomUUID(),
              kind,
              name: title,
              x: (-152 - pan.x) / scale,
              y: (80 - pan.y) / scale,
            },
          ],
    );
  };
  const accessible = list.channels.filter(
    (channel) =>
      !channel.cached &&
      !channel.archived &&
      !channel.pending &&
      channel.members?.includes(session.viewer ?? ""),
  );
  const channelLabel = (channel: ChannelSummary) =>
    channel.channelType === "dm"
      ? dmLabel(
          channel.participants,
          profiles,
          name,
          channel.name || "Direct message",
        )
      : channel.name || "Conversation";
  const artwork = (channel: ChannelSummary) => {
    if (channel.channelType !== "dm" && channel.channelType !== "solo")
      return <ChannelAvatar name={channelLabel(channel)} size="small" />;
    const keys = (channel.participants ?? channel.members ?? []).filter(
      (key) => key !== session.viewer,
    );
    return (
      <AvatarStack
        size="small"
        items={keys.map((key) => {
          const profile = profiles.get(key);
          const agent = choices.identities.find(
            (choice) => choice.pubkey === key,
          );
          return {
            id: key,
            name: name(key, profile?.name ?? agent?.name ?? "Participant"),
            src: avatarMedia(profile?.picture ?? agent?.avatar, session.media),
            shape:
              profile?.isAgent || agent
                ? ("squircle" as const)
                : ("circle" as const),
          };
        })}
      />
    );
  };
  const rows = [...inbox.items]
    .filter(
      (item) =>
        accessible.some((channel) => channel.id === item.channelId) &&
        (filter !== "unread" || hasUnread(item)) &&
        (filter !== "dms" ||
          accessible.find((channel) => channel.id === item.channelId)
            ?.channelType === "dm"),
    )
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(0, 50);
  const profileIds = [
    ...new Set([
      ...objects
        .filter((object) => object.kind === "pin")
        .flatMap((object) => {
          const channel = list.channels.find(
            (channel) => channel.id === object.channelId,
          );
          return channel?.participants ?? channel?.members ?? [];
        }),
      ...rows.flatMap((item) => [
        item.authorId,
        ...(accessible.find((channel) => channel.id === item.channelId)
          ?.participants ?? []),
      ]),
    ]),
  ]
    .sort()
    .join(":");
  useEffect(() => {
    if (profileIds)
      void session.profiles
        .ensure(profileIds.split(":"), "background")
        .catch(() => {});
  }, [session, profileIds]);
  useEffect(() => {
    void list.asOf;
    if (list.status === "ready") {
      void session.unread.ensure();
      void session.inboxFeed.ensure();
    }
  }, [session, list.status, list.asOf]);
  const refresh = () => {
    session.channels.ensureList();
    void Promise.all([
      session.unread.refresh(),
      session.inboxFeed.refresh(),
    ]).catch((cause) => setError(String(cause)));
  };
  const pending =
    list.status === "idle" ||
    list.status === "loading" ||
    inbox.status === "idle" ||
    inbox.status === "loading" ||
    feed.status === "loading";
  const failure = list.error ?? inbox.error ?? feed.error;
  const act = async (
    id: string,
    operation: (signal: AbortSignal) => Promise<void>,
  ) => {
    if (busy.current || !lifetime.current) return;
    const signal = lifetime.current.signal;
    busy.current = true;
    setWorking(id);
    setError("");
    try {
      await operation(signal);
    } catch (cause) {
      if (!signal.aborted)
        setError(
          cause instanceof Error
            ? cause.message
            : "That action could not be completed.",
        );
    } finally {
      busy.current = false;
      if (!signal.aborted) setWorking(undefined);
    }
  };
  const askBestie = (item: InboxItem) =>
    act(item.id, async (signal) => {
      if (!bestie || !saved.read || saved.error)
        throw new Error("Choose an available Bestie before asking for help.");
      const channelId =
        bestieChat(
          session.channels.list().channels,
          session.viewer,
          bestie.pubkey,
        )?.id ?? (await session.directMessages.open([bestie.pubkey], signal));
      signal.throwIfAborted();
      if (
        !session.agentChoices
          .snapshot()
          .selectable.some(
            (choice) =>
              choice.pubkey === bestie.pubkey && canMessageAgent(choice),
          )
      )
        throw new Error("Your Bestie is no longer available.");
      stageBestieRequest(
        scope,
        channelId,
        item.channelId,
        item.previewMessageId ?? item.messageId,
      );
      openReader({
        channelId,
        source: {
          channelId: item.channelId,
          messageId: item.previewMessageId ?? item.messageId,
        },
      });
    });
  const addFiles = (files: readonly File[], point = objectPoint()) =>
    act("files", async (signal) => {
      for (const [index, file] of files.entries()) {
        signal.throwIfAborted();
        if (file.size > 100 * 1024 * 1024)
          throw new Error(
            `${file.name} is larger than the 100 MB canvas limit.`,
          );
        const id = crypto.randomUUID();
        await canvasFile(scope, id, file);
        if (signal.aborted) {
          await canvasFile(scope, id, null);
          signal.throwIfAborted();
        }
        if (
          !mutate((items) => [
            ...items,
            {
              id,
              kind: "file",
              name: file.name,
              x: point.x + index * 24,
              y: point.y + index * 24,
            },
          ])
        ) {
          await canvasFile(scope, id, null);
          return;
        }
      }
    });
  const remove = (object: ObjectValue) => {
    if (
      mutate((items) => items.filter((item) => item.id !== object.id)) &&
      object.kind === "file"
    )
      void canvasFile(scope, object.id, null).catch(() =>
        setError(
          "The card was removed, but its local file could not be deleted.",
        ),
      );
  };
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;
    const wheel = (event: WheelEvent) => {
      if ((event.target as Element).closest("[data-canvas-object]")) return;
      event.preventDefault();
      if (event.ctrlKey || event.metaKey)
        setScale((value) =>
          Math.max(0.5, Math.min(1.5, value - event.deltaY * 0.005)),
        );
      else
        setPan((value) => ({
          x: value.x - event.deltaX,
          y: value.y - event.deltaY,
        }));
    };
    element.addEventListener("wheel", wheel, { passive: false });
    return () => element.removeEventListener("wheel", wheel);
  }, []);
  return (
    <div className={styles.page}>
      <div className={styles.canvasControls}>
        <PanelHeader
          title={null}
          actions={
            <>
              <MenuRoot>
                <MenuTrigger
                  render={
                    <IconButton
                      aria-label="Home background"
                      icon={<ImageIcon />}
                      disabled={!!working}
                    />
                  }
                />
                <MenuPopup>
                  <MenuItem onClick={() => backgroundInput.current?.click()}>
                    Choose background image
                  </MenuItem>
                  {background && (
                    <MenuItem
                      onClick={() =>
                        void act("background", (signal) =>
                          setHomeBackground(scope, null, signal),
                        )
                      }
                    >
                      Remove background image
                    </MenuItem>
                  )}
                </MenuPopup>
              </MenuRoot>
              <IconButton
                aria-label="Add files to canvas"
                icon={<PaperclipIcon />}
                onClick={() => fileInput.current?.click()}
                disabled={!!working}
              />
              <MenuRoot>
                <MenuTrigger
                  render={
                    <IconButton
                      aria-label="Add to canvas"
                      icon={<PlusIcon />}
                    />
                  }
                />
                <MenuPopup>
                  <MenuItem
                    disabled={objects.some(
                      (object) => object.kind === "attention",
                    )}
                    onClick={() => add("attention", "For you")}
                  >
                    For you
                  </MenuItem>
                  <MenuItem onClick={() => add("focus", "Focus")}>
                    Focus timer
                  </MenuItem>
                  <MenuItem onClick={() => add("checklist", "Little list")}>
                    Checklist
                  </MenuItem>
                  <MenuItem onClick={() => add("world-clock", "Elsewhere")}>
                    World clock
                  </MenuItem>
                  <MenuItem onClick={() => add("note", "Note")}>Note</MenuItem>
                  <MenuItem onClick={() => setPinning(true)}>
                    Conversation pin
                  </MenuItem>
                  <MenuItem onClick={() => add("clock", "Clock")}>
                    Clock
                  </MenuItem>
                  <MenuItem onClick={() => add("calendar", "Calendar")}>
                    Calendar
                  </MenuItem>
                </MenuPopup>
              </MenuRoot>
            </>
          }
        />
      </div>
      {(error || failure) && (
        <div className={styles.notice} role="alert">
          <p className="text-body">{error || failure}</p>
          <Button size="sm" onClick={refresh}>
            Retry
          </Button>
        </div>
      )}
      <input
        hidden
        type="file"
        accept="image/jpeg,image/png,image/webp,image/avif,image/gif"
        ref={backgroundInput}
        aria-label="Choose Home background"
        onChange={(event) => {
          const file = event.target.files?.[0];
          event.target.value = "";
          if (file)
            void act("background", (signal) =>
              setHomeBackground(scope, file, signal),
            );
        }}
      />
      <input
        hidden
        type="file"
        multiple
        ref={fileInput}
        aria-label="Choose canvas files"
        onChange={(event) => {
          void addFiles(Array.from(event.target.files ?? []));
          event.target.value = "";
        }}
      />
      <section
        ref={viewport}
        className={styles.viewport}
        data-composer-host=""
        data-details-sheet-surface=""
        aria-label="Home canvas"
        data-attachment-drop-zone=""
        onDragOver={(event) => {
          if ((event.target as Element).closest("[data-home-compose]")) return;
          if (event.dataTransfer.types.includes("Files")) {
            event.preventDefault();
            event.dataTransfer.dropEffect = "copy";
          }
        }}
        onDrop={(event) => {
          if ((event.target as Element).closest("[data-home-compose]")) return;
          event.preventDefault();
          event.stopPropagation();
          const rect = event.currentTarget.getBoundingClientRect();
          void addFiles(Array.from(event.dataTransfer.files), {
            x: (event.clientX - rect.left - rect.width / 2 - pan.x) / scale,
            y: (event.clientY - rect.top - pan.y) / scale,
          });
        }}
        onPointerDown={(event) => {
          if (
            event.button !== 0 ||
            !event.currentTarget.contains(event.target as Node) ||
            panStart.current ||
            (event.target as Element).closest(
              "[data-canvas-object],button,input,textarea,a",
            )
          )
            return;
          event.currentTarget.setPointerCapture(event.pointerId);
          panStart.current = {
            x: event.clientX,
            y: event.clientY,
            point: pan,
            last: pan,
            pointerId: event.pointerId,
          };
        }}
        onPointerMove={(event) => {
          const start = panStart.current;
          if (!start || start.pointerId !== event.pointerId || !world.current)
            return;
          if (Math.hypot(event.clientX - start.x, event.clientY - start.y) < 4)
            return;
          start.last = {
            x: start.point.x + event.clientX - start.x,
            y: start.point.y + event.clientY - start.y,
          };
          world.current.style.transform = `translate(${start.last.x}px, ${start.last.y}px) scale(${scale})`;
        }}
        onPointerUp={finishPan}
        onLostPointerCapture={finishPan}
      >
        <HomeBackground scope={scope} id={background} failed={setError} />
        <div
          className={styles.world}
          data-covered={reader || pinning ? true : undefined}
          ref={world}
          style={{
            transform: `translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
          }}
        >
          {objects.map((object) => {
            const channel = list.channels.find(
              (item) => item.id === object.channelId,
            );
            if (
              object.kind === "pin" &&
              channel &&
              (channel.channelType === "dm" || channel.channelType === "solo")
            ) {
              const keys = (
                channel.participants ??
                channel.members ??
                []
              ).filter((key) => key !== session.viewer);
              if (!keys.length && session.viewer) keys.push(session.viewer);
              return (
                <HomeConversationPin
                  key={object.id}
                  object={object}
                  label={channelLabel(channel)}
                  portraits={keys.map((key) => {
                    const profile = profiles.get(key);
                    const agent = choices.identities.find(
                      (choice) => choice.pubkey === key,
                    );
                    return {
                      id: key,
                      name: name(
                        key,
                        profile?.name ?? agent?.name ?? "Participant",
                      ),
                      picture: profile?.picture ?? agent?.avatar,
                      agent: !!(profile?.isAgent || agent),
                    };
                  })}
                  media={session.media}
                  scale={scale}
                  available={accessible.some((item) => item.id === channel.id)}
                  move={(point) =>
                    mutate((items) =>
                      items.map((item) =>
                        item.id === object.id ? { ...item, ...point } : item,
                      ),
                    )
                  }
                  resize={(pinSize) =>
                    mutate((items) =>
                      items.map((item) =>
                        item.id === object.id ? { ...item, pinSize } : item,
                      ),
                    )
                  }
                  open={() => openReader({ channelId: channel.id })}
                  remove={() => remove(object)}
                />
              );
            }
            if (object.kind === "file")
              return (
                <LocalFile
                  key={object.id}
                  scope={scope}
                  object={object}
                  scale={scale}
                  move={(point) =>
                    mutate((items) =>
                      items.map((item) =>
                        item.id === object.id ? { ...item, ...point } : item,
                      ),
                    )
                  }
                  remove={() => remove(object)}
                />
              );
            return (
              <CanvasObject
                key={object.id}
                object={object}
                scale={scale}
                move={(point) =>
                  mutate((items) =>
                    items.map((item) =>
                      item.id === object.id ? { ...item, ...point } : item,
                    ),
                  )
                }
                remove={() => remove(object)}
              >
                {object.kind === "attention" ? (
                  <div className={styles.feedBody}>
                    <Tabs
                      value={filter}
                      onValueChange={setFilter}
                      variant="segmented"
                      label="Attention filter"
                      items={[
                        { value: "unread", label: "For you" },
                        { value: "recent", label: "Recent" },
                        { value: "dms", label: "Messages" },
                      ]}
                    />
                    <div className={styles.feedScroll}>
                      <LoadingRegion
                        pending={pending}
                        label="Checking your activity…"
                      >
                        {rows.map((item) => (
                          <div className={styles.attention} key={item.id}>
                            <InboxRowButton
                              item={item}
                              identity={rowIdentity(
                                item,
                                accessible.find(
                                  (channel) => channel.id === item.channelId,
                                ),
                                profiles,
                                name,
                              )}
                              media={session.media}
                              feed={feed}
                              time={shortTime(item.createdAt)}
                              onClick={() =>
                                openReader({
                                  channelId: item.channelId,
                                  messageId: item.messageId,
                                })
                              }
                            />
                            <div className={styles.actions}>
                              <IconButton
                                aria-label="Mark this update read"
                                icon={<CheckIcon />}
                                disabled={
                                  !hasUnread(item) ||
                                  !!working ||
                                  !session.unread.markCapturedMessagesRead
                                }
                                onClick={() =>
                                  void act(item.id, async () => {
                                    await session.unread.markCapturedMessagesRead?.(
                                      item.messageIds,
                                    );
                                  })
                                }
                              />
                              <span className={styles.spacer} />
                              <IconButton
                                aria-label="Reply without leaving Home"
                                icon={<MessageReplyIcon />}
                                onClick={() =>
                                  openReader({
                                    channelId: item.channelId,
                                    messageId: item.messageId,
                                  })
                                }
                              />
                              <Button
                                size="sm"
                                variant="subtle"
                                loading={working === item.id}
                                disabled={
                                  !!working ||
                                  !bestie ||
                                  !!incompletePreview(feed, [
                                    item.messageId,
                                    item.previewMessageId,
                                  ])
                                }
                                title={
                                  !bestie
                                    ? "Choose a Bestie in the Bestie view first"
                                    : undefined
                                }
                                onClick={() => void askBestie(item)}
                              >
                                <BestieIcon size={16} />
                                Ask Bestie
                              </Button>
                            </div>
                          </div>
                        ))}
                        {!rows.length && !pending && !failure && (
                          <EmptyState
                            icon={<CheckIcon />}
                            title={
                              filter === "unread"
                                ? "You're all caught up"
                                : "No recent messages"
                            }
                            description="Mentions, direct messages, and thread replies appear here."
                          />
                        )}
                      </LoadingRegion>
                    </div>
                  </div>
                ) : object.kind === "focus" ||
                  object.kind === "checklist" ||
                  object.kind === "world-clock" ? (
                  (() => {
                    const Widget =
                      object.kind === "focus"
                        ? FocusWidget
                        : object.kind === "checklist"
                          ? ChecklistWidget
                          : WorldClockWidget;
                    return (
                      <Widget
                        object={object}
                        change={(patch) =>
                          mutate((items) =>
                            items.map((item) =>
                              item.id === object.id
                                ? { ...item, ...patch }
                                : item,
                            ),
                          )
                        }
                      />
                    );
                  })()
                ) : object.kind === "clock" ? (
                  <ClockWidget />
                ) : object.kind === "calendar" ? (
                  <Calendar mode="single" defaultMonth={new Date()} />
                ) : object.kind === "note" ? (
                  <Textarea
                    aria-label="Note"
                    rows={5}
                    defaultValue={object.text ?? ""}
                    placeholder="Keep a thought here…"
                    onChange={(event) => {
                      const text = event.currentTarget.value;
                      mutate((items) =>
                        items.map((item) =>
                          item.id === object.id ? { ...item, text } : item,
                        ),
                      );
                    }}
                  />
                ) : (
                  <NavigationItem
                    label={(() => {
                      const channel = accessible.find(
                        (channel) => channel.id === object.channelId,
                      );
                      return channel
                        ? channelLabel(channel)
                        : "Conversation unavailable";
                    })()}
                    icon={(() => {
                      const channel = accessible.find(
                        (channel) => channel.id === object.channelId,
                      );
                      return channel ? artwork(channel) : <PinIcon />;
                    })()}
                    disabled={
                      !accessible.some(
                        (channel) => channel.id === object.channelId,
                      )
                    }
                    onClick={() =>
                      object.channelId &&
                      openReader({ channelId: object.channelId })
                    }
                  />
                )}
              </CanvasObject>
            );
          })}
        </div>
        <div
          ref={compose}
          className={styles.compose}
          data-home-compose=""
          data-covered={reader || undefined}
          data-canvas-object=""
          data-attachment-drop-zone=""
        >
          <div className={styles.composeBody}>
            <ConversationPresentation value={!reader}>
              <NewMessage
                session={session}
                scope={scope}
                host={props.host}
                extensions={props.extensions}
                channels={list.channels}
                allowChannels
                presentation="discovery"
                recipientPresentation="on-demand"
                autoFocus={false}
                solo={{ onStarted: (channelId) => openReader({ channelId }) }}
                onOpenChat={(channelId) => openReader({ channelId })}
                onOpenThread={(channelId, messageId) =>
                  openReader({ channelId, messageId })
                }
                onStarted={(channelId) => openReader({ channelId })}
              />
            </ConversationPresentation>
          </div>
        </div>
        {(working === "files" || working === "background") && (
          <div className={styles.fileStatus} role="status">
            <Panel>
              <p className="text-body">
                {working === "background"
                  ? "Saving your background…"
                  : "Saving files on this device…"}
              </p>
            </Panel>
          </div>
        )}
      </section>
      {shownReader && (
        <HomeReaderSurface
          reader={shownReader}
          open={!!reader}
          compose={compose}
          trigger={readerTrigger}
          close={closeReader}
          closed={() => setShownReader(undefined)}
          title={
            shownReader.source
              ? "Ask Bestie"
              : channelLabel(
                  accessible.find(
                    (channel) => channel.id === shownReader.channelId,
                  ) ?? { id: shownReader.channelId, name: "Conversation" },
                )
          }
          openFull={() =>
            props.host.navigation.dismiss(ownsReader, {
              version: 1,
              kind: "conversation",
              scope: navigationScope,
              ...shownReader,
            })
          }
        >
          {accessible.some(
            (channel) => channel.id === shownReader.channelId,
          ) ? (
            <HomeConversation
              key={`${shownReader.channelId}:${shownReader.messageId ?? "timeline"}`}
              reader={shownReader}
              session={session}
              scope={scope}
              host={props.host}
              extensions={props.extensions}
              openReader={openReader}
              close={closeReader}
            />
          ) : (
            <EmptyState
              icon={<HouseIcon />}
              title="Conversation unavailable"
              description="It may have been archived or you may no longer be a member."
            />
          )}
        </HomeReaderSurface>
      )}
      <Dialog
        open={pinning}
        onOpenChange={setPinning}
        title="Pin a conversation"
        description="Keep a DM, channel, or Solo chat on your canvas."
      >
        <div className={styles.stack}>
          <Input
            aria-label="Search conversations to pin"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
          {accessible
            .filter((channel) =>
              channelLabel(channel).toLowerCase().includes(query.toLowerCase()),
            )
            .slice(0, 50)
            .map((channel) => (
              <NavigationItem
                key={channel.id}
                label={channelLabel(channel)}
                icon={artwork(channel)}
                onClick={() => {
                  if (
                    mutate((items) => [
                      ...items,
                      {
                        id: crypto.randomUUID(),
                        kind: "pin",
                        name: channel.name || "Pinned conversation",
                        channelId: channel.id,
                        ...objectPoint(),
                      },
                    ])
                  )
                    setPinning(false);
                }}
              />
            ))}
        </div>
      </Dialog>
    </div>
  );
}

function HomeReaderSurface({
  reader,
  open,
  compose,
  trigger,
  close,
  closed,
  title,
  openFull,
  children,
}: {
  reader: HomeReader;
  open: boolean;
  compose: import("react").RefObject<HTMLDivElement | null>;
  trigger: import("react").RefObject<HTMLElement | null>;
  close(): void;
  closed(): void;
  title: string;
  openFull(): void;
  children: import("react").ReactNode;
}) {
  const [host, setHost] = useState<ComposerOverlayHost | null>();
  // First-message delivery can replace the source editor in the same commit.
  // Resolve its registered host after refs attach, before the sheet is painted.
  useLayoutEffect(() => {
    if (open)
      setHost(
        overlayHostFor(
          compose.current?.querySelector("[data-message-composer]") ?? null,
        ),
      );
  }, [open, compose]);
  if (host === undefined) return null;
  const actions = (
    <IconButton
      aria-label="Open full conversation"
      icon={<ArrowSquareOutIcon />}
      onClick={openFull}
    />
  );
  if (host)
    return (
      <DetailsSheet
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
        onClosed={closed}
        host={host}
        title={title}
        containsComposer
        finalFocus={trigger}
        headerActions={actions}
      >
        {children}
      </DetailsSheet>
    );
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) closed();
      }}
      title={title}
      size="wide"
      height={reader.source ? "content" : "stable-tall"}
      bodyLayout="flex"
      visit
      headerActions={actions}
    >
      {children}
    </Dialog>
  );
}

function HomeConversation({
  reader,
  session,
  scope,
  host,
  extensions,
  openReader,
  close,
}: {
  reader: HomeReader;
  session: RelaySession;
  scope: string;
  host: ConversationHostServices;
  extensions: ConversationExtensions;
  openReader(reader: HomeReader): void;
  close(): void;
}) {
  return (
    <div
      className={styles.conversation}
      data-composer-host=""
      data-details-sheet-surface=""
    >
      <EmbeddedConversation
        session={session}
        scope={scope}
        channelId={reader.channelId}
        threadId={reader.messageId}
        host={host}
        extensions={extensions}
      >
        {() =>
          reader.messageId ? (
            <ConversationThread
              messageId={reader.messageId}
              active={false}
              tabbed
              retainThread
            />
          ) : (
            <>
              {reader.source && (
                <div className={styles.sourceContext}>
                  <InlineHeader title="Asking Bestie about" />
                  <BuzzLinkPreview
                    session={session}
                    channelId={reader.source.channelId}
                    messageId={reader.source.messageId}
                  />
                </div>
              )}
              {!reader.source && (
                <HomeHistory
                  session={session}
                  channelId={reader.channelId}
                  openReader={openReader}
                />
              )}
              <ConversationComposer
                autoFocus={!!reader.source}
                {...(reader.source ? { onSend: close } : {})}
              />
            </>
          )
        }
      </EmbeddedConversation>
    </div>
  );
}

function HomeHistory({
  session,
  channelId,
  openReader,
}: {
  session: RelaySession;
  channelId: string;
  openReader(reader: HomeReader): void;
}) {
  const window = useChannelWindow(session.channels, channelId);
  return (
    <div className={styles.history}>
      <ConversationTimeline
        window={window}
        marksRead={false}
        onOpenThread={(messageId) => openReader({ channelId, messageId })}
      />
    </div>
  );
}
