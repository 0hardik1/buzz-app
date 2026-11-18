import { SidebarCardReorder } from "./sidebar-card-motion";
import {
  DndContext,
  DragOverlay,
  PointerSensor,
  type CollisionDetection,
  pointerWithin,
  useDndContext,
  useDraggable,
  useDndMonitor,
  useDroppable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useRef,
  type ComponentProps,
  type PointerEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { SidebarSection } from "../../bundled/channels/SidebarSection";
import type { SidebarRowKind } from "../../bundled/channels/sidebar-sections";
import { PlusIcon } from "../../shared/design-system/icons";
import styles from "../../bundled/channels/Channels.module.css";

const Writable = createContext(false);
const CREATE_SECTION = "create-section";

// Group gaps target the neighbour whose insertion edge lies in that same gap.
const sidebarCollisions: CollisionDetection = (args) => {
  const domain = args.active.data.current?.groupDomain ?? "channels";
  if (!args.active.data.current?.group)
    return pointerWithin({
      ...args,
      droppableContainers: args.droppableContainers.filter(
        ({ data }) =>
          (data.current?.groupDomain ?? "channels") === domain &&
          (!data.current?.accepts ||
            data.current.accepts.includes(args.active.data.current?.rowKind)),
      ),
    });
  const groups = args.droppableContainers
    .filter(
      ({ data }) =>
        data.current?.group &&
        (data.current?.groupDomain ?? "channels") === domain,
    )
    .sort((a, b) => a.data.current?.groupIndex - b.data.current?.groupIndex);
  // Card motion and text resizing can outlive dnd-kit's cached measurements
  // (notably in WebKit). Use the visible card bounds for this small group list.
  const rects = new Map(args.droppableRects);
  for (const group of groups) {
    const node = group.node.current;
    if (node) rects.set(group.id, node.getBoundingClientRect());
  }
  const hits = pointerWithin({
    ...args,
    droppableRects: rects,
    droppableContainers: groups,
  });
  if (hits.length) return hits;
  const pointer = args.pointerCoordinates;
  if (!pointer) return [];
  for (let index = 1; index < groups.length; index++) {
    const above = groups[index - 1];
    const below = groups[index];
    if (!above || !below) continue;
    const top = rects.get(above.id);
    const bottom = rects.get(below.id);
    if (
      top &&
      bottom &&
      pointer.y > top.bottom &&
      pointer.y < bottom.top &&
      pointer.x >= Math.max(top.left, bottom.left) &&
      pointer.x <= Math.min(top.right, bottom.right)
    ) {
      const target =
        args.active.data.current.groupIndex < below.data.current?.groupIndex
          ? above
          : below;
      return [{ id: target.id }];
    }
  }
  return [];
};

// A click must still select the row; only a deliberate pull starts a move.
// useSensor memoizes on this object, so an inline literal would rebuild the
// sensors, and re-render every draggable row, on each sidebar render.
const pointerSensorOptions = { activationConstraint: { distance: 6 } };

/**
 * Pointer moves between sidebar sections (Messages groups, Starred and Channels,
 * or Solo projects and Chats), and reorders saved groups by their header. A drop
 * only reports its destination, so the caller saves it exactly like the menus'
 * moves; those menus remain the keyboard path.
 */
export function ChannelSidebarDnd({
  writable,
  onMove,
  onReorder,
  onCreateSection,
  overlay,
  children,
}: {
  writable: boolean;
  onMove: (channelId: string, sectionKey: string) => void;
  onReorder: (sectionKey: string, overKey: string) => void;
  onCreateSection?: ((channelId: string) => void) | undefined;
  overlay: (id: string, group: boolean) => ReactNode;
  children: ReactNode;
}) {
  const animateDrop = useRef(false);
  const [dragging, setDragging] = useState<{ id: string; group: boolean }>();
  const sensors = useSensors(useSensor(PointerSensor, pointerSensorOptions));
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={sidebarCollisions}
      // The sidebar's own status is its loading notice; drag announcements live outside it.
      accessibility={{ container: document.body }}
      onDragStart={({ active }) => {
        animateDrop.current = false;
        setDragging({
          id: String(active.id),
          group: !!active.data.current?.group,
        });
      }}
      onDragCancel={() => {
        animateDrop.current = false;
        setDragging(undefined);
      }}
      onDragEnd={({ active, over }) => {
        setDragging(undefined);
        animateDrop.current =
          !!over &&
          over.id !== active.id &&
          !!active.data.current?.group &&
          !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (!over) return;
        if (active.data.current?.group) {
          if (over.id !== active.id)
            onReorder(String(active.id), String(over.id));
        } else if (over.id === CREATE_SECTION) {
          if (writable) onCreateSection?.(String(active.id));
        } else if (over.id !== active.data.current?.sectionKey)
          onMove(String(active.id), String(over.id));
      }}
    >
      <SidebarCardReorder value={animateDrop}>
        <Writable.Provider value={writable}>{children}</Writable.Provider>
      </SidebarCardReorder>
      {createPortal(
        // The optimistic move relocates the row, so nothing remains to settle back onto.
        <DragOverlay dropAnimation={null}>
          {dragging ? overlay(dragging.id, dragging.group) : null}
        </DragOverlay>,
        document.body,
      )}
    </DndContext>
  );
}

function CreateSectionDropTarget({
  container,
}: {
  container: HTMLElement | null;
}) {
  const { active } = useDndContext();
  const enabled =
    useContext(Writable) && !!active && !active.data.current?.group;
  const { setNodeRef, isOver } = useDroppable({
    id: CREATE_SECTION,
    disabled: !enabled,
  });
  if (!container) return null;
  return createPortal(
    <div
      ref={setNodeRef}
      className={styles.createSectionSlot}
      data-create-section-trigger=""
      data-shown={enabled || undefined}
      aria-hidden={!enabled}
      inert={!enabled}
    >
      <section
        className={styles.createSectionDrop}
        aria-label="New section"
        data-create-section-drop={enabled ? "" : undefined}
        data-drop-target={isOver || undefined}
      >
        <PlusIcon size={16} aria-hidden="true" />
        <span>New section</span>
      </section>
    </div>,
    container,
  );
}

/**
 * Frames only a channel's select surface, so its sessions never start a move.
 * The frame stays mounted while placement is read-only: the row keeps its
 * focus and open menu when a save starts or settles.
 */
export function DraggableChannel({
  channelId,
  sectionKey,
  rowKind = "channel",
  children,
}: {
  channelId: string;
  sectionKey: string;
  rowKind?: SidebarRowKind;
  children: ReactNode;
}) {
  const { setNodeRef, listeners, isDragging } = useDraggable({
    id: channelId,
    data: { sectionKey, groupDomain: "channels", rowKind },
    disabled: !useContext(Writable),
  });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      data-channel-dragging={isDragging || undefined}
    >
      {children}
    </div>
  );
}

export function DraggableConversation(
  props: Omit<ComponentProps<typeof DraggableChannel>, "rowKind">,
) {
  return <DraggableChannel {...props} rowKind="dm" />;
}

/** Shared header drag and post-drag click suppression for Team and Solo. */
export function useSidebarSectionDrag({
  sectionKey,
  reorderable,
  groupIndex,
  groupDomain = "channels",
}: {
  sectionKey: string;
  reorderable: boolean;
  groupIndex: number;
  groupDomain?: string;
}) {
  const drag = useDraggable({
    id: sectionKey,
    data: { group: true, groupIndex, groupDomain },
    disabled: !reorderable,
  });
  const suppressClick = useRef(false);
  const handle = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (!reorderable) return;
    const document = handle.current?.ownerDocument;
    if (!document) return;
    const suppressDragClick = (event: MouseEvent) => {
      if (
        !suppressClick.current ||
        event.detail === 0 ||
        !(event.target instanceof Node) ||
        !handle.current?.contains(event.target)
      )
        return;
      // dnd-kit stops clicks at document capture before React can cancel the
      // native summary toggle. Cancel there too, including its cleanup window.
      event.preventDefault();
      event.stopPropagation();
    };
    document.addEventListener("click", suppressDragClick, true);
    return () => document.removeEventListener("click", suppressDragClick, true);
  }, [reorderable]);
  useDndMonitor({
    onDragStart: ({ active }) => {
      if (active.id === sectionKey) suppressClick.current = true;
    },
  });
  return {
    isDragging: drag.isDragging,
    handle: reorderable
      ? {
          ref: (node: HTMLElement | null) => {
            handle.current = node;
            drag.setNodeRef(node);
          },
          listeners: {
            ...drag.listeners,
            onPointerDown: (event: PointerEvent<HTMLElement>) => {
              suppressClick.current = false;
              drag.listeners?.onPointerDown?.(event);
            },
          },
        }
      : undefined,
  };
}

/** A reorderable saved group drags by its header, never its rows or actions. */
export function DroppableSidebarSection({
  disabled,
  reorderable,
  groupIndex,
  groupDomain = "channels",
  accepts,
  createSectionTarget,
  createSectionContainer = null,
  ...section
}: ComponentProps<typeof SidebarSection> & {
  disabled: boolean;
  reorderable: boolean;
  groupIndex: number;
  groupDomain?: string;
  /** Row kinds a drop may place here; every row when omitted. */
  accepts?: readonly SidebarRowKind[];
  createSectionTarget?: boolean;
  createSectionContainer?: HTMLElement | null;
}) {
  const { setNodeRef, isOver, active } = useDroppable({
    id: section.sectionKey,
    data: { group: reorderable, groupIndex, groupDomain, accepts },
    disabled,
    // dnd-kit queues a re-measure of only the droppable that resized and clears
    // that queue after each render, losing ids queued in between: a section
    // resized mid-drag (text size) could keep a stale drop target. An empty list
    // keeps dnd-kit's drag-start queue: any section's resize re-measures every
    // enabled droppable.
    resizeObserverConfig: { updateMeasurementsFor: [] },
  });
  const drag = useSidebarSectionDrag({
    sectionKey: section.sectionKey,
    reorderable,
    groupIndex,
    groupDomain,
  });
  const group = !!active?.data.current?.group;
  const from = active?.data.current?.groupIndex;
  return (
    <>
      {createSectionTarget && (
        <CreateSectionDropTarget container={createSectionContainer} />
      )}
      <SidebarSection
        {...section}
        dropRef={setNodeRef}
        dropTarget={
          !group &&
          isOver &&
          active?.data.current?.sectionKey !== section.sectionKey
        }
        dropEdge={
          group && isOver && active?.id !== section.sectionKey
            ? from !== undefined && from < groupIndex
              ? "after"
              : "before"
            : undefined
        }
        dragHandle={drag.handle}
        dragging={drag.isDragging}
      />
    </>
  );
}
