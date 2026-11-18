import { useLayoutEffect, useRef, type ComponentProps } from "react";
import { PanelView } from "../../features/panels/PanelView";
import { PanelCard } from "../../features/panels/PanelCard";
import { useMediaReview } from "../../features/conversation/Conversation";
import { MediaReviewViewer } from "../../features/messages/MediaReviewViewer";

type Props = ComponentProps<typeof PanelCard> &
  Pick<
    ComponentProps<typeof MediaReviewViewer>,
    "session" | "scope" | "channelId" | "channelName" | "extensions"
  > & {
    isActive(): boolean;
    presentation?: "card" | "content";
  };

/** A channel panel shares the inline media viewer and its session-backed source. */
export function PanelMediaCard({
  session,
  scope,
  channelId,
  channelName,
  extensions,
  isActive,
  presentation = "card",
  context,
  ...card
}: Props) {
  const media = useMediaReview();
  const live = useRef(false);
  useLayoutEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const active = isActive();
  const visible = useRef(active);
  useLayoutEffect(() => {
    visible.current = active;
    if (!active) media.review?.close();
  }, [active, media.review]);
  const Content = presentation === "content" ? PanelView : PanelCard;
  return (
    <>
      <Content
        {...card}
        context={
          context && {
            ...context,
            openMedia: (messageId, attachment) => {
              if (
                !live.current ||
                !visible.current ||
                !isActive() ||
                (attachment.kind !== "image" && attachment.kind !== "video")
              )
                return false;
              media.open(messageId, attachment, 0);
              return true;
            },
          }
        }
      />
      {active && media.review && (
        <MediaReviewViewer
          {...media.review}
          session={session}
          scope={scope}
          channelId={channelId}
          channelName={channelName}
          extensions={extensions}
          onOpenLink={(url) =>
            context?.push?.(url) ?? context?.open(url) ?? false
          }
        />
      )}
    </>
  );
}
