import { type ReactNode, useRef, useState } from "react";
import { createNavigationController } from "../navigation/controller";
import { createMemoryHistory } from "../navigation/history";
import type { OpenTarget } from "../navigation/targets";
import { InlineContainers, useWorkspaceReading } from "./inline-containers";
import type { ReadingHost } from "./reading";

/** A conversation's address, for tests that open what reads over it. */
export const testConversation = (channelId: string): OpenTarget => ({
  version: 1,
  kind: "conversation",
  scope: { viewer: "a".repeat(64), communityOrigin: "https://example.org" },
  channelId,
});

/** A workspace reading over memory history, with tabs from `host`. */
export function TestWorkspace({
  channelId,
  host,
  children,
}: {
  channelId: string;
  host?: Partial<ReadingHost> | undefined;
  children: ReactNode;
}) {
  const [navigator] = useState(
    () =>
      createNavigationController(
        createMemoryHistory(testConversation(channelId)),
      ).navigation,
  );
  const tabs = useRef<ReadingHost>(undefined);
  tabs.current = {
    inline: () => true,
    hasThreadTab: () => false,
    openThreadTab: () => {},
    hasPanelTab: () => false,
    openPanelTab: () => {},
    adoptVisits: () => {},
    ...host,
  };
  const renderPanel = useRef(undefined);
  const { workspace, dialogs } = useWorkspaceReading(
    navigator,
    tabs,
    renderPanel,
  );
  return (
    <InlineContainers value={workspace}>
      {children}
      {dialogs}
    </InlineContainers>
  );
}
