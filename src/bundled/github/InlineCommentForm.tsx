import { useEffect, useRef } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import styles from "./InlineComments.module.css";

export function InlineCommentForm({
  body,
  busy,
  blocked,
  error,
  notice,
  onChange,
  onSubmit,
  onCancel,
}: {
  body: string;
  busy: boolean;
  blocked: boolean;
  error?: string | undefined;
  notice?: string | undefined;
  onChange(body: string): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    input.current?.focus();
  }, []);
  return (
    <form
      className={styles.comment}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !blocked && body.trim()) onSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && !busy) {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <Field label="GitHub comment">
        <Textarea
          ref={input}
          rows={3}
          value={body}
          disabled={busy}
          readOnly={blocked}
          onChange={(event) => onChange(event.target.value)}
        />
      </Field>
      {notice && <p role="status">{notice}</p>}
      {error && <p role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button size="sm" disabled={busy} onClick={onCancel}>
          Close draft
        </Button>
        <Button
          size="sm"
          variant="prominent"
          type="submit"
          loading={busy}
          disabled={blocked || !body.trim()}
        >
          Post to GitHub
        </Button>
      </div>
    </form>
  );
}
