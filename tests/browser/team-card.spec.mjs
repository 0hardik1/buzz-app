import { test, expect } from "./fixture.mjs";
import { showRail } from "./rail-helpers.mjs";
const longChannelName =
  "proj-builderlab-apps-and-remote-development-design-review";

test.use({
  productionBroker: true,
  enabledPlugins: ["buzz.drafts-and-sent"],
  readState: true,
  inboxDm: true,
  historyCounts: { alpha: 3, beta: 2 },
  channelNames: { beta: longChannelName },
});

// Hold real animation timelines at deterministic interruption points.
async function holdNextTransition(card, fraction) {
  return card.evaluateHandle((card, fraction) => {
    let animation;
    const observer = new MutationObserver(() => {
      animation = card
        .getAnimations({ subtree: true })
        .find(
          (item) =>
            item.id.startsWith("team-card-") && item.playState === "running",
        );
      if (!animation) return;
      animation.pause();
      animation.currentTime =
        Number(animation.effect.getTiming().duration) * fraction;
      observer.disconnect();
    });
    observer.observe(card, {
      subtree: true,
      attributes: true,
      attributeFilter: ["aria-selected"],
    });
    return {
      started: () => !!animation,
      sample() {
        const style = getComputedStyle(animation.effect.target);
        return {
          x: new DOMMatrixReadOnly(style.transform).m41,
          opacity: Number(style.opacity),
          filter: style.filter,
        };
      },
      release() {
        observer.disconnect();
        if (animation?.playState === "paused") animation.finish();
      },
    };
  }, fraction);
}

// Team keeps view shortcuts above recent conversations; list rows still drag
// onto the cards beside it.
test("Team card filters in place and list rows drag onto sidebar cards", async ({
  page,
  app,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 950 });
  for (let i = 0; i < 6; i++)
    app.append(
      "primary",
      "alpha",
      `Sent preview ${i} that must stay inside a compact row`,
      false,
      true,
    );
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  const card = rail.locator('[data-rail-section="team"]');
  await expect(card).toBeAttached();
  const restoredSheet = rail.locator("[data-rail-card-sheet]");
  if (await restoredSheet.isVisible()) {
    await restoredSheet
      .getByRole("button", { name: "Close expanded card" })
      .click();
    await expect(restoredSheet).toHaveCount(0);
  }
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
  await page.evaluate(() => document.fonts.ready);
  // Long labels must truncate inside the card, keeping both rounded row ends.
  expect(
    await recent.evaluate((list) => {
      const bounds = list.getBoundingClientRect();
      return [...list.querySelectorAll(".navigation-item")].every((button) => {
        const row = button.getBoundingClientRect();
        return row.left >= bounds.left && row.right <= bounds.right;
      });
    }),
  ).toBe(true);
  const stableHeight = (await card.boundingBox()).height;
  const headingNode = await card
    .getByRole("button", { name: "Team", exact: true })
    .elementHandle();
  const sameHeight = () =>
    expect
      .poll(async () => (await card.boundingBox()).height)
      .toBe(stableHeight);
  const channels = card.getByRole("tab", { name: "Channels", exact: true });
  const firstMotion = await holdNextTransition(card, 0.5);
  let secondMotion;
  try {
    await channels.click();
    await expect
      .poll(() => firstMotion.evaluate((held) => held.started()))
      .toBe(true);
    const before = await firstMotion.evaluate((held) => held.sample());
    secondMotion = await holdNextTransition(card, 0);
    await card.getByRole("tab", { name: "Mentions", exact: true }).click();
    await expect
      .poll(() => secondMotion.evaluate((held) => held.started()))
      .toBe(true);
    const after = await secondMotion.evaluate((held) => held.sample());
    expect(after.x).toBeCloseTo(before.x, 4);
    expect(after.opacity).toBeCloseTo(before.opacity, 4);
    expect(after.filter).toBe(before.filter);
  } finally {
    await firstMotion.evaluate((held) => held.release());
    await secondMotion?.evaluate((held) => held.release());
  }
  await expect(card.getByText("No conversations in this view")).toBeVisible();
  expect(page.url()).toBe(initialUrl);
  await sameHeight();
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
  await expect(recent.locator("[data-rail-row]")).toHaveCount(4);
  await sameHeight();
  expect(await headingNode.evaluate((node) => node.isConnected)).toBe(true);
  const rowGeometry = await recent.getByRole("button").evaluateAll((buttons) =>
    buttons.map((button) => {
      const row = button.getBoundingClientRect();
      const label = button
        .querySelector(".navigation-item-label")
        .getBoundingClientRect();
      return label.top >= row.top && label.bottom <= row.bottom;
    }),
  );
  expect(rowGeometry).toEqual([true, true, true, true]);
  await page.screenshot({ path: testInfo.outputPath("team-sent-compact.png") });
  await channels.click();
  await sameHeight();
  await card
    .getByRole("button", { name: "View more Team", exact: true })
    .click();
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
    card.getByRole("button", { name: "View more Team", exact: true }),
  ).toBeFocused();

  await expect(
    page.getByRole("button", { name: /^(Show|Hide) .+ list$/ }),
  ).toHaveCount(0);
  const dragAlpha = card.locator(
    '[data-rail-row="channel:alpha"] [data-conversation-row]',
  );

  // Card rows still drag onto Pins after dismissing a sheet.
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
  const reader = page.getByRole("region", {
    name: "Conversation detail",
    exact: true,
  });
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
    page.getByRole("textbox", {
      name: `Message #${longChannelName}`,
      exact: true,
    }),
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
