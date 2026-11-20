import { useState } from "react";
import { InlineHeader } from "../../shared/design-system/ui/Header";
import { SettingsGroup } from "../../shared/design-system/ui/SettingsGroup";
import { SwitchPreferenceRow } from "../../shared/design-system/ui/SwitchPreferenceRow";
import {
  ALERT_KINDS,
  setAlertChoice,
  useAlertChoices,
} from "./alert-preferences";

export function AlertSettings({ active }: { active(): boolean }) {
  const choices = useAlertChoices();
  const [error, setError] = useState(false);
  return (
    <section aria-label="GitHub alert settings">
      <InlineHeader
        title="Alerts"
        subtitle="Desktop alerts for pull requests you're involved in, while Buzz is open. Turn them all off under GitHub in Settings → Notifications."
      />
      <SettingsGroup>
        {ALERT_KINDS.map((kind) => (
          <SwitchPreferenceRow
            key={kind.key}
            label={kind.label}
            checked={choices[kind.key]}
            onCheckedChange={(next) => {
              if (!active()) return;
              try {
                setAlertChoice(kind.key, next);
                setError(false);
              } catch {
                setError(true);
              }
            }}
          />
        ))}
      </SettingsGroup>
      {error && (
        <p role="alert" className="text-body-sm text-danger">
          Your choice could not be saved. Try changing it again.
        </p>
      )}
    </section>
  );
}
