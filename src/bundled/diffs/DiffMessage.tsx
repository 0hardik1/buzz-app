import { useComposerScope } from "../../features/messages/composer-overlay";
import {
  panelContent,
  readingOrigin,
  useReading,
} from "../../features/messages/inline-containers";
import {
  type ComponentProps,
  type ReactNode,
  useMemo,
  useRef,
  useState,
} from "react";
import { panelOpening, type Panels } from "../../features/panels/service";
import type { ChannelMessage } from "../../features/relay/contracts";
import { safeMessageUrl } from "../../features/relay/message-content";
import { ArrowsOutIcon } from "../../shared/design-system/icons";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { DiffViewer } from "./DiffViewer";
import { parsePatch } from "./parse";
import styles from "./Diffs.module.css";

/** The panel target that reads a diff message whole. */
export const diffTarget = (messageId: string) => `buzz-diff:${messageId}`;
const TARGET = /^buzz-diff:([0-9a-f]{64})$/;
export const diffTargetMessage = (target: string) => TARGET.exec(target)?.[1];

/** The expanded diff, with its own layout choice: each sheet or tab that
 * shows it starts unified. */
export function DiffReader({
  viewer,
  warning,
}: {
  viewer: Omit<ComponentProps<typeof DiffViewer>, "viewType">;
  warning: ReactNode;
}) {
  const [viewType, setViewType] = useState<"unified" | "split">("unified");
  return (
    <>
      <fieldset className={styles.toolbar} aria-label="Diff layout">
        <Button
          size="sm"
          aria-pressed={viewType === "unified"}
          variant={viewType === "unified" ? "subtle" : "ghost"}
          onClick={() => setViewType("unified")}
        >
          Unified
        </Button>
        <Button
          size="sm"
          aria-pressed={viewType === "split"}
          variant={viewType === "split" ? "subtle" : "ghost"}
          onClick={() => setViewType("split")}
        >
          Split
        </Button>
      </fieldset>
      {warning}
      <DiffViewer {...viewer} viewType={viewType} />
    </>
  );
}

/** What a diff message shows: its title, source, viewer and warning. */
export function useDiff(message: ChannelMessage | null | undefined) {
  const content = message?.content ?? "";
  const files = useMemo(() => parsePatch(content), [content]);
  const meta = message?.diff;
  if (!message || !meta) return undefined;
  const repoUrl = meta.repoUrl ? safeMessageUrl(meta.repoUrl) : undefined;
  const commit = meta.commitSha;
  const commitUrl =
    repoUrl && commit && /^[0-9a-f]{7,64}$/i.test(commit)
      ? `${repoUrl.replace(/\/$/, "")}/commit/${commit}`
      : undefined;
  const source = commitUrl || repoUrl;
  const warning = meta.truncated && (
    <p className={styles.notice}>
      Diff truncated.{" "}
      {source ? (
        <a href={source} target="_blank" rel="noreferrer noopener">
          View full diff at the source repository
        </a>
      ) : (
        "View the full diff at the source repository."
      )}
    </p>
  );
  return {
    meta,
    commit,
    source,
    title: meta.filePath || "Diff",
    viewer: { content: message.content, files, filePath: meta.filePath },
    warning,
  };
}

/**
 * A diff message's card. Expand reads it whole in the diff panel, over the
 * composer it is answered from or in a tab, as a link would open it. Without
 * a workspace, as in search previews, it reads in a dialog of its own.
 */
export function DiffMessage({
  message,
  panels,
}: {
  message: ChannelMessage;
  panels?: Pick<Panels, "resolve"> | undefined;
}) {
  const reading = useReading();
  const composer = useComposerScope();
  const [own, setOwn] = useState(false);
  const expand = useRef<HTMLButtonElement>(null);
  const diff = useDiff(message);
  if (!diff) return null;
  const { meta, commit, source, title, viewer, warning } = diff;
  const show = () => {
    const opening =
      reading &&
      panels &&
      panelOpening(
        panels,
        message.channelId,
        diffTarget(message.id),
        message.threadRootId,
      );
    if (opening)
      reading.openPanel(
        panelContent(opening, title),
        readingOrigin(composer),
        expand.current,
      );
    else setOwn(true);
  };
  return (
    <>
      <section className={styles.card} aria-label={`Diff: ${title}`}>
        <header className={styles.header}>
          <span className={styles.filename} title={title}>
            {title}
          </span>
          <span className={styles.source}>
            {source ? (
              <a href={source} target="_blank" rel="noreferrer noopener">
                {commit?.slice(0, 7) || "Source"}
              </a>
            ) : (
              commit?.slice(0, 7)
            )}
          </span>
          <IconButton
            ref={expand}
            size="sm"
            aria-label="Expand diff"
            icon={<ArrowsOutIcon size={16} aria-hidden="true" />}
            onClick={show}
          />
        </header>
        {meta.description && (
          <p className={styles.description}>{meta.description}</p>
        )}
        <section
          className={styles.preview}
          // biome-ignore lint/a11y/noNoninteractiveTabindex: The preview scroll owner must support keyboard scrolling.
          tabIndex={0}
          aria-label={`Diff preview: ${title}`}
        >
          <DiffViewer {...viewer} />
        </section>
        {warning}
      </section>
      {own && (
        <Dialog
          open
          onOpenChange={setOwn}
          title={title}
          size="expanded"
          closeLabel="Close diff"
          finalFocus={expand}
        >
          <DiffReader viewer={viewer} warning={warning} />
        </Dialog>
      )}
    </>
  );
}
