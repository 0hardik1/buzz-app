import { MessageLoading } from "../../features/messages/MessageLoading";
import { DetailsSheet } from "../../features/messages/DetailsSheet";
import {
  InlineThreadIntro,
  type InlineThreadIntroStep,
  inlineThreadIntroSeen,
  markInlineThreadIntroSeen,
} from "../../features/messages/InlineThreadIntro";
import {
  overlayHostFor,
  type ComposerOverlayHost,
} from "../../features/messages/composer-overlay";
import { useConversationPresentation } from "../../features/conversation/ConversationPresentation";
import {
  memo,
  type ReactNode,
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import {
  ConversationTimeline,
  ConversationThread,
  useConversation,
} from "../../features/conversation/Conversation";
import type { ThreadHandoff } from "../../features/messages/ThreadPanel";
import type { ChannelTimelineProps } from "../../features/messages/ChannelTimeline";
import type { PageNavigation } from "../../features/navigation/service";
import { useChannelWindow } from "../../features/relay/react";
import { useRecoveryOwns } from "../../features/relay/RecoveryNotice";
import { headRecovering } from "../../features/relay/live-recovery";
import { clientMetrics } from "../../features/developer/client-metrics";
import { Button } from "../../shared/design-system/ui/Button";
import styles from "./Channels.module.css";

export const ChannelBody = memo(function ChannelBody({
  cached,
  intro,
  latestRequest,
  viewer,
  revealMessageId,
  openThreadRootId,
  inlineTarget,
  marksRead,
  holding,
  onOpenThread,
  hasThreadTab,
  threadRequest,
  onCloseThreadRequest,
  navigation,
  onContentReady,
}: {
  onContentReady?(channelId: string): void;
  cached: boolean;
  intro?: ReactNode;
  latestRequest?: AbortSignal | undefined;
  viewer?: string | undefined;
  navigation?: PageNavigation | undefined;
  revealMessageId?: string | undefined;
  openThreadRootId?: string | undefined;
  /** One exact visit to a loaded message, without a page navigation. */
  inlineTarget?: ChannelTimelineProps["inlineTarget"];
  /** False: viewing rows marks nothing read. */
  marksRead?: boolean | undefined;
  /** Show the loading notice instead of the list, as while a message is sought. */
  holding?: boolean | undefined;
  /** Opens the thread's tab. A thread handed over from its sheet asks it to
   * reveal the reply it was read at, or to reply to its reply target. */
  onOpenThread?:
    | ((
        messageId: string,
        threadRootId: string,
        intent?: "reply" | "reveal",
        replyParent?: string,
      ) => void)
    | undefined;
  /** Whether a thread already has a tab, which it selects instead of reading
   * inline. */
  hasThreadTab?: ((channelId: string, rootId: string) => boolean) | undefined;
  /** A visit to a thread read inline: once the timeline reveals its root, the
   * thread opens over the conversation. */
  threadRequest?: Readonly<{ rootId: string; signal: AbortSignal }> | undefined;
  /** Close or Escape dismissed the thread a request opened: retire its visit,
   * so Back never shows a sheet again. Inline sheets are not history entries. */
  onCloseThreadRequest?: ((signal: AbortSignal) => void) | undefined;
}) {
  // The owner's Solo chat is a chat-style timeline that loads history on scroll.
  const {
    session: queries,
    channelId,
    ownSoloConversation: solo,
  } = useConversation();
  const presented = useConversationPresentation();
  const trigger = useRef<HTMLElement | null>(null);
  type Thread = {
    messageId: string;
    rootId: string;
    channelId: string;
    host: ComposerOverlayHost;
    revealSelected: boolean;
    replyRequest?: number;
    /** The visit that opened it, retired when it is dismissed. */
    request?: AbortSignal;
    open: boolean;
    id: number;
    trigger: { current: HTMLElement | null };
    handoff: { current: (() => ThreadHandoff) | undefined };
  };
  const sequence = useRef(0);
  const [threads, setThreads] = useState<Thread[]>([]);
  // The inline thread that explains itself, until the reader is done with it.
  const [introThread, setIntroThread] = useState<number>();
  const [introStep, setIntroStep] = useState<InlineThreadIntroStep>(1);
  const [introAnchor, setIntroAnchor] = useState<HTMLElement | null>(null);
  const addThread = useCallback(
    (thread: Omit<Thread, "id" | "trigger" | "open" | "handoff">) => {
      const next = {
        ...thread,
        open: true,
        id: ++sequence.current,
        trigger: { current: trigger.current },
        handoff: { current: undefined },
      };
      setThreads([next]);
      if (!inlineThreadIntroSeen()) {
        setIntroThread(next.id);
        setIntroStep(1);
      }
    },
    [],
  );
  useEffect(() => {
    setThreads((items) =>
      items.filter((item) => presented && item.channelId === channelId),
    );
  }, [presented, channelId]);
  // Stable, so memoized message rows keep their props across window updates.
  // The row it opens from names its reader: on macOS a click moves no focus.
  // A thread with a tab selects that tab instead.
  const openThread = useCallback(
    (
      messageId: string,
      rootId: string,
      intent?: "reply",
      origin?: Element | null,
    ) => {
      const focused = document.activeElement;
      const opener =
        origin && !(focused && origin.contains(focused)) ? origin : focused;
      const host = hasThreadTab?.(channelId, rootId)
        ? null
        : overlayHostFor(origin ?? focused);
      if (!host) {
        onOpenThread?.(messageId, rootId, intent);
        return;
      }
      trigger.current = opener instanceof HTMLElement ? opener : null;
      addThread({
        messageId,
        rootId,
        channelId,
        host,
        revealSelected: messageId !== rootId,
        ...(intent === "reply" ? { replyRequest: 1 } : {}),
      });
    },
    [channelId, onOpenThread, hasThreadTab, addThread],
  );
  const request = useRef(threadRequest);
  useLayoutEffect(() => {
    request.current = threadRequest;
  });
  const opened = useRef<AbortSignal | undefined>(undefined);
  // The revealed root holds focus, so it anchors the sheet and takes focus back
  // when the thread closes. Without a reader to attach to, it opens a tab.
  const revealed = useCallback(
    (messageId: string, signal: AbortSignal) => {
      const pending = request.current;
      if (
        !pending ||
        pending.signal !== signal ||
        pending.rootId !== messageId ||
        signal.aborted ||
        opened.current === signal
      )
        return;
      opened.current = signal;
      const row = document.activeElement;
      const host = overlayHostFor(row);
      if (!host) {
        onOpenThread?.(messageId, messageId);
        return;
      }
      trigger.current = row instanceof HTMLElement ? row : null;
      addThread({
        messageId,
        rootId: messageId,
        channelId,
        host,
        revealSelected: false,
        request: signal,
      });
    },
    [channelId, onOpenThread, addThread],
  );
  // ChannelWorkspace already keys this lifetime by viewer/scope/generation.
  const continuityKey = useId();
  const window = useChannelWindow(queries.channels, channelId);
  useLayoutEffect(() => {
    clientMetrics.channelMounted(channelId);
    return () => clientMetrics.channelUnmounted(channelId);
  }, [channelId]);
  const headRecovers = useRecoveryOwns(queries, (live) =>
    headRecovering(live, channelId),
  );
  const newest = window.rows.at(-1)?.id;
  const settled = window.status === "ready" || window.status === "error";
  useEffect(() => {
    if (newest || settled) onContentReady?.(channelId);
  }, [channelId, newest, settled, onContentReady]);
  useLayoutEffect(() => {
    // Repeat calls for the same open are ignored; only the first rows count.
    // Any row counts as content, since a saved scroll position may keep the
    // newest one unmounted.
    if (newest)
      clientMetrics.channelRendered(
        channelId,
        () =>
          !!document.querySelector(
            `[data-channel-timeline="${CSS.escape(channelId)}"] [data-message-id]`,
          ),
      );
    else if (settled) clientMetrics.channelEmpty(channelId);
  }, [channelId, newest, settled]);
  useEffect(() => {
    // Only the normalized conversation attempt can acknowledge its channel.
    // A warm child effect runs before the parent's default resolution effect.
    if (
      navigation?.target.kind !== "conversation" ||
      navigation.target.messageId
    )
      return;
    if (window.status === "ready") navigation?.complete({ status: "opened" });
    // The timeline shows this failure in place, beside its own Retry.
    else if (!cached && window.status === "error")
      navigation?.complete({
        status: "failed",
        reason: "unavailable",
        presented: true,
      });
  }, [cached, navigation, window.status]);
  // While recovery retries this timeline's head read, its notice is the one
  // report, after the quiet delay; the empty timeline waits.
  const timeline =
    window.status === "error" && !window.rows.length && !headRecovers ? (
      <div
        className={`${styles.empty} ${styles.timelinePlaceholder}`}
        role="alert"
      >
        <p>{window.error}</p>
        <Button
          type="button"
          onClick={() => queries.channels.ensure(channelId)}
        >
          Retry messages
        </Button>
      </div>
    ) : holding || (window.status !== "ready" && !window.rows.length) ? (
      <div
        className={`${styles.empty} ${styles.timelinePlaceholder}`}
        data-buzz-launch-pending={!cached ? "required" : undefined}
      >
        <MessageLoading />
      </div>
    ) : (
      <ConversationTimeline
        continuityKey={continuityKey}
        intro={intro}
        latestRequest={latestRequest}
        viewer={viewer}
        window={window}
        launchPending={
          !cached &&
          !window.error &&
          (window.status === "idle" ||
            window.status === "loading" ||
            (window.status === "ready" && window.freshness === "cached"))
        }
        {...(onOpenThread ? { onOpenThread: openThread } : {})}
        onRevealed={revealed}
        revealMessageId={revealMessageId}
        openThreadRootId={openThreadRootId}
        inlineTarget={inlineTarget}
        marksRead={marksRead}
        navigation={navigation}
        chatPresentation={solo}
        historyControl={solo ? "scroll" : "button"}
      />
    );
  const introducing = threads.some(
    (thread) =>
      thread.id === introThread &&
      thread.open &&
      thread.channelId === channelId,
  );
  const finishIntro = () => {
    markInlineThreadIntroSeen();
    setIntroThread(undefined);
  };
  return (
    <>
      {timeline}
      {presented && introducing && (
        <InlineThreadIntro
          step={introStep}
          anchor={introAnchor}
          onNext={() => setIntroStep(2)}
          onDone={() => setIntroThread(undefined)}
        />
      )}
      {presented &&
        threads
          .filter((thread) => thread.channelId === channelId)
          .map((thread) => {
            const intro = introducing && thread.id === introThread;
            return (
              <DetailsSheet
                key={thread.id}
                spotlight={intro ? introStep : undefined}
                onSpotlightAnchor={setIntroAnchor}
                // The first Escape finishes the intro; the next closes.
                onEscapeKey={() => {
                  if (!intro) return false;
                  finishIntro();
                  return true;
                }}
                {...(onOpenThread
                  ? {
                      // The thread moves into its own tab, at the reply it was
                      // read at and with its reply target.
                      onOpenAsTab: () => {
                        if (intro) finishIntro();
                        const { anchor, replyParent } =
                          thread.handoff.current?.() ?? {};
                        setThreads((items) =>
                          items.filter((item) => item.id !== thread.id),
                        );
                        if (replyParent)
                          onOpenThread(
                            replyParent,
                            thread.rootId,
                            "reply",
                            replyParent,
                          );
                        else if (anchor)
                          onOpenThread(anchor, thread.rootId, "reveal");
                        else onOpenThread(thread.messageId, thread.rootId);
                      },
                    }
                  : {})}
                open={thread.open}
                onOpenChange={(open) => {
                  if (!open && thread.request)
                    onCloseThreadRequest?.(thread.request);
                  setThreads((items) =>
                    items.map((item) =>
                      item.id === thread.id ? { ...item, open } : item,
                    ),
                  );
                }}
                onClosed={() =>
                  setThreads((items) =>
                    items.filter((item) => item.id !== thread.id),
                  )
                }
                host={thread.host}
                containsComposer
                focusContent={thread.replyRequest !== undefined}
                title="Thread"
                closeLabel="Close thread"
                finalFocus={thread.trigger}
              >
                <ConversationThread
                  messageId={thread.messageId}
                  replyRequest={thread.replyRequest}
                  revealSelected={thread.revealSelected}
                  handoff={thread.handoff}
                  initialScroll="latest"
                  virtualizeReplies
                />
              </DetailsSheet>
            );
          })}
    </>
  );
});
