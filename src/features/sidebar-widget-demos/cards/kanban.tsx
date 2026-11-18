import { useState } from "react";
import { ArrowRightIcon } from "../../../shared/design-system/icons";
import { Button } from "../../../shared/design-system/ui/Button";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import type { CardDefinition, CardProps } from "../card-types";
import "./kanban.css";

type Lane = "review" | "progress" | "queued" | "done";
type Task = { id: string; title: string; lane: Lane };
const columns = [
  { id: "review", label: "For review", short: "Review" },
  { id: "progress", label: "In progress", short: "Doing" },
  { id: "queued", label: "Queued", short: "Queue" },
  { id: "done", label: "Done", short: "Done" },
] as const;
const taskTitles: Record<Lane, string[]> = {
  review: [
    "Empty states",
    "Shortcuts",
    "Draft recovery",
    "Search filters",
    "Focus order",
    "Media captions",
  ],
  progress: [
    "Rail resizing",
    "Keep drafts",
    "Media preview",
    "Unread cues",
    "Mention picker",
    "Link summaries",
    "Thread loading",
    "Emoji search",
    "Channel details",
    "Profile editing",
  ],
  queued: [
    "Saved searches",
    "Quiet hours",
    "File previews",
    "Pinned threads",
    "Message export",
    "Invite links",
    "Agent handoff",
    "Community art",
  ],
  done: [
    "Focus restore",
    "Theme choice",
    "Link previews",
    "Draft sync",
    "Avatar crops",
    "Scroll anchors",
    "Text scaling",
    "Copy messages",
    "Retry uploads",
    "Channel mute",
    "Reply context",
    "Keyboard help",
  ],
};
const startingTasks: Task[] = columns.flatMap(({ id: lane }) =>
  taskTitles[lane].map((title) => ({ id: `${lane}-${title}`, title, lane })),
);
const nextLane: Record<Lane, Lane> = {
  queued: "progress",
  progress: "review",
  review: "done",
  done: "queued",
};

function MiniKanban({ variant }: CardProps) {
  const [tasks, setTasks] = useState(startingTasks);
  const [selected, setSelected] = useState<Lane>("review");
  const current = tasks.find((task) => task.lane === selected);
  const destination = nextLane[selected];
  return (
    <div className="kanban-widget text-body-sm" data-variant={variant}>
      <div className="kanban-columns">
        {columns.map((column) => {
          const laneTasks = tasks.filter((task) => task.lane === column.id);
          return (
            <div className="kanban-well" data-lane={column.id} key={column.id}>
              <Button
                size="inline"
                variant={selected === column.id ? "subtle" : "ghost"}
                aria-pressed={selected === column.id}
                aria-label={`${column.label}, ${laneTasks.length} tasks`}
                onClick={() => setSelected(column.id)}
              >
                {column.short}
              </Button>
              <div className="kanban-dots" aria-hidden="true">
                {laneTasks.map((task) => (
                  <span key={task.id} />
                ))}
              </div>
            </div>
          );
        })}
      </div>
      <div className="kanban-task">
        <span className="text-body-sm">
          {current?.title ?? "All clear here"}
        </span>
      </div>
      <span data-widget-secondary="">
        <IconButton
          size="xs"
          aria-label={
            current
              ? `Move ${current.title} to ${columns.find((column) => column.id === destination)?.label}`
              : "No tasks to move"
          }
          disabled={!current}
          icon={<ArrowRightIcon size={12} />}
          onClick={() => {
            if (current)
              setTasks((items) =>
                items.map((task) =>
                  task.id === current.id
                    ? { ...task, lane: destination }
                    : task,
                ),
              );
          }}
        />
      </span>
    </div>
  );
}

export const miniKanban: CardDefinition = {
  id: "mini-kanban",
  title: "Little board",
  subtitle: "What’s moving",
  category: "Your ideas",
  purpose: "See four stages of a small project as four quiet wells of work.",
  how: "Each colored dot represents one actual synthetic task: initially 6 for review, 10 in progress, 8 queued, and 12 done. Select a well by its label; its full state and current count are announced accessibly. The secondary arrow moves the shown task forward, or returns a done task to the queue, updating both wells.",
  source: "36 synthetic tasks · local state only",
  component: MiniKanban,
};
