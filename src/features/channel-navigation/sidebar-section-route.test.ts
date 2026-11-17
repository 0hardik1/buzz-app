import { expect, test } from "vitest";
import {
  routedSidebarSection,
  sidebarSectionTarget,
} from "./sidebar-section-route";

test("saved section addresses retain their destination in rail sheets", () => {
  const scope = {
    viewer: "a".repeat(64),
    communityOrigin: "https://relay.test",
  };
  expect(
    routedSidebarSection({
      version: 1,
      kind: "page",
      pluginId: "buzz.channels",
      pageId: "channels",
    }),
  ).toBe("team");
  for (const section of ["team", "solo", "pins", "custom:one"])
    expect(routedSidebarSection(sidebarSectionTarget(scope, section))).toBe(
      section,
    );
  expect(routedSidebarSection(sidebarSectionTarget(scope, "messages"))).toBe(
    "team",
  );
  expect(
    routedSidebarSection({
      version: 1,
      kind: "page",
      pluginId: "buzz.channels",
      pageId: "channels",
      route: { version: 1, params: "compose" },
    }),
  ).toBeUndefined();
  expect(
    routedSidebarSection({
      version: 1,
      kind: "conversation",
      scope,
      channelId: "one",
    }),
  ).toBeUndefined();
});
