import { useEffect, useRef, useState } from "react";
import { useReviewAgents } from "./use-review-agents";
import type { RelaySession } from "../../features/relay/session";
import { Button } from "../../shared/design-system/ui/Button";
import { Checkbox } from "../../shared/design-system/ui/Checkbox";
import { Input } from "../../shared/design-system/ui/Input";
import { Field } from "../../shared/design-system/ui/Field";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { Select } from "../../shared/design-system/ui/Select";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import {
  DEFAULT_ADMISSION,
  saveConfiguration,
  type SavedReviewConfig,
} from "./configuration";

export function AdmissionEditor({
  session,
  channel,
  previous,
  writable,
  onSaved,
  onEditingChange,
}: {
  session: RelaySession;
  channel: string;
  previous: SavedReviewConfig;
  writable: boolean;
  onSaved: (value: SavedReviewConfig) => void;
  onEditingChange: (editing: boolean) => void;
}) {
  const choices = useReviewAgents(session, channel);
  const [draft, setDraft] = useState(
    previous.config.admission ?? DEFAULT_ADMISSION,
  );
  const [limit, setLimit] = useState(
    String(previous.config.maxPrsPerDay ?? ""),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const operation = useRef<AbortController | undefined>(undefined);
  const dirty =
    limit !== String(previous.config.maxPrsPerDay ?? "") ||
    JSON.stringify(draft) !==
      JSON.stringify(previous.config.admission ?? DEFAULT_ADMISSION);
  useEffect(() => {
    setDraft(previous.config.admission ?? DEFAULT_ADMISSION);
    setLimit(String(previous.config.maxPrsPerDay ?? ""));
    setError("");
  }, [previous]);
  useEffect(() => {
    onEditingChange(dirty || busy);
    return () => onEditingChange(false);
  }, [dirty, busy, onEditingChange]);
  useEffect(() => () => operation.current?.abort(), []);
  async function save() {
    if (!writable || operation.current) return;
    const controller = new AbortController();
    operation.current = controller;
    setBusy(true);
    setError("");
    try {
      const next = await saveConfiguration(
        session,
        channel,
        {
          ...previous.config,
          admission: draft,
          maxPrsPerDay: limit.trim() ? Number(limit) : undefined,
        },
        previous,
        AbortSignal.any([controller.signal, AbortSignal.timeout(20_000)]),
      );
      if (!controller.signal.aborted) onSaved(next);
    } catch (reason) {
      if (!controller.signal.aborted)
        setError(
          `${reason instanceof Error ? reason.message : "Could not save admission checks."} Your draft is preserved. If settings changed elsewhere, copy it before reloading.`,
        );
    } finally {
      operation.current = undefined;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <section className="review-config-form" aria-label="Admission checks">
      <InlineHeader
        title="Admission checks"
        subtitle="All enabled checks must pass before lane routing. Changes apply to new submissions."
      />
      <SettingsGroup layout="form">
        <Field
          label="Maximum PRs per day"
          description="Leave empty for no limit. Shared across this repository/channel; resets at midnight UTC. New reviews count once, including triage rejections and delete/repost. Reminders and re-review do not count again."
        >
          <Input
            type="number"
            min={1}
            max={100000}
            step={1}
            placeholder="No limit"
            value={limit}
            disabled={!writable || busy}
            onValueChange={setLimit}
          />
        </Field>
        {(
          [
            ["ready", "Require ready for review (non-draft)"],
            ["ci", "Require green CI"],
            ["conflicts", "Require no merge conflicts"],
            ["triage", "Enable agent triage"],
          ] as const
        ).map(([key, label]) => (
          <Checkbox
            key={key}
            label={label}
            checked={draft[key]}
            disabled={!writable || busy}
            onCheckedChange={(checked) =>
              setDraft({ ...draft, [key]: checked })
            }
          />
        ))}
        {draft.ci && (
          <p className="text-caption text-subtle">
            All reported checks must be successful, neutral, or skipped. Pending
            or missing CI blocks submission.
          </p>
        )}
        {draft.triage && (
          <>
            <Select
              label="Triage agent"
              variant="field"
              value={draft.agent}
              disabled={!writable || busy}
              placeholder="Choose an agent"
              onValueChange={(agent) => setDraft({ ...draft, agent })}
              groups={[
                {
                  label: "Agents",
                  options: choices.identities
                    .filter(
                      (agent) =>
                        agent.pubkey === draft.agent ||
                        choices.selectable.some(
                          (item) => item.pubkey === agent.pubkey,
                        ),
                    )
                    .map((agent) => ({
                      value: agent.pubkey,
                      label: `${agent.managedName ?? agent.name}${choices.selectable.some((item) => item.pubkey === agent.pubkey) ? "" : " — unavailable"}`,
                    })),
                },
              ]}
            />
            <Button
              size="sm"
              disabled={busy || choices.pending}
              onClick={() => {
                void session.agentChoices
                  .refresh(true)
                  .catch((reason) =>
                    setError(
                      reason instanceof Error
                        ? reason.message
                        : "Could not refresh agents.",
                    ),
                  );
              }}
            >
              Refresh agents
            </Button>
            {choices.error && <p role="alert">{choices.error}</p>}
            <Field
              label="Triage instructions"
              description="For example: reject duplicate PRs and link the existing PR."
            >
              <Textarea
                required
                rows={3}
                maxLength={8000}
                disabled={!writable || busy}
                value={draft.instructions}
                onChange={(event) =>
                  setDraft({ ...draft, instructions: event.target.value })
                }
              />
            </Field>
          </>
        )}
        <div className="review-config-actions">
          <Button
            disabled={!dirty || busy}
            onClick={() => {
              setDraft(previous.config.admission ?? DEFAULT_ADMISSION);
              setLimit(String(previous.config.maxPrsPerDay ?? ""));
              setError("");
            }}
          >
            Reset
          </Button>
          <Button
            variant="prominent"
            disabled={!writable || !dirty}
            loading={busy}
            onClick={() => void save()}
          >
            Save admission checks
          </Button>
        </div>
        {error && <p role="alert">{error}</p>}
      </SettingsGroup>
    </section>
  );
}
