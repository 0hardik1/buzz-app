import { animate, useReducedMotion } from "motion/react";
import {
  SidebarViewMenuItems,
  type SidebarViewFilter,
  type SidebarViewSort,
} from "./SidebarViewMenus";
import { FadingLabel } from "./FadingLabel";
import {
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type DOMAttributes,
  type ReactNode,
  type Ref,
  type RefObject,
} from "react";
import {
  MenuIcon,
  MenuItem,
  MenuPopup,
  MenuRoot,
  MenuSeparator,
  MenuTrigger,
} from "../../shared/design-system/ui/Menu";
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CaretDownIcon,
  DotsThreeIcon,
  PlusIcon,
  TrashIcon,
} from "../../shared/design-system/icons";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Button } from "../../shared/design-system/ui/Button";
import { Dialog } from "../../shared/design-system/ui/Dialog";
import { Field } from "../../shared/design-system/ui/Field";
import { Input } from "../../shared/design-system/ui/Input";
import { NavigationSectionHeading } from "../../shared/design-system/ui/NavigationSection";
import type { RelaySession } from "../../features/relay/session";
import type { ChannelSummary } from "../../features/relay/contracts";
import { SidebarGroupIcon } from "./SidebarGroupIcon";
import { SidebarStarIcon } from "./SidebarStarIcon";
import { SidebarCardResize, sidebarHeightSpring } from "./SidebarCardResize";
import { isWorkspaceCard } from "./sidebar-sections";
import {
  SidebarCardDisplayContext,
  useSidebarCardDisplay,
} from "./SidebarCardDisplay";
import {
  setSidebarUnreadsFirst,
  useSidebarUnreadsFirst,
} from "./SidebarUnreadsFirst";
import styles from "./Channels.module.css";

export function SidebarSection({
  sectionKey,
  title,
  icon,
  session,
  open,
  onToggle,
  headerActions,
  headerNotice,
  hideMoreActions = false,
  createChannel,
  createSection,
  newMessage,
  sort,
  filter,
  channels,
  dropRef,
  dropTarget = false,
  dropEdge,
  dragHandle,
  dragging = false,
  move,
  onRemove,
  menuActions,
  channelCount,
  removalFocus,
  heightScope,
  excludedRows,
  iconView = false,
  rename,
  children,
}: {
  sectionKey: string;
  title: string;
  icon?: ReactNode;
  session?: RelaySession | undefined;
  open: boolean;
  onToggle: (open: boolean) => void;
  headerActions?: ReactNode;
  headerNotice?: ReactNode;
  onRemove?: (() => unknown) | undefined;
  menuActions?:
    | ((
        dismiss: () => void,
        trigger: RefObject<HTMLButtonElement | null>,
      ) => ReactNode)
    | undefined;
  hideMoreActions?: boolean;
  /** Keep the disclosure affordance visible instead of revealing it on hover. */
  channelCount?: number | undefined;
  removalFocus?: (() => HTMLElement | null | undefined) | undefined;
  /** Scope for this card's view preferences. */
  heightScope?: string | undefined;
  /** Rows the grip may reveal beyond the current filter. */
  excludedRows?: (() => ReactNode) | undefined;
  /** Offer showing the card's rows as identity tiles instead of names. */
  iconView?: boolean;
  createChannel?:
    | { available: boolean; open: (trigger: HTMLButtonElement) => void }
    | undefined;
  newMessage?: (() => void) | undefined;
  createSection?:
    | { available: boolean; open: (trigger: HTMLButtonElement) => void }
    | undefined;
  sort?: SidebarViewSort | undefined;
  filter?: SidebarViewFilter | undefined;
  channels?:
    | {
        rows: readonly ChannelSummary[];
        selected?: string | undefined;
        select: (id: string) => void;
      }
    | undefined;
  dropRef?: Ref<HTMLDivElement> | undefined;
  dropTarget?: boolean;
  /** Where a dragged group would land relative to this one. */
  dropEdge?: "before" | "after" | undefined;
  dragHandle?:
    | {
        ref: Ref<HTMLElement>;
        listeners?: DOMAttributes<HTMLElement> | undefined;
      }
    | undefined;
  dragging?: boolean;
  /**
   * Renaming the card in place: double-click its header to start. A card that
   * can be renamed waits a beat before a click collapses it, so the clicks of
   * a double-click leave it where it is.
   */
  rename?:
    | {
        editing: boolean;
        start(): void;
        save(name: string, openedWith: string): Promise<unknown>;
        /** `focus` when the edit ended with focus still in it. */
        stop(focus: boolean): void;
      }
    | undefined;
  /** Single-pointer and keyboard reordering; an absent direction is disabled. */
  move?:
    | { up?: (() => void) | undefined; down?: (() => void) | undefined }
    | undefined;
  children: ReactNode;
}) {
  const id = useId();
  const workspace = isWorkspaceCard(sectionKey);
  const [display, setDisplay] = useSidebarCardDisplay(
    iconView ? heightScope : undefined,
    sectionKey,
  );
  const body = useRef<HTMLDivElement>(null);
  const minimize = () => {
    const content = body.current;
    if (content?.contains(document.activeElement))
      content.parentElement
        ?.querySelector<HTMLElement>(`summary[aria-controls="${id}"]`)
        ?.focus({ preventScroll: true });
    onToggle(false);
  };
  const cancelRemove = useRef<HTMLButtonElement>(null);
  const actionsTrigger = useRef<HTMLButtonElement>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const unreadsFirst = useSidebarUnreadsFirst(heightScope)(sectionKey);
  // The menu unmounts while hidden, so it must not reopen when shown again.
  const unreadsFirstChoice = heightScope
    ? {
        on: unreadsFirst,
        set: (on: boolean) =>
          setSidebarUnreadsFirst(heightScope, sectionKey, on),
      }
    : undefined;
  const displayChoice =
    iconView && heightScope ? { value: display, set: setDisplay } : undefined;
  // View choices stay reachable when the card's own actions are hidden.
  const viewChoices = !!(filter || sort || unreadsFirstChoice || displayChoice);
  const showMenu = !hideMoreActions || viewChoices;
  if (!showMenu && menuOpen) setMenuOpen(false);
  const [removeOpen, setRemoveOpen] = useState(false);
  const pendingToggle = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(pendingToggle.current), []);
  const [removing, setRemoving] = useState(false);
  const [removeError, setRemoveError] = useState("");
  const canRemove = !!onRemove && sectionKey.startsWith("group:");
  const remove = async () => {
    if (!onRemove || removing) return;
    setRemoving(true);
    setRemoveError("");
    try {
      await onRemove();
      setRemoveOpen(false);
    } catch (error) {
      setRemoveError(error instanceof Error ? error.message : String(error));
    } finally {
      setRemoving(false);
    }
  };
  const renderBody = (content: ReactNode) => (
    <SidebarSectionBody id={id} body={body} open={open} workspace={workspace}>
      {content}
    </SidebarSectionBody>
  );
  return (
    <div
      ref={dropRef}
      className={styles.channelSection}
      data-sidebar-card=""
      data-sidebar-workspace={workspace || undefined}
      data-sidebar-section={sectionKey}
      data-drop-target={dropTarget || undefined}
      data-drop-edge={dropEdge}
      data-section-dragging={dragging || undefined}
      data-menu-open={menuOpen || undefined}
    >
      <NavigationSectionHeading
        disclosure
        revealActions
        actions={
          <>
            {showMenu && (
              <MenuRoot open={menuOpen} onOpenChange={setMenuOpen}>
                <MenuTrigger
                  ref={actionsTrigger}
                  render={(props) => (
                    <IconButton
                      {...props}
                      size="compact"
                      aria-label={`More actions for ${title}`}
                      icon={<DotsThreeIcon strokeWidth={2.5} size={15} />}
                    />
                  )}
                />
                <MenuPopup align="end" aria-label={`More actions for ${title}`}>
                  <SidebarViewMenuItems
                    title={title}
                    filter={filter}
                    sort={sort}
                    unreadsFirst={unreadsFirstChoice}
                    display={displayChoice}
                  />
                  {viewChoices &&
                    !hideMoreActions &&
                    (createSection || move || menuActions) && <MenuSeparator />}
                  {!hideMoreActions && createSection && (
                    <MenuItem
                      disabled={!createSection.available}
                      onClick={() => {
                        setMenuOpen(false);
                        if (actionsTrigger.current)
                          createSection.open(actionsTrigger.current);
                      }}
                    >
                      <MenuIcon>
                        <PlusIcon size={14} />
                      </MenuIcon>
                      Create workspace
                    </MenuItem>
                  )}
                  {!hideMoreActions && move && (
                    <>
                      <MenuItem
                        disabled={!move.up}
                        onClick={() => {
                          move.up?.();
                          setMenuOpen(false);
                        }}
                      >
                        <MenuIcon>
                          <ArrowUpIcon size={14} />
                        </MenuIcon>
                        Move up
                      </MenuItem>
                      <MenuItem
                        disabled={!move.down}
                        onClick={() => {
                          move.down?.();
                          setMenuOpen(false);
                        }}
                      >
                        <MenuIcon>
                          <ArrowDownIcon size={14} />
                        </MenuIcon>
                        Move down
                      </MenuItem>
                    </>
                  )}
                  {!hideMoreActions &&
                    menuActions?.(() => setMenuOpen(false), actionsTrigger)}

                  {!hideMoreActions && canRemove && (
                    <>
                      <MenuSeparator />
                      <MenuItem
                        tone="danger"
                        onClick={() => {
                          setRemoveError("");
                          setMenuOpen(false);
                          setRemoveOpen(true);
                        }}
                      >
                        <MenuIcon>
                          <TrashIcon size={14} />
                        </MenuIcon>
                        Remove workspace
                      </MenuItem>
                    </>
                  )}
                </MenuPopup>
              </MenuRoot>
            )}
            {headerActions}
            {newMessage && (
              <IconButton
                hint="familiar"
                size="compact"
                aria-label="New message"
                title="New message"
                onClick={newMessage}
                icon={<PlusIcon strokeWidth={2.5} size={15} />}
              />
            )}
            {canRemove && (
              <Dialog
                size="compact"
                open={removeOpen}
                onOpenChange={setRemoveOpen}
                dismissOnOutsideClick
                preventClose={removing}
                initialFocus={cancelRemove}
                finalFocus={() =>
                  actionsTrigger.current?.isConnected
                    ? actionsTrigger.current
                    : (removalFocus?.() ?? false)
                }
                title={`Remove ${title}?`}
                description={`${channelCount === undefined ? "Assigned conversations" : `${channelCount} ${channelCount === 1 ? "conversation" : "conversations"}`} will return to their default sections.`}
                actions={
                  <>
                    <Button
                      ref={cancelRemove}
                      type="button"
                      disabled={removing}
                      onClick={() => setRemoveOpen(false)}
                    >
                      Cancel
                    </Button>
                    <Button
                      type="button"
                      variant="destructive"
                      loading={removing}
                      onClick={() => void remove()}
                    >
                      Remove workspace
                    </Button>
                  </>
                }
              >
                {removeError && <p role="alert">{removeError}</p>}
                {removing && (
                  <p role="status" className="sr-only">
                    Removing section and waiting for confirmation…
                  </p>
                )}
              </Dialog>
            )}
            {createChannel && (
              <IconButton
                size="compact"
                aria-label="Create channel"
                title={
                  createChannel.available
                    ? "Create channel"
                    : "Channel creation unavailable"
                }
                disabled={!createChannel.available}
                onClick={(event) => createChannel.open(event.currentTarget)}
                icon={<PlusIcon strokeWidth={2.5} size={15} />}
              />
            )}
          </>
        }
      >
        {rename?.editing ? (
          <SectionNameEditor
            title={title}
            save={rename.save}
            stop={rename.stop}
          />
        ) : (
          <details open={open}>
            {/* biome-ignore lint/a11y/noStaticElementInteractions: summary has native keyboard activation. */}
            <summary
              ref={dragHandle?.ref}
              tabIndex={0}
              {...dragHandle?.listeners}
              aria-label={title}
              aria-controls={id}
              onClick={(event) => {
                event.preventDefault();
                clearTimeout(pendingToggle.current);
                // Keyboard activation has no click count and toggles at once.
                if (!rename || event.detail === 0) onToggle(!open);
                else if (event.detail === 1)
                  pendingToggle.current = setTimeout(
                    () => onToggle(!open),
                    DOUBLE_CLICK_MS,
                  );
              }}
              onDoubleClick={
                rename &&
                ((event) => {
                  event.preventDefault();
                  clearTimeout(pendingToggle.current);
                  rename.start();
                })
              }
            >
              <span className={styles.sectionLabel}>
                {sectionKey === "starred" ? (
                  <SidebarStarIcon />
                ) : typeof icon === "string" && session ? (
                  <SidebarGroupIcon icon={icon} session={session} />
                ) : (
                  icon
                )}
                <FadingLabel className={styles.sectionTitle}>
                  {title}
                </FadingLabel>
              </span>
              <span
                className={`${styles.sidebarIcon} ${styles.sectionChevron}`}
                aria-hidden="true"
                data-navigation-reveal={workspace ? undefined : ""}
              >
                <CaretDownIcon strokeWidth={2.5} size={15} />
              </span>
            </summary>
          </details>
        )}
      </NavigationSectionHeading>
      {headerNotice}
      {display === "icons" ? (
        // Tiles wrap, so a card of them shows every row and has no grip.
        renderBody(
          <div className={styles.cardTiles} data-card-display="icons">
            <SidebarCardDisplayContext.Provider value="icons">
              {children}
            </SidebarCardDisplayContext.Provider>
          </div>,
        )
      ) : workspace && heightScope ? (
        <SidebarCardResize
          key={heightScope}
          label={title}
          controls={id}
          open={open}
          onMinimize={minimize}
          onExpand={() => onToggle(true)}
          renderBody={renderBody}
          excludedRows={excludedRows}
          excludedCount={channels?.rows.length ?? 0}
        >
          {children}
        </SidebarCardResize>
      ) : (
        renderBody(<div>{children}</div>)
      )}
    </div>
  );
}

function SidebarSectionBody({
  id,
  body,
  open,
  workspace,
  children,
}: {
  id: string;
  body: RefObject<HTMLDivElement | null>;
  open: boolean;
  workspace: boolean;
  children: ReactNode;
}) {
  const reducedMotion = useReducedMotion();
  const springWorkspace = workspace && !reducedMotion;
  const bodyContents = useRef<HTMLDivElement>(null);
  const lastOpen = useRef<boolean>(undefined);
  const workspaceSpring = useRef<ReturnType<typeof animate>>(undefined);
  useLayoutEffect(() => {
    const element = body.current;
    const contents = bodyContents.current;
    if (!element || !contents) return;
    const previous = lastOpen.current;
    lastOpen.current = springWorkspace ? open : undefined;
    const finish = () => {
      element.hidden = !open;
      element.style.height = springWorkspace && !open ? "0px" : "";
      element.style.overflow = springWorkspace && !open ? "clip" : "";
    };
    const from = element.getBoundingClientRect().height;
    workspaceSpring.current?.stop();
    if (!springWorkspace || previous === undefined || previous === open) {
      finish();
      return;
    }
    element.hidden = false;
    const to = open ? contents.getBoundingClientRect().height : 0;
    element.style.height = `${from}px`;
    element.style.overflow = "clip";
    workspaceSpring.current = animate(
      element,
      { height: `${to}px` },
      { ...sidebarHeightSpring, onComplete: finish },
    );
  }, [open, springWorkspace, body]);
  useEffect(() => () => workspaceSpring.current?.stop(), []);
  return (
    <div
      id={id}
      ref={body}
      className={styles.sectionContent}
      inert={!open}
      hidden={!springWorkspace && !open}
    >
      <div ref={bodyContents} className={styles.sectionBody}>
        {children}
      </div>
    </div>
  );
}

/** How long a click on a renamable header waits for a second click. */
const DOUBLE_CLICK_MS = 220;

/**
 * The card's name, edited in place. Enter or leaving the field saves a
 * changed name; Escape keeps the old one. A failed save stays open with the
 * reason, so nothing typed is lost.
 */
function SectionNameEditor({
  title,
  save,
  stop,
}: {
  title: string;
  save(name: string, openedWith: string): Promise<unknown>;
  stop(focus: boolean): void;
}) {
  const form = useRef<HTMLFormElement>(null);
  // The title this edit started from: a rename from another device while it
  // is open must not count as a change here, nor be overwritten unawares.
  const [openedWith] = useState(title);
  // The edit's own stop, so a late save closes only this edit.
  const [stopThis] = useState(() => stop);
  const [name, setName] = useState(title);
  const [error, setError] = useState("");
  const saving = useRef(false);
  // Escape or a save ends the edit; the blur that follows must not save again.
  const done = useRef(false);
  const owns = () => !!form.current?.contains(document.activeElement);
  // `owned`: the edit held focus when it ended, or when its save began and
  // focus was only lost (to the page body) while saving, not moved elsewhere.
  const end = (owned = owns()) => {
    done.current = true;
    stopThis(owned);
  };
  const finish = async (keep: boolean) => {
    const next = name.trim();
    if (saving.current || done.current) return;
    if (!keep || !next || next === openedWith) return end();
    saving.current = true;
    setError("");
    const owned = owns();
    try {
      await save(next, openedWith);
      end(
        owns() ||
          (owned &&
            (!document.activeElement ||
              document.activeElement === document.body)),
      );
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      saving.current = false;
    }
  };
  return (
    <form
      ref={form}
      className={styles.sectionNameEditor}
      aria-label={`Rename ${title}`}
      onSubmit={(event) => {
        event.preventDefault();
        void finish(true);
      }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Escape" && !event.nativeEvent.isComposing) {
          event.preventDefault();
          void finish(false);
        }
      }}
    >
      <Field
        label="Workspace name"
        labelVisibility="hidden"
        error={error || undefined}
      >
        <Input
          controlSize="sm"
          value={name}
          autoFocus
          onFocus={(event) => event.currentTarget.select()}
          onChange={(event) => setName(event.currentTarget.value)}
          onBlur={() => void finish(true)}
        />
      </Field>
    </form>
  );
}
