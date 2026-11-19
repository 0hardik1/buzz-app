import { useState, useSyncExternalStore } from "react";
import { Button } from "../../shared/design-system/ui/Button";
import {
  PopoverRoot,
  PopoverTrigger,
  PopoverPopup,
} from "../../shared/design-system/ui/Popover";
import {
  reactionNames,
  type PrReactions,
  type ReactionContent,
} from "./pr-reactions";
import type { Comment, Snapshot } from "./pr-comments";
import styles from "./InlineComments.module.css";

export function GitHubReactions({
  api,
  snapshot,
  comment,
}: {
  api: PrReactions;
  snapshot: Snapshot;
  comment: Comment;
}) {
  const [open, setOpen] = useState(false);
  const state = useSyncExternalStore(api.subscribe, () => api.get(comment.id));
  const current = state?.viewer === snapshot.viewer ? state : undefined;
  const groups = current?.groups ?? comment.reactions ?? [];
  const blocked = state?.phase === "pending" || state?.phase === "unknown";
  const update = (content: ReactionContent) =>
    void api.update(snapshot, comment, {
      content,
      reacted: !(
        groups.find((group) => group.content === content)?.viewerHasReacted ??
        false
      ),
    });
  return (
    <div>
      <div className={styles.actions}>
        {groups
          .filter((group) => group.users.totalCount > 0)
          .map((group) => (
            <Button
              key={group.content}
              size="sm"
              variant="outline"
              disabled={blocked}
              aria-label={`${reactionNames[group.content]?.[1] ?? group.content}, ${group.users.totalCount}`}
              aria-pressed={group.viewerHasReacted}
              onClick={() => update(group.content)}
            >
              {reactionNames[group.content]?.[0]} {group.users.totalCount}
            </Button>
          ))}
        <PopoverRoot open={open} onOpenChange={setOpen}>
          <PopoverTrigger
            render={
              <Button size="sm" variant="ghost" disabled={blocked}>
                Add reaction
              </Button>
            }
          >
            Add reaction
          </PopoverTrigger>
          <PopoverPopup size="compact" aria-label="Choose reaction">
            <div className={styles.reactionPicker}>
              {(Object.keys(reactionNames) as ReactionContent[]).map(
                (content) => (
                  <Button
                    shape="icon"
                    size="sm"
                    variant="ghost"
                    aria-label={reactionNames[content][1]}
                    title={reactionNames[content][1]}
                    aria-pressed={
                      groups.find((group) => group.content === content)
                        ?.viewerHasReacted ?? false
                    }
                    key={content}
                    disabled={blocked}
                    onClick={() => {
                      setOpen(false);
                      update(content);
                    }}
                  >
                    {reactionNames[content][0]}
                  </Button>
                ),
              )}
            </div>
          </PopoverPopup>
        </PopoverRoot>
        {state?.phase === "pending" && (
          <span role="status">Updating reactions…</span>
        )}
        {state?.phase === "unknown" && (
          <Button size="sm" onClick={() => void api.update(snapshot, comment)}>
            Check reactions
          </Button>
        )}
      </div>
      {state?.error && (
        <p role="status" className="text-body-sm">
          {state.phase === "unknown"
            ? "Reaction delivery is unknown. Check reactions before trying again. "
            : ""}
          {state.error}
        </p>
      )}
    </div>
  );
}
