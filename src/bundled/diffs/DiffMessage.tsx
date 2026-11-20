import { DetailTabContext } from "../../features/messages/DetailTabContext";
import {
  composerChannel,
  overlayHost,
  useComposerName,
} from "../../features/messages/composer-overlay";
import { useInlineContainers } from "../../features/messages/inline-containers";
import {
  type ComponentProps,
  type ReactNode,
  useContext,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ChannelMessage } from "../../features/relay/contracts";
import { safeMessageUrl } from "../../features/relay/message-content";
import { ArrowsOutIcon } from "../../shared/design-system/icons";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { DiffViewer } from "./DiffViewer";
import { parsePatch } from "./parse";
import styles from "./Diffs.module.css";

/** The expanded diff, with its own layout choice: each sheet or tab that
 * shows it starts unified. */
function DiffReader({
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

export function DiffMessage({ message }: { message: ChannelMessage }) {
  const [open, setOpen] = useState(false);
  const openTab = useContext(DetailTabContext);
  const containers = useInlineContainers();
  const composer = useComposerName();
  const expand = useRef<HTMLButtonElement>(null);
  const files = useMemo(() => parsePatch(message.content), [message.content]);
  const meta = message.diff;
  if (!meta) return null;
  const repoUrl = meta.repoUrl ? safeMessageUrl(meta.repoUrl) : undefined;
  const commit = meta.commitSha;
  const commitUrl =
    repoUrl && commit && /^[0-9a-f]{7,64}$/i.test(commit)
      ? `${repoUrl.replace(/\/$/, "")}/commit/${commit}`
      : undefined;
  const source = commitUrl || repoUrl;
  const title = meta.filePath || "Diff";
  const viewer = { content: message.content, files, filePath: meta.filePath };
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
  const reader = <DiffReader viewer={viewer} warning={warning} />;
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
            onClick={() => {
              if (!containers || !composer || !overlayHost(composer)) {
                setOpen(true);
                return;
              }
              const id = `diff:${message.id}`;
              containers.open({
                id,
                kind: "reader",
                channelId: composerChannel(composer),
                composer,
                title,
                closeLabel: "Close diff",
                readerOnly: true,
                content: reader,
                openAsTab:
                  openTab && (() => openTab({ id, title, content: reader })),
                trigger: expand.current,
              });
            }}
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
      <Dialog
        open={open}
        onOpenChange={setOpen}
        title={title}
        size="expanded"
        closeLabel="Close diff"
        finalFocus={expand}
      >
        {reader}
      </Dialog>
    </>
  );
}
