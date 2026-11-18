import { type ComponentProps, useRef, useState } from "react";
import { AlertDialog } from "../../shared/design-system/ui/AlertDialog";
import { Button } from "../../shared/design-system/ui/Button";
import type { Outbox, OutboxRecovery } from "../relay/outbox";

/** Ends a Solo chat's opening-admin setup by dismissing its receipt under the
 * receipt's ownership lock. A grant being published finishes first; nothing is
 * granted, so the chat keeps the roles the relay has. */
export function AbandonAdminSetup({
  outbox,
  id,
  recovery,
  finalFocus,
  onClose,
}: {
  outbox: Pick<Outbox, "dismiss">;
  /** The create and the setup it carries; see `abandonableSetup`. */
  id: string;
  recovery: OutboxRecovery;
  finalFocus: ComponentProps<typeof AlertDialog>["finalFocus"];
  onClose(): void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const cancel = useRef<HTMLButtonElement>(null);
  return (
    <AlertDialog
      title="Abandon admin setup?"
      description="The chat keeps its current roles. Retry your opening message to continue, or send a new message if it expired."
      initialFocus={cancel}
      finalFocus={finalFocus}
      pending={pending}
      onClose={onClose}
      actions={
        <>
          <Button ref={cancel} disabled={pending} onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="prominent"
            disabled={pending}
            onClick={async () => {
              setPending(true);
              setError(undefined);
              try {
                await outbox.dismiss(id, recovery);
                onClose();
              } catch (reason) {
                setError(String(reason));
              } finally {
                setPending(false);
              }
            }}
          >
            Abandon admin setup
          </Button>
        </>
      }
    >
      {error && <p role="alert">{error}</p>}
    </AlertDialog>
  );
}
