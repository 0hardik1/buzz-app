import { test, expect } from "./playwright-test.mjs";
import { previewFixtures } from "./vite-server.mjs";
import { watchPageErrors } from "./page-errors.mjs";
let fixtures;
test.beforeAll(async () => {
  fixtures = await previewFixtures([
    "tests/fixtures/github-inline-comments.html",
    "tests/fixtures/github-comment-affordance.html",
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
    page.getByRole("region", { name: "src/example.ts", exact: true }),
  ).toBeVisible();
}
async function select(page, name, value) {
  await page.getByRole("combobox", { name, exact: true }).click();
  await page.getByRole("option", { name: value, exact: true }).click();
}
async function line(page, value = "Old line 5000") {
  const file = page.getByRole("region", {
    name: "src/example.ts",
    exact: true,
  });
  await file.focus();
  for (let index = 0; index < (value === "New line 5001" ? 3 : 1); index++)
    await file.press("ArrowDown");
  await expect(file.getByRole("status")).toHaveText(value);
  await file.press("Enter");
  const field = page.getByRole("textbox", { name: "Comment", exact: true });
  await expect(field).toBeFocused();
  return field;
}
async function lineBlocked(page) {
  const file = page.getByRole("region", {
    name: "src/example.ts",
    exact: true,
  });
  await file.focus();
  await file.press("ArrowDown");
  await file.press("Enter");
  await expect(
    page.getByRole("textbox", { name: "Comment", exact: true }),
  ).toHaveCount(0);
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
    await page.evaluate(() => {
      const state = window.inlineFixture.state;
      state.files.push({ filename: "src/second.ts" });
      state.patch +=
        "diff --git a/src/second.ts b/src/second.ts\n--- a/src/second.ts\n+++ b/src/second.ts\n@@ -7 +7 @@\n-const before = false;\n+const after = true;\n";
    });
    await page.getByRole("button", { name: "Refresh changes" }).click();
    await expect(
      page.getByRole("region", { name: "src/second.ts", exact: true }),
    ).toBeVisible();
    if (layout === "Split") await select(page, "Diff layout", "Split");
    await expect(
      page.locator('diffs-container pre[data-indicators="bars"]').first(),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "aaaaaaa", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByText(/Posting as|Read with your gh sign-in/),
    ).toHaveCount(0);
    const file = page.getByRole("region", {
      name: "src/example.ts",
      exact: true,
    });
    await file.focus();
    for (let index = 0; index < 4; index++) await file.press("ArrowDown");
    await expect(file.getByRole("status")).toHaveText(
      "Context: Old line 5001 or New line 5002. Press Enter to choose a side.",
    );
    await file.press("Escape");
    await expect(file.getByRole("status")).toBeEmpty();
    const field = await line(page);
    await field.fill("Synthetic inline feedback");
    await field.press("Escape");
    await expect(
      page.getByRole("region", { name: "src/example.ts", exact: true }),
    ).toBeFocused();
    await expect(file.getByRole("status")).toBeEmpty();
    await line(page);
    await field.fill("Discard when leaving Changes");
    const originalOperation = await field.evaluate(
      (node) => node.form.dataset.operation,
    );
    const original = page.locator(
      `form[data-operation="${originalOperation}"]`,
    );
    const otherFile = page.getByRole("region", {
      name: "src/second.ts",
      exact: true,
    });
    await otherFile
      .locator('[data-column-number="7"][data-line-type="change-addition"]')
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await otherFile
      .getByRole("textbox", { name: "Comment", exact: true })
      .fill("Independent second comment");
    await expect(original.getByRole("textbox")).toHaveValue(
      "Discard when leaving Changes",
    );
    await page
      .locator(
        'diffs-container [data-column-number="5000"][data-line-type="change-deletion"]',
      )
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(original.getByRole("textbox")).toBeFocused();
    await expect(
      page.getByRole("textbox", { name: "Comment", exact: true }),
    ).toHaveCount(2);
    await otherFile
      .getByRole("button", { name: "Cancel", exact: true })
      .click();
    await expect(original.getByRole("textbox")).toHaveValue(
      "Discard when leaving Changes",
    );
    await page
      .locator("diffs-container")
      .first()
      .evaluate((node) => {
        window.savedDiffNode = node;
      });
    const readsBeforeTab = await page.evaluate(
      () => window.inlineFixture.state.calls.length,
    );
    await page.getByRole("tab", { name: "Summary", exact: true }).click();
    await page.getByRole("tab", { name: /^Changes/ }).click();
    expect(
      await page
        .locator("diffs-container")
        .first()
        .evaluate((node) => window.savedDiffNode === node),
    ).toBe(true);
    expect(
      await page.evaluate(() => window.inlineFixture.state.calls.length),
    ).toBe(readsBeforeTab);
    await expect(page.locator("diffs-container pre").first()).toHaveAttribute(
      "data-diff-type",
      layout === "Split" ? "split" : "single",
    );
    await expect(field).toHaveCount(0);
    await page
      .locator(
        'diffs-container [data-column-number="5001"][data-line-type="change-addition"]',
      )
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(field).toHaveValue("");
    await field.fill("Synthetic inline feedback");
    await expect(field.locator("..")).not.toContainText("src/example.ts");
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
    await page
      .locator(
        'diffs-container [data-column-number="5001"][data-line-type="change-addition"]',
      )
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(field).toBeFocused();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Refresh changes" }).hover();
    await expect(
      page.getByRole("button", { name: "Comment on hovered line" }),
    ).toHaveCount(0);
    await page
      .locator(
        'diffs-container [data-column-number="5000"][data-line-type="change-deletion"]',
      )
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(field).toBeFocused();
    await field.press("Escape");
    const second = page.getByRole("region", {
      name: "src/second.ts",
      exact: true,
    });
    await second
      .locator('[data-column-number="7"][data-line-type="change-addition"]')
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(
      second.getByRole("textbox", { name: "Comment", exact: true }),
    ).toBeFocused();
    await field.press("Escape");
    await expect(second).toBeFocused();
    await second.press("ArrowDown");
    await second.press("Enter");
    await expect(
      second.getByRole("textbox", { name: "Comment", exact: true }),
    ).toBeFocused();
    await field.press("Escape");
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
  test(`rejects stale ${field} and opens a fresh composer after reselection`, async ({
    page,
  }) => {
    await open(page);
    const input = await line(page);
    await input.fill("Unsent stale comment");
    await page.getByRole("button", { name: `Advance ${field}` }).click();
    await page.getByRole("button", { name: "Post to GitHub" }).click();
    await expect(input).toHaveCount(0);
    expect(await posts(page)).toBe(0);
    await line(page, "New line 5001");
    await expect(input).toHaveValue("");
    await expect(
      page.getByRole("button", { name: "Post to GitHub" }),
    ).toBeDisabled();
  });
}
for (const [mode, message] of [
  ["denied", "Resource not accessible"],
  ["validation", "Invalid diff line"],
]) {
  test(`keeps text in the open composer on ${mode}`, async ({ page }) => {
    await open(page);
    await page.evaluate(() => {
      window.inlineFixture.state.merged = true;
    });
    await page.getByRole("button", { name: "Refresh changes" }).click();
    await expect(
      page.getByRole("region", { name: "src/example.ts", exact: true }),
    ).toBeVisible();
    await select(page, "Stub scenario", mode);
    const input = await line(page);
    await input.fill("Refused comment");
    await page.getByRole("button", { name: "Post to GitHub" }).click();
    await expect(page.getByRole("alert")).toHaveText(message);
    await expect(input).toHaveValue("Refused comment");
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
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
  await lineBlocked(page);
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
  await expect(page.getByRole("textbox", { name: "Comment" })).toHaveCount(0);
  await page
    .getByRole("button", { name: "Old line 5001", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Comment", exact: true })
    .fill("Context side");
  await page.getByRole("button", { name: "Post to GitHub" }).click();
  await expect(page.getByText("Context side", { exact: true })).toBeVisible();
  expect(
    await page.evaluate(() => window.inlineFixture.state.comments[0]),
  ).toMatchObject({ side: "LEFT", line: 5001 });
});
test("refresh into raw fallback discards composer and removes posting authority", async ({
  page,
}) => {
  await open(page);
  const input = await line(page);
  await input.fill("Unsent before fallback");
  await page.getByRole("button", { name: "Show raw patch" }).click();
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(page.getByRole("region", { name: "Raw diff" })).toBeVisible();
  await expect(input).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "src/example.ts", exact: true }),
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
test("failed snapshot refresh discards composer and invalidates posting authority", async ({
  page,
}) => {
  await open(page);
  const input = await line(page);
  await input.fill("Unsent before refresh failure");
  await page.getByRole("button", { name: "Toggle snapshot failure" }).click();
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Synthetic snapshot refresh failed",
  );
  await expect(input).toHaveCount(0);
  expect(await posts(page)).toBe(0);
  await page.getByRole("button", { name: "Advance head" }).click();
  await page.getByRole("button", { name: "Toggle snapshot failure" }).click();
  await page.getByRole("button", { name: "Refresh changes" }).click();
  await expect(
    page.getByRole("region", { name: "src/example.ts", exact: true }),
  ).toBeVisible();
  await expect(input).toHaveCount(0);
  await line(page, "New line 5001");
  await expect(input).toHaveValue("");
  await expect(
    page.getByRole("button", { name: "Post to GitHub" }),
  ).toBeDisabled();
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

// Native gutter placement and inertness on expanded rows require Pierre's shadow DOM.
test("gutter and keyboard share verified patch coordinates across layouts", async ({
  page,
}) => {
  await page.goto(
    `${fixtures.origin}/tests/fixtures/github-comment-affordance.html`,
  );
  const file = page.getByRole("region", {
    name: "src/example.ts",
    exact: true,
  });
  for (const layout of ["single", "split"]) {
    if (layout === "split")
      await page.getByRole("button", { name: "Toggle layout" }).click();
    await expect(file.locator("pre")).toHaveAttribute("data-diff-type", layout);
    const outside = file
      .locator('[data-column-number="4999"][data-line-type="context"]')
      .last();
    await outside.hover();
    await expect(
      page.getByRole("button", { name: "Comment on hovered line" }),
    ).toHaveCount(0);
    await file
      .locator('[data-column-number="5001"][data-line-type="change-addition"]')
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(page.getByLabel("Selected coordinates")).toHaveText(
      '[{"side":"additions","lineNumber":5001}]',
    );
    await outside.hover();
    await expect(
      page.getByRole("button", { name: "Comment on hovered line" }),
    ).toHaveCount(0);
    await file
      .locator('[data-column-number="5002"][data-line-type="context"]')
      .last()
      .hover();
    await page.getByRole("button", { name: "Comment on hovered line" }).click();
    await expect(page.getByLabel("Selected coordinates")).toHaveText(
      '[{"side":"deletions","lineNumber":5001},{"side":"additions","lineNumber":5002}]',
    );
    await file.focus();
    await file.press("ArrowDown");
    await expect(file.getByRole("status")).toHaveText("Old line 5000");
    await file.press("Escape");
  }
});

test("preloads diff and threads from Summary without tab-triggered reads", async ({
  page,
}) => {
  await page.goto(
    `${fixtures.origin}/tests/fixtures/github-inline-comments.html?summary`,
  );
  await expect(
    page.getByRole("tab", { name: "Summary", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
  await expect
    .poll(() =>
      page.evaluate(() =>
        window.inlineFixture.state.calls.some(
          (call) =>
            call.id === "graphql" &&
            String(call.input.query).includes("reviewThreads(first:100"),
        ),
      ),
    )
    .toBe(true);
  await expect(page.locator("diffs-container")).toHaveCount(1);
  await expect(page.locator("diffs-container")).toBeHidden();
  const reads = await page.evaluate(
    () => window.inlineFixture.state.calls.length,
  );
  await page.getByRole("tab", { name: /^Changes/ }).click();
  await expect(
    page.getByRole("region", { name: "src/example.ts", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => window.inlineFixture.state.calls.length),
  ).toBe(reads);
});
