import { useState } from "react";
import {
  CheckIcon,
  PencilSimpleIcon,
} from "../../../shared/design-system/icons";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import { Textarea } from "../../../shared/design-system/ui/Textarea";
import type { CardDefinition, CardProps } from "../card-types";
import "./sticky-note.css";

function StickyNoteCard({ variant }: CardProps) {
  const [note, setNote] = useState("Make one useful thing.\nThen take a walk.");
  const [editing, setEditing] = useState(false);
  return (
    <div
      className="sticky-note-widget"
      data-treatment={variant}
      data-editing={editing || undefined}
    >
      {editing ? (
        <Textarea
          rows={2}
          autoFocus
          aria-label="Edit note"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          placeholder="A thought for later…"
        />
      ) : (
        <p className="sticky-note-copy text-body">
          {note.trim() ? note : "A thought for later…"}
        </p>
      )}
      <span className="sticky-note-fold" aria-hidden="true" />
      <span
        data-widget-secondary=""
        data-secondary-pinned={editing || undefined}
      >
        <IconButton
          variant="inverted"
          aria-label={editing ? "Finish editing note" : "Edit note"}
          icon={editing ? <CheckIcon /> : <PencilSimpleIcon />}
          onClick={() => setEditing((current) => !current)}
        />
      </span>
    </div>
  );
}

export const stickyNote: CardDefinition = {
  id: "sticky-note",
  title: "Sticky note",
  subtitle: "",
  category: "Your ideas",
  purpose: "One thought on a small piece of yellow paper.",
  how: "Choose Edit note, write, then finish with the checkmark. The warm paper material is a local faux-paper experiment. Changes reset on refresh; this prototype has no persistence.",
  source:
    "Your idea · Faux yellow-paper experiment · Local note without persistence",
  component: StickyNoteCard,
};
