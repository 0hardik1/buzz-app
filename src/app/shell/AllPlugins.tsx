import {
  DndContext,
  DragOverlay,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  useCallback,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  GripVerticalIcon,
  PinFilledIcon,
  PinIcon,
  SquaresFourIcon,
} from "../../shared/design-system/icons/index";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import {
  NavigationCard,
  NavigationItem,
} from "../../shared/design-system/ui/NavigationItem";
import { NavigationSection } from "../../shared/design-system/ui/NavigationSection";
import {
  PopoverPopup,
  PopoverRoot,
  PopoverTitle,
  PopoverTrigger,
} from "../../shared/design-system/ui/Popover";
import { SearchField } from "../../shared/design-system/ui/SearchField";
import { Switch } from "../../shared/design-system/ui/Switch";
import { Tooltip } from "../../shared/design-system/ui/Tooltip";
import type { AllPluginsEntry, AllPluginsProps } from "./all-plugins";
import styles from "./AllPlugins.module.css";

export type { AllPluginsEntry, AllPluginsProps } from "./all-plugins";

/** Search earns its place once the list no longer fits at a glance. */
export const ALL_PLUGINS_SEARCH_THRESHOLD = 8;

const byLabel = (a: AllPluginsEntry, b: AllPluginsEntry) =>
  a.label.localeCompare(b.label, undefined, { sensitivity: "base" }) ||
  a.key.localeCompare(b.key);

/** Pinned plugins that are on lead, in the person's order; everything else
 * follows A–Z. A plugin that is off keeps its pin for when it returns. */
export function arrangePlugins(
  plugins: readonly AllPluginsEntry[],
  query = "",
) {
  const needle = query.trim().toLocaleLowerCase();
  const matches = needle
    ? plugins.filter((plugin) =>
        plugin.label.toLocaleLowerCase().includes(needle),
      )
    : plugins;
  const pinned = matches.filter((plugin) => plugin.pinned && plugin.pinnable);
  const rest = matches
    .filter((plugin) => !(plugin.pinned && plugin.pinnable))
    .sort(byLabel);
  return { pinned, rest };
}

function moveKey(keys: readonly string[], from: string, to: string) {
  const next = keys.filter((key) => key !== from);
  const at = keys.indexOf(to);
  if (at < 0 || !keys.includes(from)) return keys;
  next.splice(at, 0, from);
  return next;
}

/** The Plugins card's last row and the large popover it opens: every plugin
 * this device can run, with on/off and pinning in one place. */
export function AllPlugins({
  plugins,
  onOpen,
  onEnabledChange,
  onPinnedChange,
  onPinnedOrderChange,
}: AllPluginsProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [dragging, setDragging] = useState<string>();
  const opened = useRef(false);
  const searchable = plugins.length > ALL_PLUGINS_SEARCH_THRESHOLD;
  const searching = searchable && query.trim() !== "";
  const { pinned, rest } = useMemo(
    () => arrangePlugins(plugins, searchable ? query : ""),
    [plugins, query, searchable],
  );
  // The full pinned order, including pins hidden by search or switched off,
  // so a move never drops a pin it cannot see.
  const pinnedOrder = useMemo(
    () => plugins.filter((plugin) => plugin.pinned).map(({ key }) => key),
    [plugins],
  );
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
  );
  const reorder = useCallback(
    (from: string, to: string) => {
      const next = moveKey(pinnedOrder, from, to);
      if (next !== pinnedOrder) onPinnedOrderChange(next);
    },
    [pinnedOrder, onPinnedOrderChange],
  );
  const openPlugin = (key: string) => {
    opened.current = true;
    setOpen(false);
    onOpen(key);
  };
  const tile = (plugin: AllPluginsEntry, reorderable: boolean) => (
    <PluginTile
      key={plugin.key}
      plugin={plugin}
      move={
        reorderable && !searching
          ? {
              previous: neighbour(pinned, plugin.key, -1),
              next: neighbour(pinned, plugin.key, 1),
              reorder,
            }
          : undefined
      }
      onOpen={openPlugin}
      onEnabledChange={onEnabledChange}
      onPinnedChange={onPinnedChange}
    />
  );
  const draggingPlugin = plugins.find((plugin) => plugin.key === dragging);
  return (
    <PopoverRoot
      open={open}
      onOpenChange={(next) => {
        if (next) {
          opened.current = false;
          setQuery("");
        }
        setOpen(next);
      }}
    >
      <PopoverTrigger
        render={
          <NavigationItem
            label="All plugins"
            variant="row"
            icon={
              <span className="shell-page-icon">
                <SquaresFourIcon size={16} strokeWidth={2.5} />
              </span>
            }
          />
        }
      />
      <PopoverPopup
        size="large"
        padding="none"
        side="right"
        align="start"
        // Opening a plugin hands focus to its page, not back to this row.
        finalFocus={() =>
          opened.current
            ? (document.getElementById("main-content") ?? false)
            : true
        }
      >
        <div className={styles.frame}>
          <header className={styles.header}>
            <PopoverTitle>All plugins</PopoverTitle>
            {searchable && (
              <SearchField
                variant="capsule"
                label="Search plugins"
                placeholder="Search plugins"
                value={query}
                onValueChange={setQuery}
                autoFocus
              />
            )}
          </header>
          <div className={styles.body}>
            {pinned.length > 0 && (
              <NavigationSection label="Pinned">
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  accessibility={{ container: document.body }}
                  onDragStart={({ active }) => setDragging(String(active.id))}
                  onDragCancel={() => setDragging(undefined)}
                  onDragEnd={({ active, over }) => {
                    setDragging(undefined);
                    if (over && over.id !== active.id)
                      reorder(String(active.id), String(over.id));
                  }}
                >
                  <ul className={styles.list}>
                    {pinned.map((plugin) => (
                      <li key={plugin.key}>{tile(plugin, true)}</li>
                    ))}
                  </ul>
                  {createPortal(
                    // The popover is transformed, which would anchor a fixed
                    // preview to it, so the preview sits on the body.
                    <DragOverlay
                      dropAnimation={null}
                      style={{ zIndex: "var(--layer-tooltip)" }}
                    >
                      {draggingPlugin && (
                        <div className={styles.dragOverlay}>
                          <span className={styles.icon} aria-hidden="true">
                            {draggingPlugin.icon}
                          </span>
                          <span>{draggingPlugin.label}</span>
                        </div>
                      )}
                    </DragOverlay>,
                    document.body,
                  )}
                </DndContext>
              </NavigationSection>
            )}
            {rest.length > 0 && (
              <NavigationSection
                {...(pinned.length > 0 && { label: "Other plugins" })}
              >
                <ul className={styles.grid}>
                  {rest.map((plugin) => (
                    <li key={plugin.key}>{tile(plugin, false)}</li>
                  ))}
                </ul>
              </NavigationSection>
            )}
            {pinned.length === 0 && rest.length === 0 && (
              <p className={`${styles.empty} text-body-sm`} role="status">
                {searching
                  ? `No plugins match “${query.trim()}”.`
                  : "No plugins are installed."}
              </p>
            )}
          </div>
        </div>
      </PopoverPopup>
    </PopoverRoot>
  );
}

function neighbour(
  list: readonly AllPluginsEntry[],
  key: string,
  step: -1 | 1,
): string | undefined {
  const index = list.findIndex((plugin) => plugin.key === key);
  return list[index + step]?.key;
}

function PluginTile({
  plugin,
  move,
  onOpen,
  onEnabledChange,
  onPinnedChange,
}: {
  plugin: AllPluginsEntry;
  /** Present for a reorderable pinned row. */
  move:
    | {
        previous: string | undefined;
        next: string | undefined;
        reorder: (from: string, to: string) => void;
      }
    | undefined;
  onOpen: (key: string) => void;
  onEnabledChange: AllPluginsProps["onEnabledChange"];
  onPinnedChange: AllPluginsProps["onPinnedChange"];
}) {
  const reorderable = !!move && (!!move.previous || !!move.next);
  const drag = useDraggable({ id: plugin.key, disabled: !reorderable });
  const drop = useDroppable({ id: plugin.key, disabled: !reorderable });
  const { setNodeRef: setDragRef } = drag;
  const { setNodeRef: setDropRef } = drop;
  const row = useCallback(
    (node: HTMLElement | null) => {
      setDragRef(node);
      setDropRef(node);
    },
    [setDragRef, setDropRef],
  );
  const openable = plugin.enabled && plugin.pinnable;
  const icon = (
    <span className={styles.icon} aria-hidden="true">
      {plugin.icon}
    </span>
  );
  const pin = openable ? (
    <Tooltip content={plugin.pinned ? "Unpin" : "Pin to sidebar"}>
      <IconButton
        aria-label={`${plugin.pinned ? "Unpin" : "Pin"} ${plugin.label}`}
        aria-pressed={plugin.pinned}
        size="sm"
        icon={
          plugin.pinned ? (
            <PinFilledIcon size={16} aria-hidden="true" />
          ) : (
            <PinIcon size={16} aria-hidden="true" />
          )
        }
        onClick={() => onPinnedChange(plugin.key, !plugin.pinned)}
      />
    </Tooltip>
  ) : null;
  const lock = plugin.toggle;
  const toggle = lock ? (
    <SwitchWithReason reason={lock.reason}>
      {(describedBy) => (
        <Switch
          aria-label={plugin.label}
          aria-describedby={describedBy}
          checked={plugin.enabled}
          disabled={lock.disabled}
          onCheckedChange={(checked) => onEnabledChange(plugin.key, checked)}
        />
      )}
    </SwitchWithReason>
  ) : null;
  const handle = move ? (
    <span className={styles.handle}>
      {reorderable && (
        <IconButton
          ref={drag.setActivatorNodeRef}
          {...drag.listeners}
          // Pointer drag only; the button keeps its own semantics and the
          // arrow keys below are its keyboard path.
          aria-label={`Reorder ${plugin.label}`}
          title="Drag, or use the arrow keys, to reorder"
          size="sm"
          icon={<GripVerticalIcon size={16} aria-hidden="true" />}
          onKeyDown={(event) => {
            const to =
              event.key === "ArrowUp"
                ? move.previous
                : event.key === "ArrowDown"
                  ? move.next
                  : undefined;
            if (!to) return;
            event.preventDefault();
            move.reorder(plugin.key, to);
          }}
        />
      )}
    </span>
  ) : null;
  return (
    <div
      ref={move ? row : undefined}
      className={styles.tile}
      data-dragging={drag.isDragging || undefined}
      data-drop-target={(drop.isOver && !drag.isDragging) || undefined}
    >
      {handle}
      {openable ? (
        <NavigationCard>
          <NavigationItem
            label={plugin.label}
            title={plugin.label}
            icon={icon}
            selected={plugin.active}
            onClick={() => onOpen(plugin.key)}
          />
          <span className={styles.controls}>
            {pin}
            {toggle}
          </span>
        </NavigationCard>
      ) : (
        <div className={styles.static} data-off={!plugin.enabled || undefined}>
          <span className={styles.label} title={plugin.label}>
            {icon}
            <span className={styles.name}>{plugin.label}</span>
          </span>
          <span className={styles.controls}>{toggle}</span>
        </div>
      )}
    </div>
  );
}

/** A locked switch explains itself on hover and to assistive technology. */
function SwitchWithReason({
  reason,
  children,
}: {
  reason: string | undefined;
  children: (describedBy: string | undefined) => ReactNode;
}) {
  const id = useId();
  if (!reason) return children(undefined);
  return (
    <>
      <Tooltip content={reason}>
        <span className={styles.reason}>{children(id)}</span>
      </Tooltip>
      <span id={id} className="sr-only">
        {reason}
      </span>
    </>
  );
}
