import { test, expect } from "./fixture.mjs";
import { showRail } from "./rail-helpers.mjs";
import { showConversationList } from "./navigation.mjs";
test.use({
  productionBroker: true,
  enabledPlugins: ["buzz.drafts-and-sent"],
  readState: true,
  inboxDm: true,
  historyCounts: { alpha: 3, beta: 2 },
});

// Team keeps view shortcuts above recent conversations; list rows still drag
// onto the cards beside it.
test("Team card filters in place and list rows drag onto sidebar cards", async ({
  page,
  app,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 950 });
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  const card = rail.locator('[data-rail-section="team"]');
  for (const name of ["Activity", "Threads", "DMs", "Mentions", "Channels"])
    await expect(
      card.getByRole("tab", { name: new RegExp(`^${name}`) }),
    ).toBeVisible();
  const recent = card.getByRole("list", { name: "Team conversations" });
  await expect(recent).toBeVisible();
  await expect(recent.locator('[data-rail-row="channel:alpha"]')).toBeVisible();
  const icons = card.locator("[data-rail-team-icons]");
  await expect(icons).toBeVisible();
  await expect(icons.getByRole("tab")).toHaveCount(6);
  await page
    .getByRole("separator", { name: "Resize app sidebar" })
    .press("Home");
  // The minimum sidebar width must fit all Team shortcuts in one row.
  await expect
    .poll(() =>
      icons
        .getByRole("tab")
        .evaluateAll(
          (buttons) =>
            new Set(
              buttons.map((button) =>
                Math.round(button.getBoundingClientRect().top),
              ),
            ).size,
        ),
    )
    .toBe(1);
  await expect(icons.getByRole("tab").last()).toHaveAccessibleName(
    "Drafts & sent",
  );
  const initialUrl = page.url();
  const channels = card.getByRole("tab", { name: "Channels", exact: true });
  await channels.click();
  await expect(channels).toHaveAttribute("aria-selected", "true");
  await expect(recent.locator('[data-rail-row="channel:alpha"]')).toBeVisible();
  await card.getByRole("tab", { name: "Mentions", exact: true }).click();
  await expect(card.getByText("No conversations in this view")).toBeVisible();
  expect(page.url()).toBe(initialUrl);
  const dms = card.getByRole("tab", { name: "DMs", exact: true });
  await dms.click();
  await expect(recent.locator('[data-rail-row="channel:alpha"]')).toHaveCount(
    0,
  );
  await dms.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Mark as read", exact: true })
    .click();
  await dms.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Mark as unread", exact: true })
    .click();
  await card.getByRole("tab", { name: "Drafts & sent", exact: true }).click();
  await expect(
    card.getByRole("tab", { name: "Drafts & sent", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  expect(page.url()).toBe(initialUrl);
  await channels.click();
  await card.getByRole("button", { name: "Team", exact: true }).click();
  const sheet = rail.locator("[data-rail-card-sheet]");
  const index = sheet.getByRole("region", { name: "Team list", exact: true });
  const alpha = index.locator(
    '[data-activity-row="alpha"] [data-conversation-row]',
  );
  await expect(alpha).toBeVisible();

  await expect(sheet).toBeVisible();
  expect(page.url()).toBe(initialUrl);
  await expect(
    sheet.getByRole("button", { name: "Close expanded card" }),
  ).toBeFocused();
  await sheet
    .getByRole("button", { name: "Close expanded card" })
    .press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    card.getByRole("button", { name: "Team", exact: true }),
  ).toBeFocused();

  // The reader's own list remains available for dragging onto the rail.
  await showConversationList(page);
  await page.locator("[data-detail-workspace]").evaluate(async (node) => {
    await Promise.all(
      node
        .getAnimations({ subtree: true })
        .filter(
          (animation) =>
            animation.effect?.getComputedTiming().iterations !== Infinity,
        )
        .map((animation) => animation.finished.catch(() => {})),
    );
  });
  const dragAlpha = page
    .getByRole("region", { name: "Team", exact: true })
    .locator('[data-activity-row="alpha"] [data-conversation-row]');

  // Drop the list's row on the Pins card.
  const pins = rail.locator('[data-rail-section="pins"]');
  const from = await dragAlpha.boundingBox();
  const to = await pins.boundingBox();
  await page.mouse.move(from.x + 40, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(from.x + 20, from.y + from.height / 2, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 12,
  });
  await expect(pins).toHaveAttribute("data-drop-target", "true");
  await page.mouse.up();
  await expect(pins.locator('[data-rail-row="channel:alpha"]')).toBeVisible();

  await card
    .locator('[data-rail-row="channel:alpha"] [data-conversation-row]')
    .click();
  const composer = page.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await expect(composer).toBeVisible();
  await composer.fill("Keep this draft while browsing cards");
  const reader = page.locator("[data-list-page]");
  const readerBefore = await reader.boundingBox();
  const conversationUrl = page.url();
  await rail.getByRole("button", { name: "New section", exact: true }).click();
  const createSection = page.getByRole("dialog", {
    name: "Create new section",
  });
  await createSection
    .getByRole("textbox", { name: "Section name" })
    .fill("My card");
  await createSection
    .getByRole("button", { name: "Create", exact: true })
    .click();
  await expect(createSection).toHaveCount(0);
  for (const title of ["Team", "Solo", "Pins", "Plugins", "My card"]) {
    const opener = rail.getByRole("button", { name: title, exact: true });
    await opener.click();
    await expect(sheet).toBeVisible();
    await expect(
      sheet.getByRole("heading", { name: title, exact: true }),
    ).toBeVisible();
    await expect(composer).toHaveText("Keep this draft while browsing cards");
    expect(page.url()).toBe(conversationUrl);
    await expect
      .poll(async () => {
        const bounds = await sheet.boundingBox();
        const railBounds = await rail.boundingBox();
        return (
          bounds.x >= railBounds.x &&
          bounds.x + bounds.width <= railBounds.x + railBounds.width
        );
      })
      .toBe(true);
    expect(await reader.boundingBox()).toEqual(readerBefore);
    await sheet.getByRole("button", { name: "Close expanded card" }).click();
    await expect(sheet).toHaveCount(0);
    await expect(opener).toBeFocused();
  }

  await card.getByRole("button", { name: "Team", exact: true }).press("Enter");
  await expect(sheet).toBeVisible();
  expect(await sheet.evaluate((node) => node.getAnimations().length)).toBe(0);
  await index
    .locator('[data-activity-row="beta"] [data-conversation-row]')
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message #Beta", exact: true }),
  ).toBeVisible();
  await expect(sheet).toBeVisible();
  await index
    .locator('[data-activity-row="alpha"] [data-conversation-row]')
    .click();
  await expect(composer).toHaveText("Keep this draft while browsing cards");
  await sheet
    .getByRole("button", { name: "Close expanded card" })
    .press("Escape");
  await expect(sheet).toHaveCount(0);

  // All shortcuts stay reachable in a narrow drawer with enlarged text.
  // Geometry and native keyboard activation require a real browser.
  for (const mode of ["light", "dark"]) {
    for (const width of [1920, 480]) {
      await page.setViewportSize({ width, height: 950 });
      await page.evaluate(
        ({ mode, width }) => {
          document.documentElement.dataset.colorMode = mode;
          document.documentElement.style.fontSize = width === 480 ? "200%" : "";
        },
        { mode, width },
      );
      await showRail(page);
      await card.scrollIntoViewIfNeeded();
      for (const control of await icons.getByRole("tab").all())
        await expect(control).toBeInViewport();
      await card.getByRole("button", { name: "Team", exact: true }).click();
      await expect(sheet).toBeVisible();
      await expect(
        sheet.getByRole("button", { name: "Close expanded card" }),
      ).toBeInViewport();
      await sheet.evaluate(async (node) => {
        await Promise.all(
          node
            .getAnimations()
            .map((animation) => animation.finished.catch(() => {})),
        );
      });
      await page.screenshot({
        path: testInfo.outputPath(`team-${mode}-${width}.png`),
      });
      await sheet
        .getByRole("button", { name: "Close expanded card" })
        .press("Escape");
      await expect(sheet).toHaveCount(0);
    }
  }
  await channels.focus();
  await page.keyboard.press("Enter");
  await expect(channels).toHaveAttribute("aria-selected", "true");
});
