import type { Agents } from "../agents/service";
import { relayOrigin } from "../communities/destination";
import { huddleAudio } from "./diagnostics";
import type { Huddles } from "./service";

export const huddlePlayoutToolName = "huddles_playout_events";

export function registerHuddlePlayoutTool(
  agents: Pick<Agents, "addTool" | "snapshot">,
  huddles: Pick<Huddles, "snapshot" | "recentPlayout">,
) {
  if (!huddleAudio.enabled) return;
  agents.addTool({
    name: huddlePlayoutToolName,
    description:
      "Read recent relay playback discards and underruns for your own voice on your owner's device in this active Huddle. Times are Unix milliseconds. An underrun estimates a gap in scheduled playback. A queue-limit event marks when audio was discarded. Events have no word alignment or audio.",
    inputSchema: {
      type: "object",
      properties: {},
      additionalProperties: false,
    },
    async call(client, context, args) {
      if (Object.keys(args).length)
        throw new Error("This tool takes no arguments.");
      const { destination, room } = huddles.snapshot();
      const agentsHere = agents.snapshot();
      const agent =
        agentsHere.status === "ready" &&
        agentsHere.running.find(
          (candidate) =>
            candidate.key === client.key && candidate.pubkey === client.pubkey,
        );
      if (
        !destination ||
        !room ||
        context.channel !== room ||
        !agent ||
        agent.place !== "here" ||
        agent.owner !== destination.viewer ||
        relayOrigin(agent.relay) !== relayOrigin(destination.relayUrl)
      )
        throw new Error(
          "Playback events are only available in your owner's active Huddle.",
        );
      const report = huddles.recentPlayout(room, client.pubkey);
      if (!report)
        throw new Error(
          "Playback events are unavailable for your seat in this Huddle.",
        );
      return JSON.stringify(report);
    },
  });
}
