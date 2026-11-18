import { useState } from "react";
import { CaretRightIcon } from "../../../shared/design-system/icons";
import { Button } from "../../../shared/design-system/ui/Button";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import type { CardDefinition, CardProps } from "../card-types";
import "./calendar.css";

const sampleToday = new Date(2026, 10, 17);
const meetings = [
  { time: "", title: "No plans" },
  { time: "9:00", title: "Project sync" },
  { time: "10:30", title: "Design sync" },
  { time: "11:00", title: "Review" },
  { time: "2:00", title: "Focus time" },
  { time: "3:00", title: "Wrap-up" },
  { time: "", title: "No plans" },
];

function MiniCalendar({ variant }: CardProps) {
  const [selected, setSelected] = useState(sampleToday);
  const meeting = meetings[selected.getDay()] ?? {
    time: "",
    title: "No plans",
  };
  const monday = selected.getDate() - ((selected.getDay() + 6) % 7);
  const week = Array.from(
    { length: 7 },
    (_, index) =>
      new Date(selected.getFullYear(), selected.getMonth(), monday + index),
  );
  return (
    <div className="mini-calendar-widget" data-treatment={variant}>
      <div className="mini-calendar-week">
        {week.map((date) => (
          <div className="mini-calendar-day" key={date.toDateString()}>
            <span className="text-caption text-subtle" aria-hidden="true">
              {date.toLocaleDateString("en-US", { weekday: "narrow" })}
            </span>
            <Button
              size="inline"
              variant={
                date.toDateString() === selected.toDateString()
                  ? "prominent"
                  : "ghost"
              }
              aria-pressed={date.toDateString() === selected.toDateString()}
              aria-label={date.toLocaleDateString("en-US", {
                dateStyle: "full",
              })}
              onClick={() => setSelected(date)}
            >
              {date.getDate()}
            </Button>
          </div>
        ))}
      </div>
      <div className="mini-calendar-next">
        <div
          className="mini-calendar-appointment"
          aria-live="polite"
          aria-atomic="true"
        >
          {meeting.time && (
            <span
              className={
                variant === "visual"
                  ? "text-label-sm"
                  : "text-caption text-subtle"
              }
            >
              {meeting.time}
            </span>
          )}
          <span className={variant === "visual" ? "text-caption" : "text-body"}>
            {meeting.title}
          </span>
        </div>
        <span data-widget-secondary>
          <IconButton
            aria-label="Next week"
            icon={<CaretRightIcon />}
            onClick={() =>
              setSelected(
                new Date(
                  selected.getFullYear(),
                  selected.getMonth(),
                  selected.getDate() + 7,
                ),
              )
            }
          />
        </span>
      </div>
    </div>
  );
}

export const miniCalendar: CardDefinition = {
  id: "calendar",
  title: "Calendar",
  subtitle: "",
  category: "Your ideas",
  purpose: "One week and the next thing on your day.",
  how: "Choose a date to update the synthetic agenda, or advance one week. Dates are calculated locally, including month and year boundaries.",
  source: "Your idea · Local sample calendar · No calendar connection",
  component: MiniCalendar,
};
