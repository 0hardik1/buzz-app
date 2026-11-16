import { createAgentChoices } from "../../../features/agents/choices";
import { createAgentLibrary } from "../../../features/agents/library";
import { createIdentityArchives } from "../../../features/relay/identity-archives";
import { detailsSettings } from "../../../features/relay/channel-details-protocol";
import { DiscoveryState } from "../../../features/relay/discovery";
import { createOutbox } from "../../../features/relay/outbox";
import type { ChannelSummary } from "../../../features/relay/contracts";
import { relayPartition } from "../../../features/relay/partition";
import { confirmReviewAgents } from "../access";
import type { ReviewSession } from "../session";
import type { reviewTransport } from "./transport";
import type { reviewStorage } from "./storage";

export async function serverReviewSession(
  transport: ReturnType<typeof reviewTransport>,
  storage: ReturnType<typeof reviewStorage>,
  allowed: readonly string[],
  signal: AbortSignal,
) {
  const authority = await transport.authority();
  const scope = relayPartition(transport.base, transport.viewer);
  const channels = new Map<string, ChannelSummary>();
  const refreshing = new Map<string, Promise<unknown>>();
  function refresh(id: string, caller = signal) {
    const work = (refreshing.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(() => load(id, caller));
    refreshing.set(id, work);
    return work;
  }
  async function load(id: string, caller: AbortSignal) {
    if (!allowed.includes(id))
      throw new Error("Channel is outside the worker's configured scope.");
    try {
      caller.throwIfAborted();
      const events = await transport.reader.read(
        [39000, 39001, 39002].map((kind) => ({
          kinds: [kind],
          authors: [authority],
          "#d": [id],
          limit: 1,
          consistency: "strong" as const,
        })),
        { signal: caller },
      );
      const { details } = detailsSettings(
        events,
        id,
        transport.viewer,
        authority,
      );
      const discovery = new DiscoveryState(transport.viewer, authority);
      for (const event of events) discovery.accept(event);
      const summary = discovery.get(id);
      if (!summary) throw new Error("Channel membership is unavailable.");
      channels.set(id, summary);
      caller.throwIfAborted();
      return details;
    } catch (error) {
      channels.delete(id);
      throw error;
    }
  }
  // Headless workers have no local inventory. Verified configured identities and
  // channel membership are checked by the shared review access owner on each send.
  const library = createAgentLibrary(undefined);
  const archives = createIdentityArchives(transport.reader, authority);
  await archives.queries.refresh();
  const agentChoices = createAgentChoices({
    scope,
    library: library.queries,
    archives: archives.queries,
    signal,
  });
  const delivery = createOutbox(
    transport.viewer,
    transport.writer,
    storage.outbox,
    {
      async preparePublish(event, attemptSignal) {
        if (event.kind !== 9)
          throw new Error("The review outbox only publishes messages.");
        const destinations = event.tags.filter(([name]) => name === "h");
        if (destinations.length !== 1 || !destinations[0]?.[1])
          throw new Error("Review message channel is invalid.");
        const id = destinations[0][1];
        // Refresh at actual dispatch, after signing/journaling and for every retry.
        await refresh(id, attemptSignal);
        await archives.queries.refresh();
        const snapshot = archives.queries.snapshot();
        const recipients = event.tags
          .filter(([name]) => name === "p")
          .map((tag) => {
            if (!tag[1] || tag.length !== 2)
              throw new Error("Invalid reviewer recipient.");
            return tag[1];
          });
        if (
          snapshot.status !== "ready" ||
          snapshot.error ||
          recipients.some((key) => snapshot.archived.includes(key))
        )
          throw new Error(
            "Reviewer archive access is unavailable or a reviewer is archived.",
          );
        return confirmReviewAgents(
          session,
          id,
          recipients,
          attemptSignal,
          true,
        );
      },
    },
  );
  const session: ReviewSession = {
    viewer: transport.viewer,
    scope,
    snapshotRead: async (filters, options) => {
      const events = await transport.reader.read(
        filters,
        options?.signal ? { signal: options.signal } : {},
      );
      delivery.observe(events);
      return events;
    },
    configArtifactWriter: transport.writer,
    outbox: delivery.outbox,
    channels: {
      list: () => ({ status: "ready", channels: [...channels.values()] }),
      refreshRoster: async (id, options) => {
        await refresh(id, options?.signal);
        return true;
      },
    },
    channelDetails: { load: refresh },
    agentChoices,
    reviewRuntime: storage,
  };
  return {
    session,
    refresh,
    close() {
      delivery.dispose();
      archives.dispose();
      library.dispose();
    },
  };
}
