import { Button } from "../../shared/design-system/ui/Button";
import { useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import type { RelaySession } from "../relay/session";
import type { EventData } from "../relay/events";
import type { ComposerTool, ContributionReader } from "./contracts";
import type { Contribution } from "../../plugins/contributions";
import { ContributionBoundary, contributionKey } from "./ContributionBoundary";
import { messageViewKey } from "../messages/view-key";
import type { Outbox, OutgoingEvent } from "../relay/outbox";

const toolOrder = (tool: ComposerTool) =>
  Number.isFinite(tool.order) ? (tool.order ?? 0) : 0;
export function selectReactionTool(
  tools: readonly Contribution<ComposerTool>[],
) {
  return tools
    .filter((tool) => tool.reactionComponent)
    .sort(
      (a, b) =>
        toolOrder(a) - toolOrder(b) ||
        (a.key < b.key ? -1 : a.key > b.key ? 1 : 0),
    )[0];
}

export function ReactionTool({
  registry,
  ...props
}: {
  registry: ContributionReader<ComposerTool>;
  session: RelaySession;
  scope: string;
  messageId: string;
  disabled: boolean;
  select?: (emoji: string) => boolean;
  showDelivery?: boolean;
}) {
  const tools = useSyncExternalStore(
    registry.subscribe,
    registry.snapshot,
    registry.snapshot,
  );
  const tool = selectReactionTool(tools);
  // Host-owned marker: message shortcuts open the picker through its trigger.
  return tool ? (
    <span className="contents" data-reaction-tool="">
      <ContributionBoundary
        key={contributionKey(tool)}
        fallback={<span role="status">Reactions unavailable</span>}
      >
        <OwnedReactionTool
          key={messageViewKey(props.session, props.scope, props.messageId)}
          registry={registry}
          tool={tool}
          {...props}
        />
      </ContributionBoundary>
    </span>
  ) : null;
}

function OwnedReactionTool({
  registry,
  tool,
  session,
  scope,
  messageId,
  disabled,
  select,
  showDelivery = true,
}: {
  registry: ContributionReader<ComposerTool>;
  tool: Contribution<ComposerTool>;
  session: RelaySession;
  scope: string;
  messageId: string;
  disabled: boolean;
  select?: (emoji: string) => boolean;
  showDelivery?: boolean;
}) {
  const [error, setError] = useState<string>();
  const alive = useRef(false);
  const unavailable = useRef(disabled);
  useLayoutEffect(() => {
    unavailable.current = disabled;
  });
  useLayoutEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const Picker = tool.reactionComponent;
  return Picker ? (
    <>
      <Picker
        session={session}
        scope={scope}
        disabled={disabled}
        select={(emoji) => {
          if (
            !alive.current ||
            unavailable.current ||
            !registry.snapshot().includes(tool)
          )
            return false;
          try {
            if (select) return select(emoji);
            session.messages.react(messageId, emoji);
            setError(undefined);
            return true;
          } catch (reason) {
            setError(
              reason instanceof Error
                ? reason.message
                : "Could not add reaction. Try again.",
            );
            return false;
          }
        }}
      />
      {error && <span role="alert">{error}</span>}
      {showDelivery && session.outbox && (
        <ReactionDelivery session={session} messageId={messageId} />
      )}
    </>
  ) : null;
}

export function reactionTarget(event: Pick<EventData, "kind" | "tags">) {
  return event.kind === 7
    ? event.tags.find((tag) => tag[0] === "e")?.[1]
    : undefined;
}

/** The relay takes a signed event for 15 minutes. After that the same
 * reaction, or removal of one, can never be sent again. */
const expired = (item: OutgoingEvent) =>
  Date.now() / 1000 - item.event.created_at >= 15 * 60;

/** Gives up a reaction, or the removal of one, that can no longer be
 * delivered, so the person can react to the message again. One known not to
 * have been sent is dropped as it is. An unconfirmed one may have reached the
 * relay, so it is given up only past the intake window, and only when a strong
 * read by ID finds nothing. One the relay has is kept, and reading it settles
 * it as delivered. Resolves true when the relay had it. */
export async function discardReaction(
  session: Pick<RelaySession, "outbox" | "readRemote">,
  id: string,
) {
  const outbox = session.outbox;
  const saved = () => outbox?.snapshot().find((item) => item.event.id === id);
  const item = saved();
  if (!outbox || !item) return false;
  if (item.delivery === "unknown") {
    if (!expired(item))
      throw new Error(
        "This reaction update may still be delivered. Retry it, or discard it once it is 15 minutes old.",
      );
    const found = await session
      .readRemote(
        [
          {
            kinds: [item.event.kind],
            ids: [id],
            authors: [item.event.pubkey],
            limit: 1,
            consistency: "strong",
          },
        ],
        { priority: "foreground" },
      )
      .catch((cause: unknown) => {
        throw new Error(
          "Couldn’t check whether this reaction update was delivered, so it was kept. Try Discard again.",
          { cause },
        );
      });
    if (found.some((event) => event.id === id)) return true;
    // A retry that began during the read keeps it.
    if (saved()?.delivery !== "unknown") return false;
  } else if (item.delivery !== "failed") return false;
  await outbox.dismiss(id);
  return false;
}

export function ReactionDelivery({
  session,
  messageId,
}: {
  session: RelaySession;
  messageId: string;
}) {
  const outbox = session.outbox;
  const operations = useSyncExternalStore(
    outbox?.subscribe ?? noSubscribe,
    outbox?.snapshot ?? emptyOperations,
    outbox?.snapshot ?? emptyOperations,
  );
  // What the last Discard found, for the update it was asked about.
  const [outcome, setOutcome] = useState<{
    id: string;
    kept?: string;
    error?: string;
  }>();
  const [discarding, setDiscarding] = useState(false);
  const operation = operations.find(
    (item) =>
      ["failed", "unknown"].includes(item.delivery) &&
      session.messages.reactionTarget(item.event) === messageId,
  );
  if (!operation)
    return outcome?.kept ? <span role="status">{outcome.kept}</span> : null;
  const { id } = operation.event;
  const failed = operation.delivery === "failed";
  // Past the window Retry can only be refused again, so Discard stands alone.
  // Inside it an unconfirmed update may still arrive, so only Retry is offered.
  const old = expired(operation);
  return (
    <>
      <span role="status">
        {failed
          ? "Couldn’t update reaction"
          : "Reaction delivery not confirmed"}
        {old
          ? ", and it is too old to retry."
          : failed
            ? "."
            : ". Retry it, or discard it once it is 15 minutes old."}{" "}
        {!old && (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={discarding}
            onClick={() => {
              setOutcome(undefined);
              outbox?.retry(id);
            }}
          >
            Retry reaction
          </Button>
        )}
        {(failed || old) && (
          <Button
            size="sm"
            variant="ghost"
            type="button"
            disabled={discarding}
            onClick={async () => {
              setDiscarding(true);
              setOutcome(undefined);
              try {
                if (await discardReaction(session, id))
                  setOutcome({
                    id,
                    kept: "This reaction update had already been delivered, so it was kept.",
                  });
              } catch (cause) {
                setOutcome({
                  id,
                  error:
                    cause instanceof Error
                      ? cause.message
                      : "Could not discard the reaction update.",
                });
              } finally {
                setDiscarding(false);
              }
            }}
          >
            Discard reaction update
          </Button>
        )}
      </span>
      {outcome?.id === id && outcome.error && (
        <span role="alert">{outcome.error}</span>
      )}
    </>
  );
}

const noSubscribe = () => () => {};
const empty: ReturnType<Outbox["snapshot"]> = Object.freeze([]);
const emptyOperations = () => empty;
