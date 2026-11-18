import { useEffect, useSyncExternalStore } from "react";
import type { RelaySession } from "../../features/relay/session";
import { useAgentChoices } from "../../features/agents/use-choices";
import { canMessageAgent } from "../../features/agents/choices";
import { archiveHides } from "../../features/relay/identity-archives";
import { useMentionArchives } from "../../features/messages/use-mention-archives";
import { useIdentityNames } from "../../features/identity-names/react";
import { useVerifiedNames } from "../../features/profiles/useVerifiedNames";
import { verifiedLabel } from "../../features/profiles/name-preference";
import { rankPeople } from "../../features/search/people-rank";
import { noSearchUsage } from "../../features/search/usage";
import { usePersonDirectory } from "./usePersonDirectory";
import {
  useChannelList,
  useProfileGeneration,
} from "../../features/relay/react";

/** Section creation uses Command-K's directory, verified names, eligibility,
 * and ranking. The directory's page stays local to this chooser. */
export function useSectionPeople(
  session: RelaySession,
  terms: readonly string[],
  enabled: boolean,
) {
  const profiles = useSyncExternalStore(
    session.profiles.subscribe,
    session.profiles.snapshot,
  );
  const agents = useAgentChoices(session, enabled, enabled);
  useMentionArchives(session, enabled);
  const resolve = useIdentityNames(session.names);
  const directory = usePersonDirectory(session, terms, enabled);
  const channels = useChannelList(session.channels);
  const generation = useProfileGeneration(session.profiles);
  const profileKeys = [
    ...new Set([
      ...channels.channels.flatMap((channel) =>
        channel.channelType === "dm" ? (channel.participants ?? []) : [],
      ),
      ...directory.people.map((person) => person.pubkey),
    ]),
  ]
    .sort()
    .slice(0, 1024)
    .join(":");
  useEffect(() => {
    void generation;
    if (enabled && profileKeys)
      void session.profiles
        .ensure(profileKeys.split(":"), "background")
        .catch(() => {});
  }, [session, enabled, profileKeys, generation]);
  const verified = useVerifiedNames(session, directory.people, {
    key: terms.join("\n"),
    settled: !directory.loading && enabled,
  });
  const selectable = new Map(
    agents.selectable
      .filter(canMessageAgent)
      .map((agent) => [agent.pubkey, agent]),
  );
  const agentKeys = new Set(agents.identities.map((agent) => agent.pubkey));
  const foundPeople = new Map(
    directory.people.map((person) => [person.pubkey, person]),
  );
  const sources = new Map(foundPeople);
  for (const [pubkey, profile] of profiles) {
    if (!profile.nameIsFallback || profile.username || profile.verified)
      sources.set(pubkey, { ...profile, pubkey });
  }
  for (const agent of selectable.values())
    if (!sources.has(agent.pubkey))
      sources.set(agent.pubkey, {
        pubkey: agent.pubkey,
        name: agent.managedName ?? agent.name,
        isAgent: true,
      });
  const people = [...sources.values()].flatMap((source) => {
    const { pubkey } = source;
    const agent = selectable.get(pubkey);
    if (
      pubkey === session.viewer ||
      archiveHides(session.archives, pubkey, session.viewer) ||
      ((source.isAgent || agentKeys.has(pubkey)) && !agent)
    )
      return [];
    const cached = profiles.get(pubkey);
    const checked = cached?.verified ?? verified.get(pubkey);
    const found = foundPeople.get(pubkey);
    const name =
      cached && !cached.nameIsFallback
        ? resolve(pubkey, source.name)
        : checked
          ? verifiedLabel(checked)
          : source.name;
    const aliases = [
      ...new Set(
        [
          source.name,
          source.username,
          cached?.name,
          cached?.username,
          checked?.fullName,
          checked?.username,
          checked?.displayName,
          found?.name,
          found?.username,
          agent?.name,
          agent?.managedName,
        ].filter((value): value is string => !!value),
      ),
    ];
    return [
      {
        pubkey,
        name,
        aliases,
        label: name,
        username: checked?.username ?? source.username,
        fullName: checked?.fullName,
        profileNames: aliases,
        agentName: agent?.name,
        agent: !!agent,
        relationship: 0,
        usageKeys: [],
      },
    ];
  });
  return {
    ...directory,
    people,
    rank: (query: string) =>
      rankPeople(
        people,
        query.replace(/^@/u, ""),
        noSearchUsage,
        undefined,
      ).map(({ person }) => person),
  };
}
