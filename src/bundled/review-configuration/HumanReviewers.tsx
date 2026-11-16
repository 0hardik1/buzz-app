import { useSyncExternalStore } from "react";
import type { RelaySession } from "../../features/relay/session";
import { useChannelList } from "../../features/relay/react";
import { Button } from "../../shared/design-system/ui/Button";
import { Select } from "../../shared/design-system/ui/Select";
import { Checkbox } from "../../shared/design-system/ui/Checkbox";
import type { ReviewLane } from "./configuration";

export function HumanReviewers({
  session,
  channel,
  lane,
  disabled,
  onChange,
}: {
  session: RelaySession;
  channel: string;
  lane: ReviewLane;
  disabled: boolean;
  onChange(lane: ReviewLane): void;
}) {
  const channels = useChannelList(session.channels);
  const profiles = useSyncExternalStore(
    session.profiles.subscribe,
    session.profiles.snapshot,
  );
  const humans = lane.humanReviewers ?? [];
  const members =
    channels.channels.find((item) => item.id === channel)?.members ?? [];
  const available = members.filter((key) => {
    const profile = profiles.get(key);
    return (
      profile &&
      !profile.isAgent &&
      !profile.ownerPubkey &&
      !session.profiles.owner?.(key) &&
      !lane.reviewers.includes(key)
    );
  });
  return (
    <div className="review-config-form">
      <Select
        label="People"
        variant="field"
        value=""
        placeholder="Add human reviewer…"
        disabled={disabled || !available.length || lane.reviewers.length >= 20}
        groups={[
          {
            label: "Channel members",
            options: available.map((key) => ({
              value: key,
              label: profiles.get(key)?.name ?? key,
            })),
          },
        ]}
        onValueChange={(key) => {
          if (available.includes(key))
            onChange({
              ...lane,
              reviewers: [...lane.reviewers, key],
              humanReviewers: [...humans, key],
            });
        }}
        description="Select people who already belong to this private channel. They receive a mention and record their own review in Buzz."
      />
      {humans.map((key) => (
        <div key={key} className="review-config-agent-row">
          <span>{profiles.get(key)?.name ?? key}</span>
          <Button
            disabled={disabled}
            onClick={() =>
              onChange({
                ...lane,
                reviewers: lane.reviewers.filter((item) => item !== key),
                minimumReviewers: Math.min(
                  lane.minimumReviewers ?? 1,
                  Math.max(1, lane.reviewers.length - 1),
                ),
                humanReviewers: humans.filter((item) => item !== key),
              })
            }
          >
            Remove {profiles.get(key)?.name ?? "person"}
          </Button>
        </div>
      ))}
      <Checkbox
        label="Require at least one human review"
        checked={lane.requireHuman ?? false}
        disabled={disabled}
        onCheckedChange={(requireHuman) => onChange({ ...lane, requireHuman })}
      />
      <p className="text-caption text-subtle">
        If an agent is assigned, a required human gets a separate review thread
        in the same lane. Both outcomes count toward completion.
      </p>
    </div>
  );
}
