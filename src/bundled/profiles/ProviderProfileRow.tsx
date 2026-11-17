import { useEffect, useRef, useState } from "react";
import type { RelaySession } from "../../features/relay/session";
import { searchedProfiles } from "../../features/relay/profile-search";
import { profileTarget } from "../../features/profiles/target";
import { PreferenceRow } from "../../shared/design-system/ui/PreferenceRow";
import styles from "./ProviderProfileRow.module.css";
import { CaretRightIcon } from "../../shared/design-system/icons";

/** Resolve provider identities against this community, never display-name guesses. */
export function ProviderProfileRow({
  title,
  value,
  username,
  session,
  open,
}: {
  title: string;
  value: string;
  username: string;
  session: RelaySession;
  open: (target: string) => unknown;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const active = useRef<AbortController | undefined>(undefined);
  useEffect(() => () => active.current?.abort(), []);
  const visit = async () => {
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    setPending(true);
    setError(undefined);
    try {
      const events = await session.searchProfiles(username, {
        limit: 100,
        signal: controller.signal,
      });
      controller.signal.throwIfAborted();
      const candidates = searchedProfiles(
        events,
        session.profiles.verifiedAuthority?.(),
      );
      const verified = await session.directMessages.verified(
        [...candidates.keys()],
        controller.signal,
      );
      controller.signal.throwIfAborted();
      const matches = [...(verified?.profiles ?? [])].filter(
        ([, profile]) =>
          profile.status === "checked" && profile.username === username,
      );
      const target =
        matches.length === 1 ? profileTarget(matches[0]![0]) : undefined;
      if (!target) throw new Error("No profile in this community");
      open(target);
    } catch {
      if (!controller.signal.aborted)
        setError("Profile unavailable in this community");
    } finally {
      if (!controller.signal.aborted) setPending(false);
    }
  };
  return (
    <div>
      <div className={styles.row}>
        <PreferenceRow
          title={title}
          subtitle={
            <span className="text-body-sm text-secondary">{value}</span>
          }
          trailing={<CaretRightIcon size={16} />}
        />
        <button
          type="button"
          className={styles.open}
          disabled={pending}
          onClick={() => void visit()}
          aria-label={`Open ${value}’s profile`}
        />
      </div>
      {error && (
        <p role="status" className="text-body-sm text-secondary">
          {error}
        </p>
      )}
    </div>
  );
}
