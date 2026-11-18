import { useEffect, useState } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { IconButton } from "../../shared/design-system/ui/IconButton";
import { Checkbox } from "../../shared/design-system/ui/Checkbox";
import { Input } from "../../shared/design-system/ui/Input";
import { Select } from "../../shared/design-system/ui/Select";
import {
  ArrowCounterClockwiseIcon,
  PauseIcon,
  PlayIcon,
  PlusIcon,
  XIcon,
} from "../../shared/design-system/icons";
import type { CanvasObject } from "./canvas-state";
import { ClockWidget } from "./CanvasObject";
import styles from "./HomeCanvas.module.css";

const focusSeconds = 25 * 60;
/** Wall-clock deadline survives app sleep, unmount and reload; ticking only paints the readout. */
export function FocusWidget({
  object,
  change,
}: {
  object: CanvasObject;
  change(patch: Partial<CanvasObject>): boolean;
}) {
  const [now, setNow] = useState(Date.now);
  const timer = object.timer ?? { remaining: focusSeconds };
  const remaining =
    timer.endsAt === undefined
      ? timer.remaining
      : Math.min(
          timer.remaining,
          Math.max(0, Math.ceil((timer.endsAt - now) / 1000)),
        );
  const running = timer.endsAt !== undefined && remaining > 0;
  useEffect(() => {
    if (!running) return;
    setNow(Date.now());
    const tick = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(tick);
  }, [running]);
  const progress = 1 - remaining / focusSeconds;
  return (
    <div className={styles.focusWidget}>
      <div className={styles.timerDial}>
        <svg viewBox="0 0 160 160" aria-hidden="true">
          <circle cx="80" cy="80" r="72" className={styles.timerTrack} />
          <circle
            cx="80"
            cy="80"
            r="72"
            className={styles.timerProgress}
            pathLength="1"
            strokeDasharray={`${progress} 1`}
          />
        </svg>
        <div className={styles.timerReadout}>
          <span
            className="text-title"
            role="timer"
            aria-label={`${Math.floor(remaining / 60)} minutes ${remaining % 60} seconds remaining`}
          >
            {`${Math.floor(remaining / 60)}`.padStart(2, "0")}:
            {`${remaining % 60}`.padStart(2, "0")}
          </span>
          <span className="text-caption text-subtle">
            {remaining === 0
              ? "Take a breather"
              : running
                ? "One thing at a time"
                : "A little room to focus"}
          </span>
        </div>
      </div>
      <div className={styles.widgetActions}>
        <Button
          size="sm"
          variant="prominent"
          onClick={() => {
            const current = Date.now();
            setNow(current);
            change({
              timer: running
                ? {
                    remaining: Math.max(
                      0,
                      Math.ceil(((timer.endsAt ?? current) - current) / 1000),
                    ),
                  }
                : {
                    remaining: remaining || focusSeconds,
                    endsAt: current + (remaining || focusSeconds) * 1000,
                  },
            });
          }}
        >
          {running ? <PauseIcon size={16} /> : <PlayIcon size={16} />}
          {running
            ? "Pause"
            : remaining === focusSeconds || remaining === 0
              ? "Start focus"
              : "Resume"}
        </Button>
        <IconButton
          aria-label="Reset focus timer"
          icon={<ArrowCounterClockwiseIcon size={16} />}
          onClick={() => change({ timer: { remaining: focusSeconds } })}
        />
      </div>
    </div>
  );
}

export function ChecklistWidget({
  object,
  change,
}: {
  object: CanvasObject;
  change(patch: Partial<CanvasObject>): boolean;
}) {
  const [text, setText] = useState("");
  const tasks = object.tasks ?? [];
  return (
    <div className={styles.stack}>
      {!tasks.length && (
        <p className="text-body text-subtle">A few things that matter today.</p>
      )}
      {tasks.map((task) => (
        <div key={task.id} className={styles.checklistRow}>
          <Checkbox
            size="sm"
            checked={task.done}
            onCheckedChange={(done) =>
              change({
                tasks: tasks.map((item) =>
                  item.id === task.id ? { ...item, done } : item,
                ),
              })
            }
            label={
              <span className={task.done ? "text-subtle" : "text-standard"}>
                {task.done ? <s>{task.text}</s> : task.text}
              </span>
            }
          />
          <IconButton
            aria-label={`Remove ${task.text}`}
            icon={<XIcon size={14} />}
            onClick={() =>
              change({ tasks: tasks.filter((item) => item.id !== task.id) })
            }
          />
        </div>
      ))}
      <form
        className={styles.checklistForm}
        onSubmit={(event) => {
          event.preventDefault();
          const value = text.trim();
          if (!value || tasks.length >= 12) return;
          if (
            change({
              tasks: [
                ...tasks,
                { id: crypto.randomUUID(), text: value, done: false },
              ],
            })
          )
            setText("");
        }}
      >
        <Input
          aria-label="Add a checklist item"
          placeholder="One small thing…"
          value={text}
          onChange={(event) => setText(event.target.value)}
          maxLength={160}
          disabled={tasks.length >= 12}
        />
        <IconButton
          type="submit"
          aria-label="Add checklist item"
          icon={<PlusIcon size={16} />}
          disabled={!text.trim() || tasks.length >= 12}
        />
      </form>
      {!!tasks.length && (
        <p className="text-caption text-subtle">
          {tasks.filter((task) => task.done).length} of {tasks.length} done
        </p>
      )}
    </div>
  );
}

const timezones = [
  { label: "New York", value: "America/New_York" },
  { label: "Los Angeles", value: "America/Los_Angeles" },
  { label: "London", value: "Europe/London" },
  { label: "Paris", value: "Europe/Paris" },
  { label: "Kolkata", value: "Asia/Kolkata" },
  { label: "Tokyo", value: "Asia/Tokyo" },
  { label: "Sydney", value: "Australia/Sydney" },
  { label: "UTC", value: "UTC" },
];
export function WorldClockWidget({
  object,
  change,
}: {
  object: CanvasObject;
  change(patch: Partial<CanvasObject>): boolean;
}) {
  const timezone = object.timezone ?? "Asia/Tokyo";
  return (
    <div className={styles.stack}>
      <Select
        label="Clock city"
        variant="compact"
        size="sm"
        value={timezone}
        groups={[{ label: "Around the world", options: timezones }]}
        onValueChange={(timezone) => change({ timezone })}
      />
      <ClockWidget timezone={timezone} />
    </div>
  );
}
