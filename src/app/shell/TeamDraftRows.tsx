import type { ChannelSummary } from "../../features/relay/contracts";
import type { ReactNode } from "react";
import type { RelaySession } from "../../features/relay/session";
import type { NavigationScope } from "../../features/navigation/targets";
import { useDrafts } from "../../features/drafts-sent/drafts";
import { useSent } from "../../features/drafts-sent/views";
import { sentEntries, preview } from "../../features/drafts-sent/model";
import { listed } from "../../features/drafts-sent/scope";
import { NavigationItem } from "../../shared/design-system/ui/NavigationItem";
import type { RailEntry } from "./rail-pins";

/** Keep the card mounted while subscribing only to its visible Drafts & sent view. */
export function TeamDraftRows({
  session,
  active,
  scope,
  byId,
  channelsById,
  artwork,
  open,
  render,
}: {
  session: RelaySession;
  active: boolean;
  scope: NavigationScope;
  byId: ReadonlyMap<string, RailEntry>;
  channelsById: ReadonlyMap<string, ChannelSummary>;
  artwork(entry: RailEntry): ReactNode;
  open(entry: RailEntry): void;
  render(
    rows: { entry: RailEntry; content: ReactNode }[],
    notice?: string,
  ): ReactNode;
}) {
  const drafts = useDrafts(active ? session : undefined);
  const { sent } = useSent(session, scope.viewer, active);
  const items = (
    active
      ? [
          ...drafts.entries.map((entry) => ({ entry, draft: true })),
          ...sentEntries(sent.events, scope.viewer).map((entry) => ({
            entry,
            draft: false,
          })),
        ]
      : []
  ).sort((a, b) => (b.entry.createdAt ?? 0) - (a.entry.createdAt ?? 0));
  const rows = items.flatMap(({ entry: item, draft }) => {
    const channel = channelsById.get(item.channelId);
    const base = byId.get(`channel:${item.channelId}`);
    if (!base || !channel || channel.channelType === "solo" || !listed(channel))
      return [];
    const entry: RailEntry = {
      ...base,
      id: `${draft ? "draft" : "sent"}:${item.id}`,
      target: {
        version: 1,
        kind: "conversation",
        scope,
        channelId: item.channelId,
        ...(item.threadRootId ? { threadRootId: item.threadRootId } : {}),
        ...(!draft
          ? { messageId: item.id }
          : item.threadRootId
            ? { messageId: item.threadRootId }
            : {}),
      },
    };
    return [
      {
        entry,
        content: (
          <NavigationItem
            icon={artwork(base)}
            label={preview(item.text, draft ? "Draft" : "Message")}
            trailing={
              draft ? <span className="text-caption">Draft</span> : undefined
            }
            aria-label={`${base.label}: ${preview(item.text, draft ? "Draft" : "Message")}`}
            aria-description={preview(item.text, draft ? "Draft" : "Message")}
            title={preview(item.text, draft ? "Draft" : "Message")}
            onClick={() => open(entry)}
          />
        ),
      },
    ];
  });
  const notice =
    sent.status === "error" || drafts.unavailable
      ? "Some drafts or sent messages couldn’t load."
      : !rows.length
        ? sent.status === "loading"
          ? "Loading sent messages…"
          : "No drafts or sent messages"
        : undefined;
  return render(rows, notice);
}
