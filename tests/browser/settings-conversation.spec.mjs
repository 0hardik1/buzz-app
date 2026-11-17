import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import {
  channelRow,
  closeSettings,
  hideNarrowConversationList,
  openSettings,
  settingsSections,
  showConversationList,
} from "./navigation.mjs";

// Responsive modal navigation and a retained native editor need a real browser.
test("narrow Settings returns to the conversation without a collection column", async ({
  page,
  app,
}) => {
  await open(page, app);
  await page.setViewportSize({ width: 600, height: 950 });
  await showConversationList(page);
  await channelRow(page, "beta").press("Enter");
  const composer = page.getByRole("textbox", {
    name: "Message #Beta",
    exact: true,
  });
  await expect(composer).toBeVisible();
  await hideNarrowConversationList(page);
  await composer.click();
  await page.keyboard.type("Usable destination");
  await expect(composer).toHaveText("Usable destination");
  await composer.fill("");
  const showNavigation = page.getByRole("button", {
    name: "Show navigation",
    exact: true,
  });
  await expect(showNavigation).toBeVisible();
  await openSettings(page);
  // The workspace's drawer toggle is behind the modal; Settings keeps its own
  // section navigation in view instead of a drawer.
  await expect(showNavigation).toHaveCount(0);
  const sections = settingsSections(page);
  await expect(sections).toBeInViewport();
  const notifications = sections.getByRole("button", {
    name: "Notifications",
    exact: true,
  });
  await notifications.press("Enter");
  await expect(notifications).toHaveAttribute("aria-current", "page");
  await expect(
    page.getByRole("region", { name: "Notifications", exact: true }),
  ).toBeVisible();
  // Selecting the current section is a new attempt, not a new history visit.
  await notifications.press("Enter");
  await expect(notifications).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect(
    sections.getByRole("button", { name: "Profile", exact: true }),
  ).toHaveAttribute("aria-current", "page");
  await closeSettings(page);
  await expect(composer).toBeVisible();
  await page.setViewportSize({ width: 1440, height: 950 });
  await showConversationList(page);
  await expect(
    page.getByRole("button", { name: /^(Show|Hide) .+ list$/ }),
  ).toHaveCount(0);
});
