import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

const alpha = "11111111-1111-4111-8111-111111111111";
const beta = "22222222-2222-4222-8222-222222222222";

test.use({
  enabledPlugins: ["buzz.tasks"],
  savedCommunities: ["primary"],
  channelIds: [alpha, beta],
  channelNames: { [alpha]: "Alpha", [beta]: "Beta" },
  historyCounts: { [alpha]: 1, [beta]: 1 },
  channelWriteKinds: [9, 30315, 45010],
  artifactSync: true,
});

// Real shell routing, plugin registration, artifact writer, IndexedDB and
// shared dialog geometry. The unit/browser DOM suites cover relay conflicts.
test("creates and updates Task v2 records in a contained responsive table", async ({
  page,
  app,
}, info) => {
  await page.goto(app.origin);
  await open(page, app);
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  const workspace = page.getByRole("region", { name: "Tasks", exact: true });
  await expect(workspace).toBeVisible();
  await expect(
    workspace.getByRole("heading", { name: "No tasks yet" }),
  ).toBeVisible();

  await workspace
    .getByRole("button", { name: "New task", exact: true })
    .first()
    .click();
  const create = page.getByRole("dialog", { name: "New task", exact: true });
  await create
    .getByLabel("Title", { exact: true })
    .fill("Verify offline handoff");
  await create
    .getByLabel("Why", { exact: true })
    .fill(
      "A later agent needs enough context to finish without asking for the original request again.",
    );
  await create
    .getByLabel("Done when", { exact: true })
    .fill("The saved task and its evidence appear after a fresh read.");
  await create
    .getByLabel(/Links/)
    .fill("https://github.com/block/buzz-app/issues/42");
  await create
    .getByLabel(/First note/)
    .fill("Captured from the handoff thread.");
  await create
    .getByRole("button", { name: "Create task", exact: true })
    .click();
  await expect(create).toHaveCount(0);
  await expect(
    workspace.getByRole("button", { name: "Verify offline handoff" }),
  ).toBeVisible();
  await expect(workspace.getByRole("table")).toContainText(
    "Captured from the handoff thread.",
  );

  // Keyboard opens the same record and edits its state/evidence.
  const title = workspace.getByRole("button", {
    name: "Verify offline handoff",
  });
  await title.focus();
  await page.keyboard.press("Enter");
  const edit = page.getByRole("dialog", { name: "Edit task", exact: true });
  await expect(
    edit.getByRole("heading", { name: "Log", exact: true }),
  ).toBeVisible();
  await edit.getByRole("combobox", { name: "State", exact: true }).click();
  await page.getByRole("option", { name: "Waiting", exact: true }).click();
  await edit
    .getByLabel("Update note", { exact: true })
    .fill(
      "Saved the waiting state and PR evidence; reloading for verification.",
    );
  await edit.getByRole("button", { name: "Save update", exact: true }).click();
  await expect(edit).toHaveCount(0);
  await expect(workspace.getByRole("table")).toContainText(
    "Saved the waiting state and PR evidence",
  );
  await expect(workspace.getByRole("table")).toContainText("Waiting");

  // A reload discards the local save overlay. On hosts without incremental
  // artifact sync, the table must restore the signed current relay revision.
  await page.reload();
  await open(page, app);
  await page.getByRole("tab", { name: "Tasks", exact: true }).click();
  await expect(
    workspace.getByRole("button", { name: "Verify offline handoff" }),
  ).toBeVisible();
  await expect(workspace.getByRole("table")).toContainText("Waiting");
  await expect(workspace.getByRole("table")).toContainText(
    "Saved the waiting state and PR evidence",
  );

  for (const width of [390, 800, 1280]) {
    for (const theme of ["light", "dark"]) {
      await page.setViewportSize({ width, height: 900 });
      await page.evaluate((mode) => {
        document.documentElement.classList.toggle("dark", mode === "dark");
      }, theme);
      await expect(workspace.getByRole("table")).toBeVisible();
      await page.evaluate(() => document.fonts.ready);
      const geometry = await workspace.evaluate((root) => ({
        overflow: root.getBoundingClientRect().right - innerWidth,
        tableLeft: root.querySelector("table").getBoundingClientRect().left,
        viewportLeft: root.getBoundingClientRect().left,
      }));
      expect(geometry.overflow).toBeLessThanOrEqual(0);
      expect(geometry.tableLeft).toBeGreaterThanOrEqual(geometry.viewportLeft);
      await page.screenshot({
        path: info.outputPath(`tasks-${width}-${theme}.png`),
        fullPage: true,
      });
    }
  }

  // Search keyboard input reaches the no-match recovery action.
  const search = workspace.getByRole("searchbox", { name: "Search tasks" });
  await search.fill("not-present");
  await expect(
    workspace.getByRole("heading", { name: "No matching tasks" }),
  ).toBeVisible();
  await workspace
    .getByRole("button", { name: "Clear filters", exact: true })
    .click();
  await expect(
    workspace.getByRole("button", { name: "Verify offline handoff" }),
  ).toBeVisible();
});
