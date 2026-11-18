import { useState } from "react";
import { ArrowUpIcon, BestieIcon } from "../../../shared/design-system/icons";
import { IconButton } from "../../../shared/design-system/ui/IconButton";
import { Input } from "../../../shared/design-system/ui/Input";
import { InputGroup } from "../../../shared/design-system/ui/InputGroup";
import type { CardDefinition, CardProps } from "../card-types";
import "./bestie.css";

function BestieCard({ variant }: CardProps) {
  const [draft, setDraft] = useState("");
  const [sent, setSent] = useState(0);
  return (
    <div className="bestie-widget" data-treatment={variant}>
      <BestieIcon className="bestie-art" size={112} aria-hidden="true" />
      <span className="sr-only" aria-live="polite">
        {sent > 0 ? `Simulated reply ${sent}: Start with one thing.` : ""}
      </span>
      <form
        className="bestie-composer"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.trim()) return;
          setSent((current) => current + 1);
          setDraft("");
        }}
      >
        <InputGroup
          surface="panel"
          trailing={
            <IconButton
              type="submit"
              variant="prominent"
              aria-label="Send to Bestie"
              disabled={!draft.trim()}
              icon={<ArrowUpIcon />}
            />
          }
        >
          <Input
            aria-label="Message Bestie"
            placeholder="Ask Bestie…"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
        </InputGroup>
      </form>
    </div>
  );
}

export const bestie: CardDefinition = {
  id: "bestie",
  title: "Bestie",
  subtitle: "",
  category: "Your ideas",
  purpose: "A tiny thought partner beside your conversations.",
  how: "Write in the foreground composer and send. The local simulation clears the draft and announces a short reply to assistive technology. No messages are sent or stored.",
  source: "Your idea · Local simulated response · Actual Buzz Bestie artwork",
  component: BestieCard,
};
