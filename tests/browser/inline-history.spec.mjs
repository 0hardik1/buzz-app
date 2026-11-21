import { hoverMessage } from "./message-actions.mjs";
import { test, expect } from "./fixture.mjs";
import { open, virtuaIdle } from "./timeline.mjs";

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

// The card shows the raw patch until its highlighter loads, then the
// narrower highlighted diff: Expand moves with it, and a press that starts
// before the swap can end beside the button.
async function expandDiff(card) {
  await expect(card.locator("diffs-container pre").first()).toBeVisible();
  await card.getByRole("button", { name: "Expand diff" }).click();
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
  await expandDiff(page.getByRole("region", { name: "Diff: a.ts" }));
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

test("Back from details, then ✕ the thread, leaves no Forward to the details", async ({
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
  // The details stacked on the thread closed with it, so their visit is
  // retired: Forward has no empty step to land on.
  await expect(forward(page)).toBeDisabled();
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

test("Open as tab closes what stacked on the thread, so Forward reaches none of it", async ({
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
  // A press lands only once the thread's rows stop moving under it.
  await virtuaIdle(
    page,
    sheet.getByRole("region", { name: "Thread messages", exact: true }),
  );
  await expandDiff(sheet.getByRole("region", { name: "Diff: a.ts" }));
  const reader = () => sheet.locator("[data-details-sheet-surface]");
  await expect(reader()).toHaveCount(1);
  await back(page);
  await expect(reader()).toHaveCount(0);
  await sheet.getByRole("button", { name: "Open as tab", exact: true }).click();
  await expect(page.getByRole("tab", { name: /Thread root/ })).toBeVisible();
  await expect(sheets(page)).toHaveCount(0);
  await expect(forward(page)).toBeDisabled();
});

// Bug 3 of #1666's review: a diff moved to its tab takes its visits along,
// and closing the tab retires them.
test("closing a diff's tab retires the visits it had inline", async ({
  page,
  app,
}) => {
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
  await expandDiff(page.getByRole("region", { name: "Diff: a.ts" }));
  await expect(sheets(page)).toHaveCount(1);
  await sheets(page)
    .getByRole("button", { name: "Open as tab", exact: true })
    .click();
  const tab = page.getByRole("tab", { name: /a\.ts/ });
  await expect(tab).toBeVisible();
  await expect(sheets(page)).toHaveCount(0);
  await tab.click({ button: "middle" });
  await expect(tab).toHaveCount(0);
  await expect
    .poll(async () => (await hashTarget(page)).detail)
    .toBeUndefined();
  // No step leads back to the diff, inline or in a tab.
  await expect(forward(page)).toBeDisabled();
  await back(page);
  await expect(sheets(page)).toHaveCount(0);
  await expect(tab).toHaveCount(0);
  expect((await hashTarget(page)).detail).toBeUndefined();
});

const channel = (page, name) =>
  page
    .getByRole("link", { name, exact: true })
    .or(page.getByRole("button", { name, exact: true }));
const hashTarget = (page) =>
  page.evaluate(() =>
    JSON.parse(
      decodeURIComponent(location.hash.slice(1)).replace(/^buzz=/, ""),
    ),
  );
// A visit within the same document, as an in-app link makes.
const visitWithin = (page, target) =>
  page.evaluate((target) => {
    location.hash = `buzz=${encodeURIComponent(JSON.stringify(target))}`;
  }, target);

// The production broker carries channel metadata live, as an archive does.
test.describe("an archive meanwhile", () => {
  test.use({ productionBroker: true });

  test("Back to details over a thread tab of a channel archived meanwhile opens them", async ({
    page,
    app,
  }) => {
    await open(page, app);
    const root = app.append("primary", "alpha", "Thread root", true);
    app.append(
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
      .getByRole("button", { name: "Open as tab", exact: true })
      .click();
    await expect(page.getByRole("tab", { name: /Thread root/ })).toBeVisible();
    // The sheet leaves as its tab opens a thread of its own.
    await expect(sheets(page)).toHaveCount(0);
    const thread = page.getByRole("complementary", {
      name: "Thread",
      exact: true,
    });
    await threadIdle(page, thread);
    await thread.getByRole("button", { name: "Show more" }).click();
    const reader = () => sheets(page).filter({ hasText: "The end." });
    await expect(reader()).toHaveCount(1);
    await channel(page, "Beta").first().click();
    await expect(
      page.getByRole("textbox", { name: "Message #Beta" }),
    ).toBeVisible();
    app.archiveChannel("alpha");
    await back(page);
    // Its tab has no reply box now, so the details read in a dialog, which
    // is modal and hides the tab from the accessibility tree.
    await expect(
      page.getByRole("tab", { name: /Thread root/, includeHidden: true }),
    ).toBeVisible();
    await expect(
      page
        .getByRole("complementary", {
          name: "Thread",
          exact: true,
          includeHidden: true,
        })
        .getByText("This channel is archived", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("dialog").filter({ hasText: "The end." }),
    ).toBeVisible();
  });
});

test.describe("a send", () => {
  test.use({ sendChannels: ["alpha"] });

  test("that closes details retires their visit, as ✕ does", async ({
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
    await channel(page, "Beta").first().click();
    await expect(
      page.getByRole("textbox", { name: "Message #Beta" }),
    ).toBeVisible();
    await channel(page, "Alpha").first().click();
    const composer = page.getByRole("textbox", { name: "Message #Alpha" });
    await expect(composer).toBeVisible();
    await row(page, details).getByRole("button", { name: "Show more" }).click();
    await expect(sheets(page)).toHaveCount(1);
    await composer.click();
    await composer.pressSequentially("Thanks");
    await composer.press("Enter");
    await expect(sheets(page)).toHaveCount(0);
    // Back steps past the closed reader, straight to Beta.
    await back(page);
    await expect(
      page.getByRole("textbox", { name: "Message #Beta" }),
    ).toBeVisible();
    await forward(page).click();
    await expect(composer).toBeVisible();
    await expect(forward(page)).toBeDisabled();
    expect((await hashTarget(page)).reader).toBeUndefined();
    await page.reload();
    await expect(composer).toBeVisible();
    await expect(row(page, details)).toBeVisible();
    await expect(sheets(page)).toHaveCount(0);
  });
});

test("a visit to a missing reader address within the page closes the open reader", async ({
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
  const target = await hashTarget(page);
  await visitWithin(page, {
    ...target,
    reader: { ...target.reader, messageId: "e".repeat(64) },
  });
  await expect(page.getByText("This message isn’t available.")).toBeVisible();
  await expect(sheets(page)).toHaveCount(0);
});

test("a visit to another message within the page closes the open reader", async ({
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
  const other = app.append("primary", "alpha", "Another message", false);
  await row(page, details).getByRole("button", { name: "Show more" }).click();
  await expect(sheets(page)).toHaveCount(1);
  const { reader, ...conversation } = await hashTarget(page);
  expect(reader).toBeDefined();
  await visitWithin(page, { ...conversation, messageId: other.id });
  await expect(row(page, other)).toBeVisible();
  await expect(sheets(page)).toHaveCount(0);
  // Back returns to the reader's visit, which shows it again.
  await back(page);
  await expect(sheets(page)).toContainText("The end.");
});

// A press on a row lands only once the rows around it stop moving.
const threadIdle = (page, thread) =>
  virtuaIdle(
    page,
    thread.getByRole("region", { name: "Thread messages", exact: true }),
  );
// A thread of another channel, opened as a tab beside this one from its link.
async function openOtherChannelTab(page, app, reply) {
  const root = app.append("primary", "beta", "Beta root", false, false);
  const inner = reply(root);
  const link = app.append(
    "primary",
    "alpha",
    `See <buzz://message?channel=beta&id=${inner.id}&thread=${root.id}>`,
    false,
  );
  await row(page, link).getByRole("link").first().click({ button: "right" });
  await page.getByRole("menuitem", { name: "Open link" }).click();
  const thread = page.getByRole("complementary", {
    name: "Thread",
    exact: true,
  });
  await expect(thread.locator(`[data-message-id="${inner.id}"]`)).toBeVisible();
  await threadIdle(page, thread);
  return { thread, inner, link };
}
// A modal dialog hides what is beneath it from the accessibility tree.
async function staysOnAlpha(page) {
  await expect(
    page.getByRole("textbox", { name: "Message #Alpha", includeHidden: true }),
  ).toBeVisible();
  // Named for its root once Beta's messages have loaded.
  await expect(
    page.getByRole("tab", {
      name: /^(Thread · Beta|Beta root)$/,
      includeHidden: true,
    }),
  ).toBeVisible();
  expect((await hashTarget(page)).channelId).toBe("alpha");
}

// Nothing reads on a sheet over another channel's tab.
test("details over another channel's thread tab read in a dialog and keep the selected channel", async ({
  page,
  app,
}) => {
  await open(page, app);
  const { thread } = await openOtherChannelTab(page, app, (root) =>
    app.append(
      "primary",
      "beta",
      longDetails,
      false,
      false,
      root.id,
      undefined,
      [["audience", "details"]],
    ),
  );
  await thread.getByRole("button", { name: "Show more" }).click();
  const reader = () => page.getByRole("dialog").filter({ hasText: "The end." });
  await expect(reader()).toBeVisible();
  await expect(sheets(page)).toHaveCount(0);
  await staysOnAlpha(page);
  // The dialog is modal, so Back and Forward come from the browser.
  await page.goBack();
  await expect(reader()).toHaveCount(0);
  await staysOnAlpha(page);
  await page.goForward();
  await expect(reader()).toBeVisible();
  await staysOnAlpha(page);
  await reader().getByRole("button", { name: "Close details" }).click();
  await expect(reader()).toHaveCount(0);
  await expect(forward(page)).toBeDisabled();
});
