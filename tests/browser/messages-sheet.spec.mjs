import { test, expect } from "./fixture.mjs";
import { animationsSettled } from "./animations.mjs";
import {
  channelRow,
  conversationList,
  hideNarrowConversationList,
  showConversationList,
  showCollectionView,
  showRailCards,
} from "./navigation.mjs";
test.use({
  productionBroker: true,
  readState: true,
  inboxDm: true,
  historyCounts: { alpha: 3, beta: 2 },
});

async function closeSheet(page) {
  await page.getByRole("button", { name: "Close expanded card" }).click();
  await expect(page.locator("[data-rail-card-sheet]")).toHaveCount(0);
}

// Real routing, native editing and viewport geometry must preserve the reader
// while the collection lives exclusively over the rail.
test("Team sheets preserve conversation drafts and history without a second sidebar", async ({
  page,
  app,
}, testInfo) => {
  await page.setViewportSize({ width: 1920, height: 950 });
  await page.goto(app.origin);
  await showConversationList(page);
  const detail = page.getByRole("region", {
    name: "Conversation detail",
    exact: true,
  });
  await channelRow(page, "alpha").click();
  const editor = detail.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await editor.fill("Keep the conversation draft");
  const readerBounds = await detail.boundingBox();
  await channelRow(page, "beta").click();
  await expect(detail.locator('[data-channel-timeline="beta"]')).toBeVisible();
  await page.goBack();
  await expect(editor).toHaveText("Keep the conversation draft");
  await page.goForward();
  await expect(detail.locator('[data-channel-timeline="beta"]')).toBeVisible();
  await channelRow(page, "alpha").click();
  await expect(editor).toHaveText("Keep the conversation draft");
  const url = page.url();
  await closeSheet(page);
  await expect(page).toHaveURL(url);
  expect(await detail.boundingBox()).toEqual(readerBounds);
  await page.reload();
  await expect(editor).toHaveText("Keep the conversation draft");
  await expect(conversationList(page)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: /^(Show|Hide) .+ list$/ }),
  ).toHaveCount(0);
  await showConversationList(page);
  await page
    .locator("[data-rail-card-sheet]")
    .getByRole("button", { name: "New message", exact: true })
    .click();
  const compose = detail.getByRole("region", {
    name: "New message",
    exact: true,
  });
  await expect(
    compose.getByRole("combobox", { name: "Message recipients" }),
  ).toBeVisible();
  await closeSheet(page);
  await expect(
    page.getByRole("button", { name: /^(Show|Hide) .+ list$/ }),
  ).toHaveCount(0);
  await compose
    .getByRole("combobox", { name: "Message recipients" })
    .fill("Beta");
  await page.getByRole("option", { name: /^Beta/ }).click();
  await expect(compose.getByRole("textbox")).toBeEditable();
  await page.setViewportSize({ width: 480, height: 950 });
  await page.emulateMedia({ colorScheme: "dark" });
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "125%";
  });
  await hideNarrowConversationList(page);
  await expect(compose.getByRole("textbox")).toBeInViewport();
  await showConversationList(page);
  await expect(page.locator("[data-rail-card-sheet]")).toBeInViewport();
  await hideNarrowConversationList(page);
  await expect(compose.getByRole("textbox")).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("sheet-only-narrow-compose.png"),
  });
});

// Real rail membership, navigation history and the reader must agree on the
// collection; the DOM owner tests do not run this shell/page composition.
test("section sheets retain membership while conversations and history preserve drafts", async ({
  page,
  app,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.addInitScript(
    ({ viewer }) => {
      const scope = { viewer, communityOrigin: "https://primary.example" };
      localStorage.setItem(
        `buzz-view.v1:${JSON.stringify([`${scope.communityOrigin}:${viewer}`, "navigation-layout:v2"])}`,
        JSON.stringify({
          sections: [{ id: "custom:project", title: "Project chats" }],
          placements: ["alpha", "beta"].map((channelId) => ({
            section: "custom:project",
            entry: {
              id: `channel:${channelId}`,
              label: channelId === "alpha" ? "Alpha" : "Beta",
              kind: "channel",
              target: { version: 1, kind: "conversation", scope, channelId },
            },
          })),
        }),
      );
    },
    { viewer: app.viewer },
  );
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  const card = rail.locator('[data-rail-section="custom:project"]');
  await showConversationList(page);
  await closeSheet(page);
  await card.getByRole("button", { name: "Alpha", exact: true }).click();
  const reader = page.getByRole("region", {
    name: "Conversation detail",
    exact: true,
  });
  await showConversationList(page, "Project chats");
  const list = page.getByRole("region", { name: "Project chats", exact: true });
  await expect(
    list.getByRole("heading", { name: "Project chats", exact: true }),
  ).toBeVisible();
  await expect(
    list.locator('[data-activity-row="alpha"] [data-conversation-row]'),
  ).toBeVisible();
  await expect(
    list.locator('[data-activity-row="beta"] [data-conversation-row]'),
  ).toBeVisible();
  await expect(list.locator('[data-activity-row="dm-peer"]')).toHaveCount(0);
  const previewText = "Section preview stays on a single line. "
    .repeat(12)
    .trim();
  app.append("primary", "beta", previewText, true, false);
  const preview = list.getByText(/^Section preview stays on a single line\./);
  await expect(preview).toBeVisible();
  expect(
    await preview.evaluate(
      (element) =>
        element.getBoundingClientRect().height /
        parseFloat(getComputedStyle(element).lineHeight),
    ),
  ).toBeLessThanOrEqual(1.05);
  const editor = reader.getByRole("textbox", { name: /^Message/ });
  await editor.fill("Keep the section conversation draft");
  await list
    .locator('[data-activity-row="beta"] [data-conversation-row]')
    .click();
  await expect(reader.locator('[data-channel-timeline="beta"]')).toBeVisible();
  await expect(list).toBeVisible();
  await page.goBack();
  await expect(editor).toHaveText("Keep the section conversation draft");
  await expect(list).toBeVisible();
  const railBox = await rail.boundingBox();
  const canvasBox = await page.locator(".shell-body").boundingBox();
  expect(railBox.x + railBox.width).toBeCloseTo(canvasBox.x, 0);
  await page.screenshot({
    path: testInfo.outputPath("section-conversation-list.png"),
  });
  await page.reload();
  await showConversationList(page, "Project chats");
  await expect(
    list.locator('[data-activity-row="beta"] [data-conversation-row]'),
  ).toBeVisible();
  await expect(list.locator('[data-activity-row="dm-peer"]')).toHaveCount(0);
  await showCollectionView(page, "dms");
  await page
    .locator(
      '[data-rail-card-sheet] [data-activity-row="dm-peer"] [data-conversation-row]',
    )
    .click({ button: "right" });
  await page.getByRole("menuitem", { name: "Pin", exact: true }).click();
  await showConversationList(page, "Pins");
  const pins = page.locator("[data-rail-card-sheet]");
  await expect(
    pins.locator('[data-activity-row="dm-peer"] [data-conversation-row]'),
  ).toBeVisible();
  await expect(pins.locator('[data-activity-row="alpha"]')).toHaveCount(0);
  await animationsSettled(page.locator("[data-rail-card-sheet]"), {
    subtree: true,
  });
  await page.screenshot({
    path: testInfo.outputPath("pins-conversation-previews.png"),
  });
});

// dnd-kit collision detection and the clipped scrollport require a layout engine.
test("rail cards can drop at the top without adding a gap", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1600, height: 1100 });
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  await showConversationList(page);
  await closeSheet(page);
  const cards = rail.locator("[data-rail-section]");
  await expect(cards.first()).toBeVisible();
  const firstId = await cards.first().getAttribute("data-rail-section");
  const source = cards.nth(1);
  const movedId = await source.getAttribute("data-rail-section");
  const grabber = source.getByRole("button", { name: /^Move .* section$/ });
  const grab = await grabber.boundingBox();
  const first = await cards.first().boundingBox();
  await page.mouse.move(grab.x + grab.width / 2, grab.y + grab.height / 2);
  await page.mouse.down();
  await page.mouse.move(
    grab.x + grab.width / 2 + 10,
    grab.y + grab.height / 2,
    { steps: 3 },
  );
  await page.mouse.move(first.x + first.width / 2, first.y + 2, { steps: 12 });
  const target = rail.locator('[aria-hidden="true"][data-drop-target]');
  await expect(target).toBeVisible();
  expect((await target.locator("..").boundingBox()).y).toBe(first.y);
  await expect
    .poll(() =>
      target.evaluate((node) =>
        Number(getComputedStyle(node, "::after").opacity),
      ),
    )
    .toBe(1);
  await page.mouse.up();
  await expect(cards.first()).toHaveAttribute("data-rail-section", movedId);
  await expect(cards.nth(1)).toHaveAttribute("data-rail-section", firstId);
  await page.reload();
  await showRailCards(page);
  await expect(cards.first()).toHaveAttribute("data-rail-section", movedId);
  await cards
    .first()
    .getByRole("button", { name: "Pins", exact: true })
    .click();
  await expect(
    page
      .locator("[data-rail-card-sheet]")
      .getByRole("heading", { name: "Pins", exact: true }),
  ).toBeVisible();
});

// The collection action and card action must use the same durable Solo draft.
test("Solo sheet and card plus share the new-chat composer", async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  await showConversationList(page, "Solo");
  const sheet = page.locator("[data-rail-card-sheet]");
  await sheet.getByRole("button", { name: "New message", exact: true }).click();
  const draft = page.getByRole("region", { name: "New chat", exact: true });
  const editor = draft.getByRole("textbox", {
    name: "Message your agents",
    exact: true,
  });
  await editor.fill("Keep the same Solo draft");
  await expect(
    draft.getByRole("button", { name: "Chat settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Message recipients" }),
  ).toHaveCount(0);
  await closeSheet(page);
  const card = page.locator('[data-rail-section="solo"]');
  await card
    .getByRole("button", { name: "New Solo chat", exact: true })
    .click();
  await expect(editor).toHaveText("Keep the same Solo draft");
  await showConversationList(page, "Solo");
  await expect(editor).toHaveText("Keep the same Solo draft");
  await expect(
    page.getByRole("button", { name: /^(Show|Hide) .+ list$/ }),
  ).toHaveCount(0);
});
