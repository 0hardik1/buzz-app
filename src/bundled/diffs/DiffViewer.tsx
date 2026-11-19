import {
  useEffect,
  useRef,
  useMemo,
  useState,
  useId,
  type ReactNode,
} from "react";
import {
  getFiletypeFromFileName,
  getHighlighterIfLoaded,
  parsePatchFiles,
  preloadHighlighter,
  type FileDiffMetadata,
  type DiffLineAnnotation,
} from "@pierre/diffs";
import { FileDiff as ReactFileDiff } from "@pierre/diffs/react";
import { bundledLanguages } from "./grammars";
import { gitPatch, type FileData } from "./parse";
import styles from "./Diffs.module.css";

import { commentLines, commentableLine, type DiffLine } from "./comment-lines";
export { commentLines, type DiffLine } from "./comment-lines";
export type DiffComments = {
  readOnly?: boolean;
  onAvailabilityChange?(path: string, available: boolean): void;
  annotations: (DiffLine & { path: string; content: ReactNode })[];
  onSelect(path: string, lines: DiffLine[], restoreFocus: () => void): void;
};

const theme = { light: "pierre-light", dark: "pierre-dark" } as const;

/** The grammar that highlights a file: "text" keeps the diff view without
 * tokens. @pierre/diffs stores partial patches compactly, so absolute line
 * numbers do not measure highlighting cost; bound the supplied content. */
function languageFor(file: FileData, name: string) {
  const changes = file.hunks.flatMap((hunk) => hunk.changes);
  if (
    changes.length > 500 ||
    changes.reduce((size, change) => size + change.content.length, 0) > 12_000
  )
    return "text";
  const language = getFiletypeFromFileName(name);
  return Object.hasOwn(bundledLanguages, language) ? language : "text";
}

const languages = (files: FileDiffMetadata[]) => [
  ...new Set(files.map((file) => file.lang ?? "text")),
];


function RawDiff({ content }: { content: string }) {
  return (
    // biome-ignore lint/a11y/useSemanticElements: Preserve keyboard-scrollable literal diff fallback.
    <pre
      className={styles.raw}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: The raw scrollport needs keyboard panning.
      tabIndex={0}
      role="region"
      aria-label="Raw diff"
    >
      {content}
    </pre>
  );
}

/** All three diff callers share this strict parse gate and readable fallback. */
export function DiffViewer({
  content,
  files,
  filePath,
  viewType = "unified",
  comments,
}: {
  content: string;
  files: FileData[] | undefined;
  filePath?: string | undefined;
  viewType?: "unified" | "split";
  comments?: DiffComments | undefined;
}) {
  if (!files) return <RawDiff content={content} />;
  if (!files.length) return <p className="text-body-sm">No diff content</p>;
  if (files.some((file) => file.isBinary || !file.hunks.length))
    return <RawDiff content={content} />;
  return (
    <ParsedDiff
      key={content}
      content={content}
      files={files}
      filePath={filePath}
      viewType={viewType}
      comments={comments}
    />
  );
}

function ParsedDiff({
  content,
  files,
  filePath,
  viewType,
  comments,
}: {
  content: string;
  files: FileData[];
  filePath?: string | undefined;
  viewType: "unified" | "split";
  comments?: DiffComments | undefined;
}) {
  const parsed = useMemo(() => {
    try {
      // Both parsers read the same Git-headed text, so their names agree.
      const entries = parsePatchFiles(gitPatch(content)).flatMap(
        (patch) => patch.files,
      );
      if (
        entries.length !== files.length ||
        entries.some(
          (entry, index) =>
            entry.name !==
            (files[index]?.newPath === "/dev/null"
              ? files[index]?.oldPath
              : files[index]?.newPath),
        )
      )
        return undefined;
      return entries.map((entry, index) => ({
        ...entry,
        lang: languageFor(files[index] as FileData, entry.name),
      }));
    } catch {
      return undefined;
    }
  }, [content, files]);
  // A highlighter that already holds these grammars renders at once.
  const [ready, setReady] = useState(
    () =>
      !!parsed && !!getHighlighterIfLoaded({ theme, langs: languages(parsed) }),
  );
  const [failed, setFailed] = useState(false);
  const [themeType, setThemeType] = useState<"light" | "dark">(() =>
    document.documentElement.dataset.colorMode === "dark" ? "dark" : "light",
  );
  useEffect(() => {
    if (!parsed) return;
    let active = true;
    void preloadHighlighter({
      themes: [theme.light, theme.dark],
      langs: languages(parsed),
      preferredHighlighter: "shiki-js",
    }).then(
      () => {
        if (active) setReady(true);
      },
      () => {
        if (active) setFailed(true);
      },
    );
    return () => {
      active = false;
    };
  }, [parsed]);
  useEffect(() => {
    const root = document.documentElement;
    const observer = new MutationObserver(() =>
      setThemeType(root.dataset.colorMode === "dark" ? "dark" : "light"),
    );
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-color-mode"],
    });
    return () => observer.disconnect();
  }, []);
  if (!parsed || failed || !ready) return <RawDiff content={content} />;
  return (
    <div className={styles.viewer}>
      {parsed.map((file, index) => (
        <PierreFile
          // biome-ignore lint/suspicious/noArrayIndexKey: A path may repeat across commits; its position is stable in this patch.
          key={`${file.prevName ?? ""}:${file.name}:${index}`}
          file={file}
          source={files[index]}
          comments={comments}
          filePath={filePath}
          hideHeader={
            parsed.length === 1 &&
            filePath === file.name &&
            file.type === "change"
          }
          onFailure={() => setFailed(true)}
          themeType={themeType}
          viewType={viewType}
        />
      ))}
    </div>
  );
}

function PierreFile({
  file,
  source,
  filePath,
  hideHeader,
  onFailure,
  themeType,
  viewType,
  comments,
}: {
  file: FileDiffMetadata;
  source: FileData | undefined;
  filePath?: string | undefined;
  hideHeader: boolean;
  onFailure: () => void;
  themeType: "light" | "dark";
  viewType: "unified" | "split";
  comments?: DiffComments | undefined;
}) {
  const section = useRef<HTMLElement>(null);
  const availability = comments?.onAvailabilityChange;
  useEffect(() => {
    availability?.(file.name, true);
    return () => availability?.(file.name, false);
  }, [availability, file.name]);
  const [keyboardLine, setKeyboardLine] = useState<DiffLine>();
  const instructions = useId();
  const rows = useMemo(() => (source ? commentLines(source) : []), [source]);
  const choices = rows.flat();
  const keyboardRow = rows.find((row) =>
    row.some(
      (line) =>
        line.side === keyboardLine?.side &&
        line.lineNumber === keyboardLine.lineNumber,
    ),
  );
  const path = file.name;
  const select = (line: DiffLine, element: HTMLElement) => {
    const candidates = rows.find((row) =>
      row.some(
        (entry) =>
          entry.side === line.side && entry.lineNumber === line.lineNumber,
      ),
    );
    if (candidates) {
      setKeyboardLine(undefined);
      comments?.onSelect(path, candidates, () => {
        setKeyboardLine(undefined);
        element.focus();
      });
    }
  };
  const annotations: DiffLineAnnotation<ReactNode>[] =
    comments?.annotations
      .filter(
        (entry) =>
          entry.path === path &&
          choices.some(
            (line) =>
              line.side === entry.side && line.lineNumber === entry.lineNumber,
          ),
      )
      .map(({ side, lineNumber, content }) => ({
        side,
        lineNumber,
        metadata: content,
      })) ?? [];
  return (
    <section
      ref={section}
      className={styles.file}
      aria-label={filePath || file.name}
      aria-describedby={
        comments && !comments.readOnly ? instructions : undefined
      }
      onKeyDown={(event) => {
        if (
          event.target !== event.currentTarget ||
          !comments ||
          comments.readOnly
        )
          return;
        const index = rows.findIndex((row) =>
          row.some(
            (line) =>
              line.side === keyboardLine?.side &&
              line.lineNumber === keyboardLine.lineNumber,
          ),
        );
        if (event.key === "ArrowDown" || event.key === "ArrowUp") {
          event.preventDefault();
          const next =
            index < 0
              ? 0
              : Math.max(
                  0,
                  Math.min(
                    rows.length - 1,
                    index + (event.key === "ArrowDown" ? 1 : -1),
                  ),
                );
          setKeyboardLine(rows[next]?.[0]);
        } else if (event.key === "Enter" && keyboardLine) {
          event.preventDefault();
          select(keyboardLine, event.currentTarget);
        } else if (event.key === "Escape") {
          setKeyboardLine(undefined);
        }
      }}
      // biome-ignore lint/a11y/noNoninteractiveTabindex: File-level keyboard focus precedes inner code scrollports.
      tabIndex={0}
    >
      {comments && !comments.readOnly && (
        <span id={instructions} className="sr-only">
          Use Up and Down arrows to select a diff line, then Enter to comment.
        </span>
      )}
      {comments && !comments.readOnly && (
        <span className="sr-only" role="status">
          {keyboardRow?.length === 2
            ? `Context: Old line ${keyboardRow[0]?.lineNumber} or New line ${keyboardRow[1]?.lineNumber}. Press Enter to choose a side.`
            : keyboardLine
              ? `${keyboardLine.side === "deletions" ? "Old" : "New"} line ${keyboardLine.lineNumber}`
              : ""}
        </span>
      )}
      <ReactFileDiff
        fileDiff={file}
        selectedLines={
          keyboardLine
            ? {
                start: keyboardLine.lineNumber,
                end: keyboardLine.lineNumber,
                side: keyboardLine.side,
              }
            : null
        }
        lineAnnotations={annotations}
        renderAnnotation={(annotation) => annotation.metadata}
        options={{
          theme,
          themeType,
          diffStyle: viewType,
          diffIndicators: "bars",
          enableGutterUtility: !!comments && !comments.readOnly,
          onLineEnter: ({ numberElement, lineNumber, annotationSide }) => {
            setKeyboardLine(undefined);
            const root = numberElement.getRootNode();
            if (root instanceof ShadowRoot) {
              const button = root.querySelector<HTMLButtonElement>(
                "[data-utility-button]",
              );
              if (button) {
                const valid =
                  !!source &&
                  commentableLine(source, { side: annotationSide, lineNumber });
                button.disabled = !valid;
                button.hidden = !valid;
                button.style.display = valid ? "" : "none";
                button.setAttribute("aria-label", "Comment on hovered line");
              }
            }
          },
          ...(comments && !comments.readOnly
            ? {
                onGutterUtilityClick: (range: {
                  start: number;
                  side?: "deletions" | "additions";
                }) => {
                  if (!range.side || !section.current) return;
                  setKeyboardLine(undefined);
                  select(
                    { side: range.side, lineNumber: range.start },
                    section.current,
                  );
                },
              }
            : {}),
          disableFileHeader: hideHeader,
          overflow: "scroll",
          tokenizeMaxLineLength: 2_000,
          onPostRender: (node) => {
            if (node.shadowRoot?.querySelector("[data-error-wrapper]"))
              onFailure();
            const utility = node.shadowRoot?.querySelector(
              "[data-utility-button]",
            );
            utility?.setAttribute("aria-label", "Comment on hovered line");
            // Split code columns own their horizontal scrollports.
            const columns = node.shadowRoot?.querySelectorAll("code") ?? [];
            for (const [index, code] of Array.from(columns).entries()) {
              code.tabIndex = 0;
              code.setAttribute("role", "region");
              code.setAttribute(
                "aria-label",
                `${file.name} ${viewType === "split" ? (index === 0 ? "old code" : "new code") : "code"}`,
              );
            }
          },
        }}
      />
    </section>
  );
}
