import { useState } from "react";
import {
  CaretRightIcon,
  CheckCircleIcon,
  ClockIcon,
  GitPullRequestIcon,
} from "../../../shared/design-system/icons";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import type { CardDefinition, CardProps } from "../card-types";
import "./pr-tracker.css";

const repositories = [
  {
    name: "All repos",
    ready: 1,
    review: 2,
    building: 1,
    title: "A quieter sidebar",
  },
  {
    name: "buzz",
    ready: 1,
    review: 0,
    building: 1,
    title: "A quieter sidebar",
  },
  {
    name: "goose",
    ready: 0,
    review: 1,
    building: 0,
    title: "Remember workspace tabs",
  },
];
function PRTracker({ variant }: CardProps) {
  const [index, setIndex] = useState(0);
  const repo = repositories[index] ?? repositories[0];
  if (!repo) return null;
  const statuses = [
    { label: "Ready", count: repo.ready, icon: CheckCircleIcon },
    { label: "Review", count: repo.review, icon: GitPullRequestIcon },
    { label: "Building", count: repo.building, icon: ClockIcon },
  ];
  return (
    <div className="pr-widget" data-treatment={variant}>
      <div className="pr-widget-counts">
        {statuses.map(({ label, count, icon: Icon }) => (
          <div key={label} data-status={label}>
            <span className="pr-widget-count text-label-sm">
              <Icon size={14} />
              {count}
            </span>
            <span className="text-caption pr-widget-label">{label}</span>
          </div>
        ))}
      </div>
      {variant === "visual" && (
        <div
          className="pr-widget-readiness"
          role="img"
          aria-label={`${repo.ready} ready, ${repo.review} in review, ${repo.building} building`}
        >
          {statuses
            .filter(({ count }) => count > 0)
            .map(({ label, count }) => (
              <span
                key={label}
                data-status={label}
                style={{ flexGrow: count }}
              />
            ))}
        </div>
      )}
      <p
        className={`pr-widget-title ${variant === "editorial" ? "text-label-sm" : "text-body"}`}
      >
        {repo.title}
      </p>
      <div className="pr-widget-action" data-widget-secondary>
        <IconButton
          variant="ghost"
          aria-label={`Repository: ${repo.name}. Show next repository`}
          title={`Repository: ${repo.name}`}
          icon={<CaretRightIcon size={16} />}
          onClick={() => setIndex((index + 1) % repositories.length)}
        />
      </div>
    </div>
  );
}
export const prTracker: CardDefinition = {
  id: "pr-tracker",
  title: "Open PRs",
  subtitle: "Your review queue at a glance.",
  category: "Your ideas",
  purpose: "Keep a tiny review queue beside the conversation.",
  how: "Cycle repositories to update three status counts and the first PR title.",
  source: "Synthetic PR data; no GitHub connection.",
  component: PRTracker,
};
