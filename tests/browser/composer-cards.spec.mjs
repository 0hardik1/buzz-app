import { finalizeEvent, generateSecretKey } from "nostr-tools/pure";
import { fileURLToPath } from "node:url";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { hoverMessage } from "./message-actions.mjs";
import { animationsSettled } from "./animations.mjs";

test.use({
  productionBroker: true,
  threadPlacement: "inline",
  historyCounts: { alpha: 2, beta: 0 },
});

// Real portal placement, hit testing, and moving a mounted editor into a split
// cannot be established by the retained-content unit tests.
test("a thread grows from the composer and moves its live draft into a split", async ({
  page,
  app,
}, testInfo) => {
  await open(page, app);
  const editor = page.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await editor.fill("Keep the channel draft");
  const row = page
    .getByRole("region", { name: "Channel message history" })
    .locator("[data-message-id]")
    .first();
  await hoverMessage(row);
  await row.getByRole("button", { name: "Reply", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Thread", exact: true });
  await expect(sheet).toBeVisible();
  const reply = sheet.getByRole("textbox", {
    name: "Reply to thread",
    exact: true,
  });
  await reply.fill("Keep the thread draft");
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await page.goForward();
  await expect(reply).toHaveText("Keep the thread draft");
  const threadRow = sheet.locator("[data-message-id]").first();
  await hoverMessage(threadRow);
  await threadRow
    .getByRole("button", { name: "More message actions", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Edit message", exact: true })
    .click();
  const editing = sheet.getByRole("textbox", {
    name: "Edit message",
    exact: true,
  });
  await editing.fill("Keep this unsaved edit");
  const liveEdit = await editing.elementHandle();
  await animationsSettled(sheet, { subtree: true });
  await expect(editing).toBeInViewport();
  await expect(editor).toBeHidden();
  await page.screenshot({
    path: testInfo.outputPath("thread-composer-sheet.png"),
  });
  await sheet
    .getByRole("button", { name: "Open in split panel", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  const split = page.locator("[data-panel-dock]");
  await expect(split).toBeVisible();
  await expect(
    split.getByRole("textbox", { name: "Edit message", exact: true }),
  ).toHaveText("Keep this unsaved edit");
  expect(
    await liveEdit.evaluate(
      (element) => !!element.closest("[data-panel-dock]"),
    ),
  ).toBe(true);
  await split
    .getByRole("textbox", { name: "Edit message", exact: true })
    .press("Escape");
  await expect(split).toBeVisible();
  await expect(
    split.getByRole("textbox", { name: "Reply to thread", exact: true }),
  ).toHaveText("Keep the thread draft");
  await expect(editor).toBeVisible();
  await expect(editor).toHaveText("Keep the channel draft");
  await page.screenshot({ path: testInfo.outputPath("thread-split.png") });
  await split.getByRole("button", { name: /^Close .* tab$/ }).click();
  await expect(split).toBeHidden();
  await page.goBack();
  await page.goForward();
  await expect(editor).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await expect(split).toBeHidden();
  await hoverMessage(row);
  await row.getByRole("button", { name: "Reply", exact: true }).press("Enter");
  await expect(
    sheet.getByRole("textbox", { name: "Reply to thread", exact: true }),
  ).toHaveText("Keep the thread draft");
  expect(
    await sheet.evaluate((element) => element.getAnimations().length),
  ).toBe(0);
  await expect(reply).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(editor).toHaveText("Keep the channel draft");
  await page.goBack();
  await page.goForward();
  await expect(editor).toBeVisible();
  await expect(sheet).toHaveCount(0);
});

test("a link card opens its inspector from the composer into a split", async ({
  page,
  app,
}, testInfo) => {
  const target = "https://github.com/block/buzz-app/pull/327";
  await page.route(
    "https://api.github.com/repos/block/buzz-app/pulls/327",
    (route) =>
      route.fulfill({
        json: {
          title: "Composer card review",
          state: "open",
          body: "Keep this inspector when it moves.",
        },
      }),
  );
  await page.route(
    /https:\/\/api\.github\.com\/repos\/.*\/(?:comments|reviews)\?/,
    (route) => route.fulfill({ json: [] }),
  );
  await open(page, app);
  app.append("primary", "alpha", target);
  await page.locator(`a[href="${target}"]`).click();
  const sheet = page.locator("[data-details-sheet-surface]");
  const content = sheet.getByText("Keep this inspector when it moves.");
  await expect(content).toBeVisible();
  await page.goBack();
  await expect(sheet).toHaveCount(0);
  await page.goForward();
  await expect(content).toBeVisible();
  await animationsSettled(sheet, { subtree: true });
  await page.screenshot({
    path: testInfo.outputPath("link-composer-sheet.png"),
  });
  await sheet
    .getByRole("button", { name: "Open in split panel", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  const split = page.locator("[data-panel-dock]");
  await expect(
    split.getByText("Keep this inspector when it moves."),
  ).toBeVisible();
  await expect(
    page.getByRole("textbox", { name: "Message #Alpha", exact: true }),
  ).toBeEditable();
  await page.goBack();
  await expect(split).toBeHidden();
  await page.goForward();
  await expect(
    split.getByText("Keep this inspector when it moves."),
  ).toBeVisible();
  await split.getByRole("button", { name: /^Close .* tab$/ }).click();
  await expect(split).toBeHidden();
  await page.goBack();
  await page.goForward();
  await expect(split).toBeHidden();
  await expect(sheet).toHaveCount(0);
});

test("image comments retain their live editor when opened in a split", async ({
  page,
  app,
}, testInfo) => {
  await page.addInitScript(() => {
    localStorage.setItem("buzz-appearance.v1", "dark");
    localStorage.setItem("buzz-font-scale.v1", "1.2");
  });
  const picture = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 640;
    canvas.height = 400;
    const context = canvas.getContext("2d");
    context.fillStyle = "#4d80b0";
    context.fillRect(0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png").split(",")[1];
  });
  await page.route("**/api/relay/primary/media?**", (route) =>
    route.fulfill({
      contentType: "image/png",
      body: Buffer.from(picture, "base64"),
    }),
  );
  await open(page, app);
  const event = app.append(
    "primary",
    "alpha",
    "Photo to discuss",
    true,
    true,
    undefined,
    undefined,
    [["imeta", "url https://primary.example/media/photo.png", "m image/png"]],
  );
  const row = page
    .getByRole("region", { name: "Channel message history" })
    .locator(`[data-message-id="${event.id}"]`);
  await row.getByRole("link", { name: "Open image attachment" }).click();
  const sheet = page.getByRole("dialog", { name: "photo.png", exact: true });
  await expect(sheet).toBeVisible();
  const reply = sheet.getByRole("textbox", {
    name: "Reply to thread",
    exact: true,
  });
  await reply.fill("Keep the photo comment");
  const retained = await reply.elementHandle();
  await animationsSettled(sheet, { subtree: true });
  await expect(reply).toBeInViewport();
  await page.screenshot({
    path: testInfo.outputPath("image-composer-sheet.png"),
  });
  await sheet
    .getByRole("button", { name: "Open in split panel", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  const split = page.locator("[data-panel-dock]");
  await expect(
    split.getByRole("textbox", { name: "Reply to thread", exact: true }),
  ).toHaveText("Keep the photo comment");
  expect(
    await retained.evaluate(
      (element) => !!element.closest("[data-panel-dock]"),
    ),
  ).toBe(true);
  const stage = split.locator("[data-review-stage]");
  await expect(stage).toBeVisible();
  await expect
    .poll(() => stage.evaluate((element) => element.clientWidth))
    .toBeGreaterThan(100);
  await expect
    .poll(() => stage.evaluate((element) => element.clientHeight))
    .toBeGreaterThan(100);
  const other = page
    .getByRole("region", { name: "Channel message history" })
    .locator("[data-message-id]")
    .first();
  await hoverMessage(other);
  await other.getByRole("button", { name: "Reply", exact: true }).click();
  const thread = page.getByRole("dialog", { name: "Thread", exact: true });
  await expect(thread).toBeVisible();
  await thread
    .getByRole("button", { name: "Open in split panel", exact: true })
    .click();
  const kept = split.getByRole("tab", { name: "photo.png", exact: true });
  await kept.click({ button: "right" });
  await page
    .getByRole("menuitem", { name: "Close other tabs", exact: true })
    .click();
  await expect(kept).toHaveAttribute("aria-selected", "true");
  await expect(
    split.getByRole("textbox", { name: "Reply to thread", exact: true }),
  ).toHaveText("Keep the photo comment");
  expect(
    await retained.evaluate(
      (element) => !!element.closest("[data-panel-dock]"),
    ),
  ).toBe(true);
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(stage).toBeInViewport();
  await split.screenshot({
    path: testInfo.outputPath("image-split-dark-enlarged.png"),
  });
});

test("an addressed thread link opens inline without losing its navigation return", async ({
  page,
  app,
}) => {
  await open(page, app);
  const history = page.getByRole("region", { name: "Channel message history" });
  const rootId = await history
    .locator("[data-message-id]")
    .first()
    .getAttribute("data-message-id");
  const link = app.append(
    "primary",
    "alpha",
    `<buzz://message?channel=alpha&id=${rootId}&thread=${rootId}>`,
    true,
    false,
  );
  await history
    .locator(`[data-message-id="${link.id}"]`)
    .getByRole("link")
    .click();
  const sheet = page.getByRole("dialog", { name: "Thread", exact: true });
  await expect(sheet).toBeVisible();
  await expect(sheet.locator(`[data-message-id="${rootId}"]`)).toBeVisible();
  await sheet
    .getByRole("button", { name: "Open in split panel", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  await expect(
    page
      .locator("[data-panel-dock]")
      .getByRole("textbox", { name: "Reply to thread", exact: true }),
  ).toBeVisible();
});

test("a video keeps its element and position when its card moves into a split", async ({
  page,
  app,
}) => {
  await page.route("**/api/relay/primary/media?**", (route) =>
    route.fulfill({
      path: fileURLToPath(
        new URL(
          "../fixtures/message-gallery/assets/sample.mp4",
          import.meta.url,
        ),
      ),
      contentType: "video/mp4",
    }),
  );
  await open(page, app);
  const event = app.append(
    "primary",
    "alpha",
    "Video card",
    true,
    true,
    undefined,
    undefined,
    [["imeta", "url https://primary.example/media/sample.mp4", "m video/mp4"]],
  );
  const row = page
    .getByRole("region", { name: "Channel message history" })
    .locator(`[data-message-id="${event.id}"]`);
  await row.locator("[data-video-preview]").hover();
  await row
    .getByRole("button", { name: "Open video fullscreen", exact: true })
    .click();
  const sheet = page.locator("[data-details-sheet-surface]");
  await expect(sheet).toBeVisible();
  const video = sheet.locator("video[data-review-media]");
  await expect
    .poll(() => video.evaluate((element) => element.readyState))
    .toBeGreaterThanOrEqual(2);
  await video.evaluate(async (element) => {
    element.muted = true;
    await element.play();
  });
  await expect
    .poll(() => video.evaluate((element) => element.currentTime))
    .toBeGreaterThan(0.5);
  const stoppedAt = await video.evaluate((element) => {
    element.pause();
    return element.currentTime;
  });
  const retained = await video.elementHandle();
  await sheet
    .getByRole("button", { name: "Open in split panel", exact: true })
    .click();
  await expect(sheet).toHaveCount(0);
  expect(
    await retained.evaluate(
      (element) => !!element.closest("[data-panel-dock]"),
    ),
  ).toBe(true);
  await expect
    .poll(() => retained.evaluate((element) => element.currentTime))
    .toBeCloseTo(stoppedAt, 1);
  await expect
    .poll(() => retained.evaluate((element) => element.paused))
    .toBe(true);
});

// The real virtualizer must not evict a renderer that owns a promoted reader.
test("a promoted diff keeps its layout when its original message leaves the viewport", async ({
  page,
  app,
}) => {
  const rows = app.histories.get("primary/alpha");
  const event = finalizeEvent(
    {
      kind: 40008,
      content:
        "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n",
      created_at: rows.at(-1).created_at + 1,
      tags: [
        ["h", "alpha"],
        ["file", "a.ts"],
      ],
    },
    generateSecretKey(),
  );
  rows.push(event);
  await open(page, app);
  const original = page.locator(
    `[data-channel-timeline] [data-message-id="${event.id}"]`,
  );
  await original
    .getByRole("button", { name: "Expand diff", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "a.ts", exact: true });
  await sheet.getByRole("button", { name: "Split", exact: true }).click();
  await sheet
    .getByRole("button", { name: "Open in split panel", exact: true })
    .click();
  const split = page.locator("[data-panel-dock]");
  await expect(split.locator("table.diff-split")).toBeVisible();
  for (let i = 0; i < 40; i++)
    app.append(
      "primary",
      "alpha",
      `Following message ${i}\n${"More history. ".repeat(30)}`,
    );
  await expect(original).not.toBeInViewport();
  await expect(split.locator("table.diff-split")).toBeVisible();
  await split.getByRole("button", { name: /^Close .* tab$/ }).click();
  await expect(split).toBeHidden();
});
