import { readView, writeView } from "../../shared/view-state";
import { mentionDraft } from "../../features/messages/mention-draft";
import {
  readComposerDocument,
  projectComposerDocument,
  composerSchema,
} from "../../features/messages/composer-document";

/** Stage a source in the canonical DM draft; preserve rich text and explicit recipients. */
export function stageBestieRequest(
  scope: string,
  bestieChannel: string,
  sourceChannel: string,
  messageId: string,
) {
  const key = `draft:${bestieChannel}`;
  const draft = mentionDraft(readView(scope, key, ""));
  const link = `buzz://message?${new URLSearchParams({ channel: sourceChannel, id: messageId })}`;
  if (draft.text.includes(link)) return;
  const doc = readComposerDocument(draft, draft.recipients);
  const source = composerSchema.nodes.paragraph.create(
    null,
    composerSchema.text(`Help me with this message: ${link}`),
  );
  const next = doc.copy(
    doc.content.append(composerSchema.nodes.doc.create(null, source).content),
  );
  if (
    !writeView(scope, key, { ...draft, ...projectComposerDocument(next).draft })
  )
    throw new Error("The request could not be saved. Try again.");
}
