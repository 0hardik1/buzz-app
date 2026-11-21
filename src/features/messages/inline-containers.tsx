import {
  createContext,
  type ReactNode,
  type RefObject,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import type { Navigation } from "../navigation/controller";
import type { PanelOpening } from "../panels/service";
import { DetailsSheet } from "./DetailsSheet";
import { DetailsReader } from "./DetailsReader";
import {
  InlineThreadIntro,
  type InlineThreadIntroStep,
  inlineThreadIntroSeen,
  markInlineThreadIntroSeen,
} from "./InlineThreadIntro";
import {
  type ComposerHandle,
  ComposerScope,
  type ComposerName,
  composerHost,
  createComposerHandle,
  overlayHost,
  useComposerForm,
  useComposerScope,
} from "./composer-overlay";
import {
  type PanelContent,
  type Reading,
  type ReadingContent,
  type ReadingHost,
  type ReadingOrigin,
  type Shown,
  type ThreadContent,
  type ThreadHandoff,
  createReading,
  provides,
} from "./reading";

export type { ThreadHandoff } from "./reading";

/** How each kind reads over its composer. */
const BEHAVIOR = {
  // Holds its own composer and places focus itself.
  thread: { closeLabel: "Close thread", containsComposer: true },
  // Owns its scrollport and shows no composer.
  panel: { closeLabel: "Close", readerOnly: true },
  details: { closeLabel: "Close details" },
} as const satisfies Record<
  ReadingContent["kind"],
  { closeLabel: string; containsComposer?: boolean; readerOnly?: boolean }
>;

/** Draws a panel; `navigate` moves it to another page in place. */
export type PanelRenderer = (
  content: PanelContent,
  controls: Readonly<{ close(): void; navigate(next: PanelContent): void }>,
) => ReactNode;
type ThreadRenderer = (
  content: ThreadContent,
  /** Filled by the thread with what its tab takes over on Open as tab. */
  handoff: { current: (() => ThreadHandoff) | undefined },
) => ReactNode;

/** A panel as the reading holds it, titled as its sheet is. */
export function panelContent(
  entry: PanelOpening,
  sheet: Readonly<{ title?: string; closeLabel?: string }> = {},
): PanelContent {
  return {
    kind: "panel",
    channelId: entry.channelId,
    rootId: entry.rootId,
    title: sheet.title ?? entry.panel.title,
    ...(sheet.closeLabel && { closeLabel: sheet.closeLabel }),
    target: entry.target,
    opening: entry,
  };
}

/** A conversation workspace's reading: what is open over its composers. */
export type Workspace = Readonly<{
  reading: Reading;
  renderPanel: PanelRenderer;
}>;
/** Stable: rows that open things never re-render as what is open changes. */
export const InlineContainers = createContext<Workspace | undefined>(undefined);
export const useReading = () => useContext(InlineContainers)?.reading;

/** Where a row of the current scope opens what it reads. */
export function readingOrigin(
  handle: ComposerHandle | undefined,
): ReadingOrigin {
  return {
    composer: handle?.name,
    sheets: !!handle?.sheets,
    onScreen: !!overlayHost(handle),
  };
}
/** The origin of the current scope, read when a row opens something. */
export function useReadingOrigin() {
  const handle = useComposerScope();
  return useCallback(() => readingOrigin(handle), [handle]);
}

/**
 * The workspace's reading, tied to navigation history. `host` supplies its
 * tabs; `renderPanel` draws its panels. Both are read when used, so the page
 * may fill them in after this call. `dialogs` draws what reads where no
 * composer can hold it.
 */
export function useWorkspaceReading(
  navigator: Navigation | undefined,
  host: RefObject<ReadingHost | undefined>,
  renderPanel: RefObject<PanelRenderer | undefined>,
) {
  const [reading] = useState(() =>
    createReading(() => {
      if (!host.current) throw new Error("The reading has no tabs yet");
      return host.current;
    }),
  );
  useLayoutEffect(
    () => (navigator ? reading.attach(navigator) : undefined),
    [reading, navigator],
  );
  const workspace = useMemo<Workspace>(
    () => ({
      reading,
      renderPanel: (content, controls) =>
        renderPanel.current?.(content, controls),
    }),
    [reading, renderPanel],
  );
  return {
    workspace,
    dialogs: <ReaderDialogs reading={reading} />,
  };
}

/** What is shown now, as it changes. */
function useShown(reading: Reading) {
  return useSyncExternalStore(reading.subscribe, reading.shown, reading.shown);
}

/** Keeps what left drawn, closing, until its motion ends. */
function useLeaving(current: Shown | undefined) {
  const [drawn, setDrawn] = useState<{ shown: Shown; open: boolean }[]>([]);
  useLayoutEffect(() => {
    setDrawn((list) => {
      const id = current?.item.id;
      const next = list
        .filter((item) => item.shown.item.id !== id)
        .map((item) => (item.open ? { ...item, open: false } : item));
      if (current) next.push({ shown: current, open: true });
      return next.length === list.length &&
        next.every(
          (item, index) =>
            item.open === list[index]?.open &&
            item.shown === list[index]?.shown,
        )
        ? list
        : next;
    });
  }, [current]);
  const done = useCallback(
    (id: string) =>
      setDrawn((list) =>
        list.filter((item) => item.open || item.shown.item.id !== id),
      ),
    [],
  );
  return { drawn, done };
}

/** Details read where no composer can hold them. */
function ReaderDialogs({ reading }: { reading: Reading }) {
  const current = useShown(reading).get("dialog");
  const { drawn, done } = useLeaving(current);
  return drawn.map(({ shown, open }) =>
    shown.content.kind === "details" ? (
      <ReaderDialog
        key={shown.item.id}
        reading={reading}
        shown={shown}
        open={open}
        onClosed={() => done(shown.item.id)}
      />
    ) : null,
  );
}
function ReaderDialog({
  reading,
  shown,
  open,
  onClosed,
}: {
  reading: Reading;
  shown: Shown;
  open: boolean;
  onClosed(): void;
}) {
  const { item, content } = shown;
  const focus = useMemo(() => ({ current: item.trigger ?? null }), [item]);
  if (content.kind !== "details") return null;
  return (
    <DetailsReader channelId={content.channelId} messageId={content.messageId}>
      {(reader) => (
        <Dialog
          open={open}
          onOpenChange={(next) => {
            if (!next) reading.close(item.id);
          }}
          onOpenChangeComplete={(next: boolean) => {
            if (!next) onClosed();
          }}
          title={reader.title}
          description={reader.time}
          closeLabel={BEHAVIOR.details.closeLabel}
          finalFocus={focus}
        >
          {reader.body}
        </Dialog>
      )}
    </DetailsReader>
  );
}

/** A scope's composer handle, one per name for the scope's lifetime.
 * `sheets`: what opens from it reads on sheets over it, as from the
 * conversation or an inline thread; elsewhere only details do. */
export function useComposerHandle(
  name: ComposerName | undefined,
  sheets = false,
) {
  return useMemo(
    () => (name ? createComposerHandle(name, sheets) : undefined),
    [name, sheets],
  );
}

/** Provides `handle`'s composer to the content below, and draws what reads
 * over it beside it, inside the conversation that owns it. Threads read only
 * over a conversation's composer, whose owner supplies `renderThread`. */
export function ComposerScopeProvider({
  handle,
  renderThread,
  children,
}: {
  handle: ComposerHandle | undefined;
  renderThread?: ThreadRenderer | undefined;
  children: ReactNode;
}) {
  const workspace = useContext(InlineContainers);
  return (
    <ComposerScope value={handle}>
      {children}
      {workspace && handle && (
        <Outlet
          workspace={workspace}
          handle={handle}
          renderThread={renderThread}
        />
      )}
    </ComposerScope>
  );
}

function Outlet({
  workspace,
  handle,
  renderThread,
}: {
  workspace: Workspace;
  handle: ComposerHandle;
  renderThread?: ThreadRenderer | undefined;
}) {
  const shown = useShown(workspace.reading);
  const mine = shown.get(handle.name);
  const current = mine && mine.item.sheets === handle.sheets ? mine : undefined;
  const { drawn, done } = useLeaving(current);
  const form = useComposerForm(handle);
  const host = form ? composerHost(handle) : null;
  // A thread under a reader that owns its scrollport takes the full height.
  const above = current && provides(current.item);
  const tall =
    !!above && !!shown.get(above) && shown.get(above)?.content.kind === "panel";
  // The first inline thread on a device explains itself until it is done.
  const [intro, setIntro] = useState<string>();
  const [introStep, setIntroStep] = useState<InlineThreadIntroStep>(1);
  const [introAnchor, setIntroAnchor] = useState<HTMLElement | null>(null);
  const thread =
    host && current?.content.kind === "thread" ? current.item.id : undefined;
  const introducing = intro !== undefined && intro === thread;
  useEffect(() => {
    if (thread === undefined || introducing || inlineThreadIntroSeen()) return;
    setIntro(thread);
    setIntroStep(1);
  }, [thread, introducing]);
  const finishIntro = useCallback(() => {
    markInlineThreadIntroSeen();
    setIntro(undefined);
  }, []);
  return (
    <>
      {introducing && (
        <InlineThreadIntro
          step={introStep}
          anchor={introAnchor}
          onNext={() => setIntroStep(2)}
          onDone={() => setIntro(undefined)}
        />
      )}
      {drawn.map(({ shown: item, open }) =>
        host ? (
          <SheetEntry
            key={item.item.id}
            workspace={workspace}
            shown={item}
            open={open}
            tall={open && tall}
            host={host}
            renderThread={renderThread}
            onClosed={() => done(item.item.id)}
            spotlight={
              introducing && item.item.id === intro ? introStep : undefined
            }
            onSpotlightAnchor={setIntroAnchor}
            finishIntro={finishIntro}
          />
        ) : (
          // Without its composer on screen, details read in a dialog.
          item.content.kind === "details" && (
            <ReaderDialog
              key={item.item.id}
              reading={workspace.reading}
              shown={item}
              open={open}
              onClosed={() => done(item.item.id)}
            />
          )
        ),
      )}
    </>
  );
}

function SheetEntry({
  workspace,
  shown,
  open,
  tall,
  host,
  renderThread,
  onClosed,
  spotlight,
  onSpotlightAnchor,
  finishIntro,
}: {
  workspace: Workspace;
  shown: Shown;
  open: boolean;
  tall: boolean;
  host: NonNullable<ReturnType<typeof composerHost>>;
  renderThread?: ThreadRenderer | undefined;
  onClosed(): void;
  spotlight: InlineThreadIntroStep | undefined;
  onSpotlightAnchor(element: HTMLElement | null): void;
  finishIntro(): void;
}) {
  const { reading } = workspace;
  const { item, content } = shown;
  const rules: (typeof BEHAVIOR)[keyof typeof BEHAVIOR] &
    Partial<{ containsComposer: boolean; readerOnly: boolean }> =
    BEHAVIOR[content.kind];
  const handoff = useRef<() => ThreadHandoff>(undefined);
  const focus = useMemo(() => ({ current: item.trigger ?? null }), [item]);
  // Close, Escape and the scrim close it: history retires its visits.
  const close = () => reading.close(item.id);
  const sheet = (
    title: ReactNode,
    body: ReactNode,
    extra: Partial<{ leading: ReactNode; description: ReactNode }> = {},
  ) => (
    <DetailsSheet
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
      }}
      onClosed={onClosed}
      host={host}
      title={title}
      {...extra}
      closeLabel={
        (content.kind === "panel" && content.closeLabel) || rules.closeLabel
      }
      containsComposer={!!rules.containsComposer}
      readerOnly={!!rules.readerOnly}
      tall={tall}
      focusContent={content.kind === "thread" && !!content.reply}
      finalFocus={focus}
      spotlight={spotlight}
      onSpotlightAnchor={onSpotlightAnchor}
      // The first Escape finishes the intro; the next closes.
      onEscapeKey={() => {
        if (spotlight === undefined) return false;
        finishIntro();
        return true;
      }}
      onOpenAsTab={
        content.kind === "details"
          ? undefined
          : () => {
              if (spotlight !== undefined) finishIntro();
              // Read before it leaves: the tab opens where the thread was
              // read, answering the reply it was answering.
              const carried =
                content.kind === "thread" ? handoff.current?.() : undefined;
              // Its tab places focus.
              focus.current = null;
              reading.moveToTab(item.id, carried);
            }
      }
    >
      {body}
    </DetailsSheet>
  );
  switch (content.kind) {
    case "thread":
      return sheet("Thread", renderThread?.(content, handoff));
    case "panel":
      return sheet(
        content.title,
        workspace.renderPanel(content, {
          close,
          navigate: (next) => reading.navigate(item.id, next),
        }),
      );
    default:
      return (
        <DetailsReader
          channelId={content.channelId}
          messageId={content.messageId}
        >
          {(reader) =>
            sheet(reader.title, reader.body, {
              leading: reader.avatar,
              description: reader.time,
            })
          }
        </DetailsReader>
      );
  }
}
