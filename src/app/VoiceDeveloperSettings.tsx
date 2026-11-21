import { isTauri } from "@tauri-apps/api/core";
import { useEffect, useState, useSyncExternalStore } from "react";
import { InlineHeader } from "../shared/design-system/ui/Header";
import { PreferenceRow } from "../shared/design-system/ui/PreferenceRow";
import { Select } from "../shared/design-system/ui/Select";
import { SettingsGroup } from "../shared/design-system/ui/SettingsGroup";
import { Button } from "../shared/design-system/ui/Button";
import {
  clearVoiceTimings,
  KEY_ROUTE_MODEL,
  loadVoicePaths,
  OFFER_MODELS,
  selectVoicePath,
  subscribeVoicePaths,
  subscribeVoiceTimings,
  VOICE_PATH_LABELS,
  voicePaths,
  voiceTimings,
  type VoicePath,
} from "../features/search/voice-paths";

const ms = (value: number | null) =>
  value === null ? "–" : `${Math.round(value).toLocaleString()} ms`;

/** Switches voice jump between recognizers and shows each listen's timings,
 * so the paths can be compared. Development builds only. */
export function VoiceDeveloperSettings() {
  const paths = useSyncExternalStore(subscribeVoicePaths, voicePaths);
  const timings = useSyncExternalStore(subscribeVoiceTimings, voiceTimings);
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (isTauri()) void loadVoicePaths();
  }, []);
  if (!paths || paths.available.length === 0) return null;

  async function select(path: VoicePath, model?: string | null) {
    setError(undefined);
    try {
      await selectVoicePath(
        path,
        path === "offer" ? (model ?? paths?.model ?? KEY_ROUTE_MODEL) : null,
      );
    } catch (reason) {
      setError(
        typeof reason === "string" ? reason : "The path wasn’t switched.",
      );
    }
  }

  return (
    <div className="space-y-2">
      <InlineHeader
        title="Voice"
        subtitle="Which recognizer voice jump uses. Changes apply to the next listen."
      />
      <SettingsGroup layout="form">
        <PreferenceRow
          title="Speech path"
          subtitle="The key route fetches a key ahead of time, then answers with OpenAI directly. The kgoose offer route sends each offer to kgoose first, which costs a round trip when listening starts."
          trailing={
            <Select
              label="Speech path"
              variant="compact"
              value={paths.selected}
              onValueChange={(value) => void select(value as VoicePath)}
              groups={[
                {
                  label: "",
                  options: paths.available.map((path) => ({
                    value: path,
                    label: VOICE_PATH_LABELS[path],
                  })),
                },
              ]}
            />
          }
        />
        {paths.selected === "offer" && (
          <PreferenceRow
            title="Offer route model"
            subtitle={`The key route always uses ${KEY_ROUTE_MODEL}.`}
            trailing={
              <Select
                label="Offer route model"
                variant="compact"
                value={paths.model ?? KEY_ROUTE_MODEL}
                onValueChange={(value) => void select("offer", value)}
                groups={[
                  {
                    label: "",
                    options: OFFER_MODELS.map((model) => ({
                      value: model,
                      label: model,
                    })),
                  },
                ]}
              />
            }
          />
        )}
        {error && (
          <p role="alert" className="m-0 text-body-sm text-muted">
            {error}
          </p>
        )}
        {timings.length === 0 ? (
          <p className="m-0 text-body-sm text-subtle">
            Listen with voice jump to see timings here.
          </p>
        ) : (
          <>
            <table className="w-full text-body-sm tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th className="text-left font-normal">Path</th>
                  <th className="text-right font-normal">Press → listening</th>
                  <th className="text-right font-normal">→ first text</th>
                  <th className="text-right font-normal">→ final transcript</th>
                </tr>
              </thead>
              <tbody>
                {timings.map((timing) => (
                  <tr key={timing.at}>
                    <td title={timing.model}>
                      {timing.path === "unknown"
                        ? "Unknown"
                        : VOICE_PATH_LABELS[timing.path]}
                      <span className="text-subtle"> · {timing.model}</span>
                    </td>
                    <td className="text-right">{ms(timing.connectMs)}</td>
                    <td className="text-right">{ms(timing.firstTextMs)}</td>
                    <td className="text-right">{ms(timing.finalTextMs)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="m-0 text-body-sm text-subtle">
              Text times count from when listening started. The final transcript
              is the last time the words changed; the pause is reported 800 ms
              after it.
            </p>
            <div>
              <Button type="button" onClick={clearVoiceTimings}>
                Clear timings
              </Button>
            </div>
          </>
        )}
      </SettingsGroup>
    </div>
  );
}
