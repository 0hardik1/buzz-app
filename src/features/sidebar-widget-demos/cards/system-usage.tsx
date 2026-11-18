import { useState } from "react";
import { CaretRightIcon } from "../../../shared/design-system/icons";
import { Button } from "../../../shared/design-system/ui/Button";
import type { CardDefinition, CardProps } from "../card-types";
import "./system-usage.css";

const metrics = [
  {
    name: "CPU",
    value: "32%",
    detail: "RAM 18.4 / 32 GB",
    points: [24, 28, 22, 38, 30, 46, 40, 34, 48, 42, 36, 32],
  },
  {
    name: "RAM",
    value: "18.4 GB",
    detail: "32 GB total · CPU 32%",
    points: [44, 47, 49, 45, 51, 54, 52, 55, 58, 60, 59, 58],
  },
  {
    name: "Disk",
    value: "286 GB",
    detail: "512 GB total · 56% used",
    points: [48, 48, 49, 49, 50, 51, 52, 52, 54, 55, 56, 56],
  },
];
const slots = Array.from({ length: 12 }, (_, index) => index);
function SystemUsage({ variant }: CardProps) {
  const [index, setIndex] = useState(0);
  const metric = metrics[index] ?? metrics[0];
  if (!metric) return null;
  return (
    <div className="system-widget" data-treatment={variant}>
      <div className="system-widget-reading">
        <p className="text-heading">{metric.value}</p>
        <Button
          size="inline"
          variant="ghost"
          aria-label={`${metric.name}. Show next metric`}
          onClick={() => setIndex((index + 1) % metrics.length)}
        >
          {metric.name}
          <CaretRightIcon size={12} />
        </Button>
      </div>
      <p className="system-widget-detail text-caption">{metric.detail}</p>
      <div
        className="system-widget-chart"
        role="img"
        aria-label={`${metric.name} recent usage, currently ${metric.value}`}
      >
        {slots.map((slot) => (
          <span
            key={slot}
            style={
              variant === "visual"
                ? undefined
                : { height: `${metric.points[slot] ?? 0}%` }
            }
          >
            {variant === "visual" && (
              <i
                style={{
                  width: `${Math.max(0, Math.min(100, (((metric.points[11] ?? 0) / 100) * 12 - slot) * 100))}%`,
                }}
              />
            )}
          </span>
        ))}
      </div>
    </div>
  );
}
export const systemUsage: CardDefinition = {
  id: "system-usage",
  title: "System usage",
  subtitle: "A compact machine pulse.",
  category: "Your ideas",
  purpose: "Check CPU and memory without leaving your work.",
  how: "Cycle CPU, RAM, and disk readings with one compact control.",
  source: "Synthetic system readings; no device API.",
  component: SystemUsage,
};
