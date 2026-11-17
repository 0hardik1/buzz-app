import { test, expect } from "./fixture.mjs";
import { animationsSettled } from "./animations.mjs";
import {
  hideNarrowConversationList,
  openChannel,
  openPage,
  showConversationList,
} from "./navigation.mjs";
test.use({
  productionBroker: true,
  readState: true,
  enabledPlugins: ["buzz.todos"],
  historyCounts: { alpha: 3 },
});
// Browser-only: header placement, flat menu keyboard focus, and stable history geometry.
test("conversation header opens its tools without moving history", async ({
  page,
  app,
}, testInfo) => {
  await page.goto(app.origin);
  await openPage(page, "Team");
  await openChannel(page, "alpha");
  const pane = page.getByRole("article", { name: "Conversation", exact: true });
  const identity = pane.getByRole("button", {
    name: "Manage members of Alpha",
    exact: true,
  });
  const trigger = pane.getByRole("button", {
    name: "Conversation actions",
    exact: true,
  });
  const actions = page.getByRole("button", {
    name: "View channel details",
    exact: true,
  });
  await expect(identity).toBeVisible();
  const editor = pane.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await editor.fill("Keep my draft when returning to Messages");
  const title = pane.getByRole("heading", {
    name: "Alpha",
    level: 2,
    exact: true,
  });
  await expect(title).toBeVisible();
  await expect(trigger).toBeVisible();
  await identity.hover();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  const history = pane.locator("[data-channel-timeline]");
  const before = await history.boundingBox();
  const identityBox = await identity.boundingBox();
  const titleBox = await title.boundingBox();
  const paneBox = await pane.boundingBox();
  const triggerBox = await trigger.boundingBox();
  expect(identityBox.x).toBeLessThan(paneBox.x + paneBox.width / 4);
  expect(titleBox.x).toBeGreaterThanOrEqual(identityBox.x + identityBox.width);
  expect(titleBox.x + titleBox.width).toBeLessThan(triggerBox.x);
  expect(identityBox.height).toBeCloseTo(triggerBox.height, 0);
  expect(identityBox.y).toBeCloseTo(triggerBox.y, 0);
  expect(titleBox.y + titleBox.height / 2).toBeCloseTo(
    identityBox.y + identityBox.height / 2,
    0,
  );
  await trigger.click();
  await expect(actions).toBeVisible();
  await animationsSettled(page.locator(".buzz-popover-popup:visible"), {
    subtree: true,
  });
  expect((await history.boundingBox()).y).toBe(before.y);
  await page.screenshot({ path: testInfo.outputPath("header-tools.png") });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.screenshot({ path: testInfo.outputPath("header-tools-dark.png") });
  await expect(
    page.getByRole("button", { name: "Channel actions", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".buzz-popover-popup:visible")).toHaveCount(1);
  await actions.focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    page.getByRole("button", { name: "Toggle channel todos", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(actions).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(trigger).toBeFocused();
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await page.keyboard.press("Enter");
  await expect(actions).toBeVisible();
  await page.setViewportSize({ width: 480, height: 950 });
  await page.emulateMedia({ colorScheme: "dark" });
  await expect(actions).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("header-tools-narrow.png"),
  });
  await page.keyboard.press("Escape");
  await showConversationList(page);
  await expect(page.locator("[data-rail-card-sheet]")).toBeVisible();
  await page.getByRole("button", { name: "Close expanded card" }).click();
  await hideNarrowConversationList(page);
  await expect(editor).toHaveText("Keep my draft when returning to Messages");
});
