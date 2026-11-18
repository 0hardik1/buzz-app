import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { resolveMatch, type Contribution } from "../../plugins/contributions";
import {
  ContributionBoundary,
  contributionKey,
} from "../conversation/ContributionBoundary";
import type {
  ContributionReader,
  LinkPreviewRenderer,
} from "../conversation/contracts";
import { useConversationPresentation } from "../conversation/ConversationPresentation";
import {
  OPEN_IN_BROWSER_FAILED,
  openInBrowser,
} from "../conversation/open-in-browser";
import { Button } from "../../shared/design-system/ui/Button";
import { ToastNotice } from "../../shared/design-system/ui/Toast";
import styles from "./LinkPreviews.module.css";

/** A message shows this many cards before the rest fold behind one button. */
export const FOLD_AFTER = 3;

const none: readonly Contribution<LinkPreviewRenderer>[] = [];
const noSubscribe = () => () => {};
const noSnapshot = () => none;

export function LinkPreviews({
  urls,
  messageId,
  registry,
  onOpenLink,
}: {
  urls: readonly string[];
  messageId: string;
  registry: ContributionReader<LinkPreviewRenderer> | undefined;
  onOpenLink(url: string): boolean;
}) {
  const renderers = useSyncExternalStore(
    registry?.subscribe ?? noSubscribe,
    registry?.snapshot ?? noSnapshot,
    registry?.snapshot ?? noSnapshot,
  );
  const active = useConversationPresentation();
  const [open, setOpen] = useState(false);
  const [failed, setFailed] = useState(false);
  // Leaving the conversation clears the notice, as MessageLink's does.
  if (!active && failed) setFailed(false);
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const cards = urls.flatMap((url) => {
    const renderer = resolveMatch(renderers, url);
    return renderer ? [{ url, renderer }] : [];
  });
  if (!cards.length) return null;
  const shown = open ? cards : cards.slice(0, FOLD_AFTER);
  const hidden = cards.length - shown.length;
  return (
    <div className={styles.previews} data-link-previews>
      {shown.map(({ url, renderer }) => {
        const Preview = renderer.component;
        const key = contributionKey(renderer);
        return (
          <ContributionBoundary
            key={`${key}:${url}`}
            fallback={null}
            resetIdentity={key}
          >
            <Preview
              url={url}
              messageId={messageId}
              open={() => {
                if (
                  !active ||
                  !live.current ||
                  !registry?.snapshot().includes(renderer)
                )
                  return false;
                // A link no panel takes opens in the browser, as its anchor does.
                if (!onOpenLink(url)) {
                  setFailed(false);
                  void openInBrowser(url).then(
                    (opened) => live.current && setFailed(!opened),
                  );
                }
                return true;
              }}
            />
          </ContributionBoundary>
        );
      })}
      {active && failed && (
        <ToastNotice
          title={OPEN_IN_BROWSER_FAILED}
          onDismiss={() => setFailed(false)}
        />
      )}
      {(hidden > 0 || (open && cards.length > FOLD_AFTER)) && (
        <Button
          variant="ghost"
          size="sm"
          type="button"
          onClick={() => setOpen((value) => !value)}
        >
          {open
            ? "Show fewer previews"
            : `Show ${hidden} more ${hidden === 1 ? "preview" : "previews"}`}
        </Button>
      )}
    </div>
  );
}
