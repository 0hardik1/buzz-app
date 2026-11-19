import { useEffect, useRef } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import { Field } from "../../shared/design-system/ui/Field";
import { Textarea } from "../../shared/design-system/ui/Textarea";
import styles from "./InlineComments.module.css";

export function InlineCommentForm({
  body,
  operation,
  focusRequest = 0,
  busy,
  blocked,
  notice,
  onChange,
  onSubmit,
  onCancel,
}: {
  body: string;
  operation?: string;
  focusRequest?: number;
  busy: boolean;
  blocked: boolean;
  notice?: string | undefined;
  onChange(body: string): void;
  onSubmit(): void;
  onCancel(): void;
}) {
  const input = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    void focusRequest;
    input.current?.focus();
  }, [focusRequest]);
  return (
    <form
      className={styles.comment}
      data-operation={operation}
      onSubmit={(event) => {
        event.preventDefault();
        if (!busy && !blocked && body.trim()) onSubmit();
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          onCancel();
        }
      }}
    >
      <Field label="Comment" labelVisibility="hidden">
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
      <div className={styles.actions}>
        <Button size="sm" onClick={onCancel}>
          Cancel
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
