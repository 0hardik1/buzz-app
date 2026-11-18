import { useState } from "react";
import { CaretRightIcon } from "../../../shared/design-system/icons";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import type { CardDefinition, CardProps } from "../card-types";
import "./agent-usage.css";

const agents = [
  {
    name: "All",
    tokens: "129k",
    points: [1, 1, 0, 1, 5, 12, 23, 32, 25, 14, 9, 6],
  },
  {
    name: "Builder",
    tokens: "68k",
    points: [1, 0, 0, 1, 2, 4, 12, 18, 14, 8, 5, 3],
  },
  {
    name: "Scout",
    tokens: "37k",
    points: [0, 1, 0, 0, 3, 7, 8, 9, 4, 2, 1, 2],
  },
  {
    name: "Reviewer",
    tokens: "24k",
    points: [0, 0, 0, 0, 0, 1, 3, 5, 7, 4, 3, 1],
  },
];
const slots = Array.from({ length: 12 }, (_, index) => index);
function AgentUsage({ variant }: CardProps) {
  const [index, setIndex] = useState(0);
  const agent = agents[index] ?? agents[0];
  if (!agent) return null;
  const peak = Math.max(...agent.points);
  const coordinates = agent.points.map((value, slot) => ({
    x: 3 + (slot / 11) * 74,
    y: 29 - (value / 36) * 26,
  }));
  const peakPoint = coordinates[agent.points.indexOf(peak)];
  return (
    <div className="agent-widget" data-treatment={variant}>
      <div className="agent-widget-signal">
        <p className="text-heading">{agent.tokens}</p>
        <p className="agent-widget-detail text-caption">tokens today</p>
      </div>
      <div className="agent-widget-action" data-widget-secondary>
        <IconButton
          variant="ghost"
          aria-label={`${agent.name === "All" ? "All agents" : agent.name}. Show next agent`}
          title={`${agent.name === "All" ? "All agents" : agent.name} · Next agent`}
          icon={<CaretRightIcon size={16} />}
          onClick={() => setIndex((index + 1) % agents.length)}
        />
      </div>
      <div
        className="agent-widget-chart"
        role="img"
        aria-label={`${agent.tokens} tokens over 24 hours for ${agent.name === "All" ? "all agents" : agent.name}`}
      >
        {variant === "visual" ? (
          <svg viewBox="0 0 80 32" aria-hidden="true">
            <polyline
              points={coordinates.map(({ x, y }) => `${x},${y}`).join(" ")}
            />
            {peakPoint && <circle cx={peakPoint.x} cy={peakPoint.y} r="2.5" />}
          </svg>
        ) : (
          slots.map((slot) => (
            <span
              key={slot}
              style={{ height: `${((agent.points[slot] ?? 0) / 36) * 100}%` }}
              data-peak={agent.points[slot] === peak}
            />
          ))
        )}
      </div>
    </div>
  );
}
export const agentUsage: CardDefinition = {
  id: "agent-usage",
  title: "Agent usage",
  subtitle: "A tiny token pulse.",
  category: "Your ideas",
  purpose: "Keep today's agent activity visible in a tiny space.",
  how: "Cycle through all agents, Builder, Scout, and Reviewer to change the total and activity chart.",
  source: "Synthetic agent activity; no provider connection.",
  component: AgentUsage,
};
