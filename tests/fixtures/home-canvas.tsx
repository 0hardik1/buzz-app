import "../../src/shared/styles/globals.css";
import { NewMenu } from "../../src/app/shell/NewMenu";
import { AppShell } from "../../src/app/shell/AppShell";
import { createServices } from "../../src/app/services";
import { createAppearance } from "../../src/shared/theme/service";
import { useKeyboardFocusVisibility } from "../../src/shared/design-system/useKeyboardFocusVisibility";
import { getPublicKey } from "nostr-tools";
// Controlled signed transport; the shipping Home component and session own behavior.
import { StrictMode, useSyncExternalStore } from "react";
import { createRoot } from "react-dom/client";
import { HomeCanvas } from "../../src/bundled/home/HomeCanvas";
import { createRelaySession } from "../../src/features/relay/session";
import { agentAvatars } from "../../src/features/agents/avatar-packs";
import type { LocalAgentsSnapshot } from "../../src/features/agents/local";
import {
  message,
  metadata,
  roster,
  bounds,
  profile,
  signed,
} from "../../src/features/relay/testing";
import { threadBinding } from "../../src/features/relay/thread-window";
import { createNavigationController } from "../../src/features/navigation/controller";
import { createMemoryHistory } from "../../src/features/navigation/history";
import type { PageNavigation } from "../../src/features/navigation/service";
import type { RelayData } from "../../src/features/relay/service";
import { ToastProvider } from "../../src/shared/design-system/ui/Toast";
const params = new URLSearchParams(location.search);
document.documentElement.dataset.colorMode =
  params.get("theme") === "dark" ? "dark" : "light";
if (params.has("large")) document.documentElement.style.fontSize = "20px";
const viewer = {
    secret: new Uint8Array(32).fill(1),
    pubkey: getPublicKey(new Uint8Array(32).fill(1)),
  },
  person = {
    secret: new Uint8Array(32).fill(2),
    pubkey: getPublicKey(new Uint8Array(32).fill(2)),
  },
  agent = {
    secret: new Uint8Array(32).fill(3),
    pubkey: getPublicKey(new Uint8Array(32).fill(3)),
  },
  authority = {
    secret: new Uint8Array(32).fill(4),
    pubkey: getPublicKey(new Uint8Array(32).fill(4)),
  };
const id = "11111111-1111-4111-8111-111111111111";
const origin = "https://home-fixture.example";
const agentId = "22222222-2222-4222-8222-222222222222";
const groupId = "33333333-3333-4333-8333-333333333333";
const portrait = agentAvatars[0];
const nativeAgents: LocalAgentsSnapshot = {
  status: "ready",
  agents: [
    {
      pubkey: agent.pubkey,
      name: "Mango",
      owner: viewer.pubkey,
      relayUrl: origin,
      ...(portrait ? { picture: portrait.url } : {}),
    },
  ],
};
// Stable partition lets reload exercise canvas and blob durability with a fresh session.
const scope = `${origin}:${viewer.pubkey}`;
const root = message(
  person,
  id,
  "Can you take a look at the Home direction?",
  Math.floor(Date.now() / 1000) - 60,
  [["p", viewer.pubkey]],
);
const owner = createRelaySession(
  {
    viewer: viewer.pubkey,
    relayAuthor: authority.pubkey,
    scope: origin,
    media: () => undefined,
    openDirectMessage: async () => id,
    writer: {
      kinds: [9],
      sign: async (template) =>
        signed(viewer, {
          ...template,
          tags: template.tags.map((tag) => [...tag]),
        }),
      publish: async () => {},
    },
    query: async (filters) =>
      (
        await Promise.all(
          filters.map(async (filter) => {
            if (filter.thread_window)
              return [
                signed(authority, {
                  kind: 39007,
                  tags: [
                    ["d", await threadBinding(filter, origin, viewer.pubkey)],
                    ["h", id],
                    ["e", root.id],
                  ],
                  content: JSON.stringify({
                    version: 1,
                    direction: "older",
                    has_more: false,
                    next_cursor: null,
                  }),
                }),
              ];
            if (filter.kinds?.includes(39000))
              return [
                metadata(authority, id, "Avery", 1700000000, [
                  ["t", "dm"],
                  ["hidden"],
                ]),
                metadata(authority, groupId, "Group", 1700000000, [
                  ["t", "dm"],
                  ["hidden"],
                ]),
                metadata(authority, agentId, "Mango", 1700000000, [
                  ["t", "dm"],
                  ["hidden"],
                ]),
              ];
            if (filter.kinds?.includes(39002))
              return [
                roster(authority, id, [viewer.pubkey, person.pubkey]),
                roster(authority, groupId, [
                  viewer.pubkey,
                  person.pubkey,
                  agent.pubkey,
                ]),
                roster(authority, agentId, [viewer.pubkey, agent.pubkey]),
              ];
            if (filter.kinds?.includes(0))
              return [
                profile(viewer, { name: "You" }),
                profile(person, { name: "baxen", display_name: "Avery" }),
                signed(agent, {
                  kind: 0,
                  content: JSON.stringify({
                    name: "Mango",
                    bot: true,
                    ownerPubkey: viewer.pubkey,
                    picture: portrait?.url,
                  }),
                  tags: [],
                }),
              ];
            if (filter.top_level)
              return [
                root,
                bounds(authority, id, "head", {
                  has_more: false,
                  next_cursor: null,
                }),
              ];
            if (filter.kinds && !filter.kinds.includes(9)) return [];
            if (filter.until !== undefined || filter.before_id) return [];
            return [root];
          }),
        )
      ).flat(),
  },
  {
    outboxStorage: { load: () => [], save() {} },
    agentChoices: {
      snapshot: () => nativeAgents,
      subscribe: () => () => {},
      refresh: async () => {},
    },
  },
);
owner.session.channels.ensureList();
const controller = createNavigationController(
  createMemoryHistory({
    version: 1,
    kind: "page",
    pluginId: "buzz.home",
    pageId: "home",
    ...(params.has("bestie")
      ? {
          route: {
            version: 1,
            params: {
              channelId: agentId,
              source: { channelId: id, messageId: root.id },
            },
          },
        }
      : {}),
  }),
);
const navigation = controller.navigation;
const connection = {
  status: "ready",
  generation: 1,
  scope,
  viewer: viewer.pubkey,
  session: owner.session,
};
const relay = {
  snapshot: () => connection,
  subscribe: () => () => {},
} as unknown as RelayData;
const empty: readonly never[] = [];
const contributions = { snapshot: () => empty, subscribe: () => () => {} };
const panels = { ...contributions, resolve: () => undefined };
const shell = params.has("shell") ? createServices() : undefined;
const appearance = createAppearance(window);
const pages = [
  { id: "home", pluginId: "buzz.home", title: "Home" },
  { id: "channels", pluginId: "buzz.channels", title: "Team" },
  { id: "inbox", pluginId: "buzz.inbox", title: "Activity" },
  { id: "bestie", pluginId: "buzz.bestie", title: "Bestie" },
  { id: "reminders", pluginId: "buzz.reminders", title: "Reminders" },
  { id: "agents", pluginId: "buzz.agents", title: "Agents" },
  { id: "projects", pluginId: "buzz.projects", title: "Projects" },
].map((page) => ({
  ...page,
  key: `${page.pluginId}/${page.id}`,
  revision: "fixture",
  primary: true,
  component: () => null,
}));
const shellCommunities = shell && { ...shell.communities, relay };
const shellSearch = shell && { ...shell, relay, navigation };
document.documentElement.dataset.colorMode =
  params.get("theme") === "dark" ? "dark" : "light";
function Fixture() {
  useKeyboardFocusVisibility();
  const { entry, attempt } = useSyncExternalStore(
    navigation.subscribe,
    navigation.snapshot,
  );
  const visit: PageNavigation = {
    entryId: entry.id,
    target: entry.target,
    signal: attempt.signal,
    position: () => undefined,
    savePosition() {},
    forSession: () => visit,
    resolve: () => false,
    complete: () => true,
    passThrough: () => () => {},
  };
  const home = (
    <HomeCanvas
      relay={relay}
      host={{ relay, navigation, panels }}
      extensions={{ tools: contributions, inline: contributions }}
      navigation={visit}
    />
  );
  return (
    <ToastProvider>
      {shell && shellCommunities && shellSearch ? (
        <AppShell
          pages={pages}
          selected={
            entry.target.kind === "page"
              ? `${entry.target.pluginId}/${entry.target.pageId}`
              : "buzz.home/home"
          }
          navigationAttempt={attempt.id}
          onSelect={(key) => {
            const page = pages.find((page) => page.key === key);
            if (page)
              void navigation.open({
                version: 1,
                kind: "page",
                pluginId: page.pluginId,
                pageId: page.id,
              });
          }}
          workspace
          tone="default"
          communities={shellCommunities}
          accountActions={shell.accountActions}
          appearance={appearance}
          searchServices={shellSearch}
          creationAction={(
            open,
            onOpenChange,
            triggerContainer,
            menuTriggerContainer,
          ) => (
            <NewMenu
              relay={relay}
              navigator={navigation}
              open={open}
              onOpenChange={onOpenChange}
              triggerContainer={triggerContainer}
              menuTriggerContainer={menuTriggerContainer}
            />
          )}
        >
          {home}
        </AppShell>
      ) : (
        home
      )}
    </ToastProvider>
  );
}
const container = document.getElementById("root");
if (container)
  createRoot(container).render(
    <StrictMode>
      <Fixture />
    </StrictMode>,
  );
