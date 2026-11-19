import { test, expect } from "./playwright-test.mjs";
import { previewFixtures } from "./vite-server.mjs";
import { watchPageErrors } from "./page-errors.mjs";
let fixtures;
test.beforeAll(async () => {
  fixtures = await previewFixtures([
    "tests/fixtures/github-inline-comments.html",
  ]);
});
test.afterAll(() => fixtures?.close());
async function open(page) {
  await page.route("https://api.github.com/**", () => {
    throw new Error("Fixture attempted live GitHub access");
  });
  await page.goto(
    `${fixtures.origin}/tests/fixtures/github-inline-comments.html`,
  );
  await expect(page.getByText("STUB MODE — no GitHub requests")).toBeVisible();
  await expect(
    page.getByRole("combobox", { name: "Comment location in src/example.ts" }),
  ).toBeVisible();
}
async function select(page, name, value) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function line(page, value = "Old line 5000") {
  await select(page, "Comment location in src/example.ts", value);
  const trigger = page.getByRole("button", {
    name: "Comment on line",
    exact: true,
  });
  await trigger.focus();
  await trigger.press("Enter");
  const field = page.getByRole("textbox", { name: "GitHub comment" });
  await expect(field).toBeFocused();
  return field;
}
const posts = (page) =>
  page.evaluate(
    () =>
      window.inlineFixture.state.calls.filter((call) => call.args[0] === "POST")
        .length,
  );
for (const layout of ["Unified", "Split"]) {
  test(`real PR panel posts and replies through stub transport in ${layout}`, async ({
    page,
  }, testInfo) => {
    const errors = watchPageErrors(page);
    await open(page);
    if (layout === "Split") await select(page, "Diff layout", "Split");
    const field = await line(page);
    await field.fill("Synthetic inline feedback");
    await field.press("Escape");
    await expect(
      page.getByRole("button", { name: "Comment on line", exact: true }),
    ).toBeFocused();
    await page
      .locator(
        'diffs-container [data-column-number="5001"][data-line-type="change-addition"]',
      )
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(field).toHaveValue("Synthetic inline feedback");
    await expect(
      page.getByText(/src\/example.ts · New line 5001/),
    ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`inline-${layout}-light.png`),
    });
    await page.getByRole("button", { name: "Post to GitHub" }).click();
    await expect(
      page.getByText("Synthetic inline feedback", { exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => window.inlineFixture.state.comments[0]),
    ).toMatchObject({
      user: { login: "example-reviewer" },
      path: "src/example.ts",
      side: "RIGHT",
      line: 5001,
      commit_id: "a".repeat(40),
    });
    await page.getByRole("button", { name: "Reply", exact: true }).click();
    await field.fill("Synthetic reply");
    await page.getByRole("button", { name: "Post to GitHub" }).click();
    await expect(
      page.getByText("Synthetic reply", { exact: true }),
    ).toBeVisible();
    expect(await posts(page)).toBe(2);
    await page.evaluate(() => {
      document.documentElement.dataset.colorMode = "dark";
    });
    await page.screenshot({
      animations: "disabled",
      path: testInfo.outputPath(`inline-${layout}-dark.png`),
    });
    await page.reload();
    await expect(
      page.getByText("Synthetic inline feedback", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Synthetic reply", { exact: true }),
    ).toBeVisible();
    expect(errors.unexplained()).toEqual([]);
  });
}
for (const field of ["head", "base"]) {
  test(`preserves stale ${field} draft and requires reselection`, async ({
    page,
  }) => {
    await open(page);
    const input = await line(page);
    await input.fill("Retain stale draft");
    await page.getByRole("button", { name: `Advance ${field}` }).click();
    await page.getByRole("button", { name: "Post to GitHub" }).click();
    await expect(input).toHaveValue("Retain stale draft");
    await expect(
      page.getByRole("button", { name: "Post to GitHub" }),
    ).toBeDisabled();
    expect(await posts(page)).toBe(0);
    await line(page, "New line 5001");
    await expect(input).toHaveValue("Retain stale draft");
    await expect(
      page.getByRole("button", { name: "Post to GitHub" }),
    ).toBeEnabled();
  });
}
for (const [mode, message] of [
  ["denied", "Resource not accessible"],
  ["validation", "Invalid diff line"],
]) {
  test(`retains draft on ${mode}`, async ({ page }) => {
    await open(page);
    await select(page, "Stub scenario", mode);
    const input = await line(page);
    await input.fill("Retain refused draft");
    await page.getByRole("button", { name: "Post to GitHub" }).click();
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(input).toHaveValue("Retain refused draft");
    expect(await posts(page)).toBe(1);
    expect(
      await page.evaluate(() => window.inlineFixture.state.comments.length),
    ).toBe(0);
  });
}
test("reconciles timeout-after-success across panel remount without reposting", async ({
  page,
}, testInfo) => {
  await open(page);
  await select(page, "Stub scenario", "timeout");
  const input = await line(page);
  await input.fill("Uncertain delivery");
  await page.getByRole("button", { name: "Post to GitHub" }).click();
  await expect(
    page.getByRole("button", { name: "Check delivery" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Remount panel" }).click();
  await expect(
    page.getByRole("textbox", { name: "GitHub comment" }),
  ).toHaveValue("Uncertain delivery");
  await expect(
    page.getByRole("button", { name: "Post to GitHub" }),
  ).toBeDisabled();
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("unknown-delivery.png"),
  });
  await page.getByRole("button", { name: "Check delivery" }).click();
  await expect(
    page.getByText("Uncertain delivery", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check delivery" }),
  ).toHaveCount(0);
  expect(await posts(page)).toBe(1);
});
test("keeps sent separate from refresh failure", async ({ page }) => {
  await open(page);
  await select(page, "Stub scenario", "refresh-failed");
  const input = await line(page);
  await input.fill("Sent once");
  await page.getByRole("button", { name: "Post to GitHub" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Comment sent. Refresh failed",
  );
  await expect(input).toHaveCount(0);
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(page.getByText("Sent once", { exact: true })).toBeVisible();
  expect(await posts(page)).toBe(1);
});
test("holds dispatch while duplicate submission gestures produce one POST", async ({
  page,
}) => {
  await open(page);
  await select(page, "Stub scenario", "hold");
  const input = await line(page);
  await input.fill("Only once");
  await input.evaluate((node) => {
    node.form.requestSubmit();
    node.form.requestSubmit();
  });
  await expect.poll(() => posts(page)).toBe(1);
  await expect(
    page.getByRole("button", { name: "Post to GitHub" }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Release held POST" }).click();
  await expect(page.getByText("Only once", { exact: true })).toBeVisible();
  expect(await posts(page)).toBe(1);
});
test("context hover requires an explicit old/new choice", async ({ page }) => {
  await open(page);
  await page
    .locator(
      'diffs-container [data-column-number="5002"][data-line-type="context"]',
    )
    .hover();
  await page.getByRole("button", { name: "Comment on hovered line" }).click();
  await expect(
    page.getByRole("textbox", { name: "GitHub comment" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Old line 5001", exact: true })
    .click();
  await expect(page.getByText(/src\/example.ts · Old line 5001/)).toBeVisible();
});
test("raw fallback retains draft and removes posting authority", async ({
  page,
}) => {
  await open(page);
  const input = await line(page);
  await input.fill("Preserved through fallback");
  await page.getByRole("button", { name: "Show raw patch" }).click();
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(page.getByRole("region", { name: "Raw diff" })).toBeVisible();
  await expect(input).toHaveValue("Preserved through fallback");
  await expect(
    page.getByRole("button", { name: "Post to GitHub" }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Comment on line", exact: true }),
  ).toHaveCount(0);
  expect(await posts(page)).toBe(0);
});
test("narrow enlarged-text panel keeps composer controls reachable", async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 480, height: 900 });
  await open(page);
  const input = await line(page);
  await input.fill("Narrow layout");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "200%";
  });
  const send = page.getByRole("button", { name: "Post to GitHub" });
  await send.scrollIntoViewIfNeeded();
  await expect(send).toBeVisible();
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("inline-narrow-large-light.png"),
  });
  await page.evaluate(() => {
    document.documentElement.dataset.colorMode = "dark";
  });
  await page.screenshot({
    animations: "disabled",
    path: testInfo.outputPath("inline-narrow-large-dark.png"),
  });
});
test("failed snapshot refresh preserves text and invalidates posting authority", async ({
  page,
}) => {
  await open(page);
  const input = await line(page);
  await input.fill("Keep after read failure");
  await page.getByRole("button", { name: "Toggle snapshot failure" }).click();
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic snapshot refresh failed",
  );
  await expect(input).toHaveValue("Keep after read failure");
  await expect(
    page.getByRole("button", { name: "Post to GitHub" }),
  ).toBeDisabled();
  expect(await posts(page)).toBe(0);
  await page.getByRole("button", { name: "Advance head" }).click();
  await page.getByRole("button", { name: "Toggle snapshot failure" }).click();
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(
    page.getByRole("combobox", { name: "Comment location in src/example.ts" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Post to GitHub" }),
  ).toBeDisabled();
  await line(page, "New line 5001");
  await expect(input).toHaveValue("Keep after read failure");
  await expect(
    page.getByRole("button", { name: "Post to GitHub" }),
  ).toBeEnabled();
});
test("checks unknown delivery even after snapshot refresh fails", async ({
  page,
}) => {
  await open(page);
  await select(page, "Stub scenario", "timeout");
  const input = await line(page);
  await input.fill("Check independently of diff");
  await page.getByRole("button", { name: "Post to GitHub" }).click();
  await expect(
    page.getByRole("button", { name: "Check delivery" }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Toggle snapshot failure" }).click();
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(
    page.getByText("Synthetic snapshot refresh failed", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Check delivery" }).click();
  await expect(
    page.getByRole("link", { name: "View on GitHub" }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Check delivery" }),
  ).toHaveCount(0);
  expect(await posts(page)).toBe(1);
});
