import { hoverMessage } from "./message-actions.mjs";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

test.use({ threadPlacement: "inline", historyCounts: { alpha: 1, beta: 0 } });

const pull = "https://github.com/block/buzz-app/pull/327";
const longDetails = `Brief line\n\n${"More detail here. ".repeat(60)}\n\nThe end.`;
const diff =
  "diff --git a/a.ts b/a.ts\n--- a/a.ts\n+++ b/a.ts\n@@ -1 +1 @@\n-old\n+new\n";
const sheets = (page) => page.locator("[data-details-sheet-surface]");
const back = (page) => page.getByRole("button", { name: "Go back" }).click();
const forward = (page) => page.getByRole("button", { name: "Go forward" });

async function routePull(page) {
  await page.route(
    "https://api.github.com/repos/block/buzz-app/pulls/327",
    (route) =>
      route.fulfill({
        json: { title: "A PR", state: "open", body: "PR body" },
      }),
  );
  await page.route(
    /https:\/\/api\.github\.com\/repos\/.*\/(?:comments|reviews)\?/,
    (route) => route.fulfill({ json: [] }),
  );
}
function row(page, event) {
  return page.locator(
    `[data-channel-timeline] [data-message-id="${event.id}"]`,
  );
}
async function openThread(page, root) {
  await expect(row(page, root)).toBeVisible();
  await hoverMessage(row(page, root));
  await row(page, root)
    .getByRole("button", { name: "Reply", exact: true })
    .click();
  const sheet = page.getByRole("dialog", { name: "Thread", exact: true });
  await expect(sheet).toBeVisible();
  return sheet;
}

// Back closes it, Forward opens it again, and ✕ takes it out of both.
async function journey(page, { opened, close, reopened }) {
  await expect(opened()).toHaveCount(1);
  await back(page);
  await expect(opened()).toHaveCount(0);
  await forward(page).click();
  await expect(opened()).toHaveCount(1);
  await reopened?.();
  await close();
  await expect(opened()).toHaveCount(0);
  await expect(forward(page)).toBeDisabled();
  await back(page);
  await expect(opened()).toHaveCount(0);
}

test("a link panel over a short thread takes the full height while open", async ({
  page,
  app,
}) => {
  await routePull(page);
  await open(page, app);
  const root = app.append("primary", "alpha", "Short root", true);
  app.append("primary", "alpha", `See ${pull}`, false, false, root.id);
  const sheet = await openThread(page, root);
  const thread = sheets(page).first();
  await expect(thread).not.toHaveAttribute("data-tall");
  const before = await thread.boundingBox();
  await sheet.locator(`a[href="${pull}"]`).click();
  const panel = sheet.locator("[data-details-sheet-surface]");
  await expect(panel).toContainText("A PR");
  await expect(thread).toHaveAttribute("data-tall", "true");
  await expect
    .poll(async () => (await thread.boundingBox()).height)
    .toBeGreaterThan(before.height + 200);
  await page.keyboard.press("Escape");
  await expect(panel).toHaveCount(0);
  await expect(thread).not.toHaveAttribute("data-tall");
  await expect
    .poll(async () =>
      Math.abs((await thread.boundingBox()).height - before.height),
    )
    .toBeLessThan(4);
});

test("details: Back, Forward, ✕, Forward", async ({ page, app }) => {
  await open(page, app);
  const details = app.append(
    "primary",
    "alpha",
    longDetails,
    false,
    false,
    undefined,
    undefined,
    [["audience", "details"]],
  );
  await row(page, details).getByRole("button", { name: "Show more" }).click();
  const reader = () => sheets(page).filter({ hasText: "The end." });
  await journey(page, {
    opened: reader,
    close: () =>
      reader().getByRole("button", { name: "Close details" }).click(),
  });
});

test("thread: Back, Forward, ✕, Forward", async ({ page, app }) => {
  await open(page, app);
  const root = app.append("primary", "alpha", "Thread root", true);
  app.append("primary", "alpha", "A reply", false, false, root.id);
  await openThread(page, root);
  const sheet = () => page.getByRole("dialog", { name: "Thread", exact: true });
  await journey(page, {
    opened: sheet,
    close: () => sheet().getByRole("button", { name: "Close thread" }).click(),
    reopened: () => expect(sheet()).toContainText("A reply"),
  });
});

test("link panel: Back, Forward, ✕, Forward", async ({ page, app }) => {
  await routePull(page);
  await open(page, app);
  app.append("primary", "alpha", pull);
  await page.locator(`[data-channel-timeline] a[href="${pull}"]`).click();
  await journey(page, {
    opened: () => sheets(page),
    close: () =>
      sheets(page).getByRole("button", { name: "Close", exact: true }).click(),
    reopened: () => expect(sheets(page)).toContainText("A PR"),
  });
});

test("diff: Back, Forward, ✕, Forward", async ({ page, app }) => {
  await open(page, app);
  app.append(
    "primary",
    "alpha",
    diff,
    false,
    false,
    undefined,
    undefined,
    [["file", "a.ts"]],
    undefined,
    40008,
  );
  await page
    .getByRole("region", { name: "Diff: a.ts" })
    .getByRole("button", { name: "Expand diff" })
    .click();
  await journey(page, {
    opened: () => sheets(page),
    close: () =>
      sheets(page).getByRole("button", { name: "Close diff" }).click(),
  });
});

test("details over an inline thread step back one at a time, and close with it", async ({
  page,
  app,
}) => {
  await open(page, app);
  const root = app.append("primary", "alpha", "Thread root", true);
  const details = app.append(
    "primary",
    "alpha",
    longDetails,
    false,
    false,
    root.id,
    undefined,
    [["audience", "details"]],
  );
  const sheet = await openThread(page, root);
  await sheet
    .locator(`[data-message-id="${details.id}"]`)
    .getByRole("button", { name: "Show more" })
    .click();
  const reader = () => sheet.locator("[data-details-sheet-surface]");
  await expect(reader()).toHaveCount(1);
  await back(page);
  await expect(reader()).toHaveCount(0);
  await expect(sheet).toBeVisible();
  await back(page);
  await expect(sheet).toHaveCount(0);
  await forward(page).click();
  await expect(sheet).toBeVisible();
  await expect(reader()).toHaveCount(0);
  await forward(page).click();
  await expect(reader()).toContainText("The end.");
  await sheet.getByRole("button", { name: "Close thread" }).click();
  await expect(sheet).toHaveCount(0);
  await expect(forward(page)).toBeDisabled();
});

test("Back, ✕ the thread, then Forward to the later details visit brings back nothing", async ({
  page,
  app,
}) => {
  await open(page, app);
  const root = app.append("primary", "alpha", "Thread root", true);
  const details = app.append(
    "primary",
    "alpha",
    longDetails,
    false,
    false,
    root.id,
    undefined,
    [["audience", "details"]],
  );
  const sheet = await openThread(page, root);
  await sheet
    .locator(`[data-message-id="${details.id}"]`)
    .getByRole("button", { name: "Show more" })
    .click();
  await expect(sheet.locator("[data-details-sheet-surface]")).toHaveCount(1);
  await back(page);
  await expect(sheet.locator("[data-details-sheet-surface]")).toHaveCount(0);
  await sheet.getByRole("button", { name: "Close thread" }).click();
  await expect(sheet).toHaveCount(0);
  // The details visit remains, as the conversation it was over.
  await forward(page).click();
  await expect(page.getByRole("button", { name: "Go back" })).toBeEnabled();
  await expect(sheets(page)).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});

test("a reader address opens its reader again after a reload", async ({
  page,
  app,
}) => {
  await open(page, app);
  const details = app.append(
    "primary",
    "alpha",
    longDetails,
    false,
    false,
    undefined,
    undefined,
    [["audience", "details"]],
  );
  await row(page, details).getByRole("button", { name: "Show more" }).click();
  await expect(sheets(page)).toHaveCount(1);
  await page.reload();
  await expect(sheets(page)).toContainText("The end.");
});

test("a reader address for a missing message fails as a missing message does", async ({
  page,
  app,
}) => {
  await open(page, app);
  const details = app.append(
    "primary",
    "alpha",
    longDetails,
    false,
    false,
    undefined,
    undefined,
    [["audience", "details"]],
  );
  await row(page, details).getByRole("button", { name: "Show more" }).click();
  await expect(sheets(page)).toHaveCount(1);
  await page.goto(page.url().replace(details.id, "e".repeat(64)));
  await page.reload();
  await expect(page.getByText("This message isn’t available.")).toBeVisible();
  await expect(sheets(page)).toHaveCount(0);
});

test("Forward to a diff whose reply box is gone opens its tab", async ({
  page,
  app,
}) => {
  await open(page, app);
  const root = app.append("primary", "alpha", "Thread root", true);
  app.append(
    "primary",
    "alpha",
    diff,
    false,
    false,
    root.id,
    undefined,
    [["file", "a.ts"]],
    undefined,
    40008,
  );
  const sheet = await openThread(page, root);
  await sheet
    .getByRole("region", { name: "Diff: a.ts" })
    .getByRole("button", { name: "Expand diff" })
    .click();
  const reader = () => sheet.locator("[data-details-sheet-surface]");
  await expect(reader()).toHaveCount(1);
  await back(page);
  await expect(reader()).toHaveCount(0);
  // The thread moves to its tab, which then closes: the reply box is gone.
  await sheet.getByRole("button", { name: "Open as tab", exact: true }).click();
  const tab = page.getByRole("tab", { name: /Thread root/ });
  await expect(tab).toBeVisible();
  await tab.click({ button: "middle" });
  await expect(tab).toHaveCount(0);
  await forward(page).click();
  await expect(page.getByRole("tab", { name: /a\.ts/ })).toBeVisible();
  await expect(sheets(page)).toHaveCount(0);
});
