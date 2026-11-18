import { showCollectionView } from "./navigation.mjs";
import { expect, test } from "./fixture.mjs";
import { channelRow } from "./navigation.mjs";
import {
  addToNewSection,
  openSectionMenu,
  railSection,
} from "./rail-helpers.mjs";

test.use({
  productionBroker: true,
  dmLabels: true,
  dmMembers: { "dm-move": [0] },
  historyCounts: { alpha: 1, beta: 1 },
  viewport: { width: 1280, height: 720 },
  video: "on",
});

// The browser boundary here is real menu focus/portal interaction plus the
// rail's saved layout across a full page reload. Component tests cover the
// placement state transitions without app startup.
test("a DM's row menu keeps it in a section and restores it there after reload", async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  await showCollectionView(page, "dms");
  const dm = channelRow(page, "dm-move");
  await expect(dm).toBeVisible();
  const menu = await openSectionMenu(page, dm);
  await expect(menu).toHaveAccessibleName(/Alice Fixture/);
  await page.screenshot({ path: test.info().outputPath("dm-move-menu.png") });
  await page.keyboard.press("Escape");
  await page.keyboard.press("Escape");

  await addToNewSection(page, dm, "Work");
  const work = railSection(page, "Work");
  const placed = work.locator('[data-rail-row="channel:dm-move"]');
  await expect(placed).toBeVisible();
  // A conversation stays in Team: the section holds it as well.
  await expect(dm).toBeVisible();

  await page.reload();
  await expect(placed).toBeVisible();

  await placed.getByRole("button").first().focus();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Remove from section", exact: true })
    .click();
  await expect(placed).toHaveCount(0);

  await page.reload();
  await expect(work).toBeVisible();
  await expect(placed).toHaveCount(0);
});

// Hold a real pointer drag over a section header; the caller releases it.
async function pull(page, row, section) {
  await row.hover();
  const from = await row.boundingBox();
  const destination = page.locator(
    `[data-sidebar-section="${section}"] summary`,
  );
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  const to = await destination.boundingBox();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  // Crossing the creation gap can expand it and shift this header.
  await destination.scrollIntoViewIfNeeded();
  const current = await destination.boundingBox();
  await page.mouse.move(
    current.x + current.width / 2,
    current.y + current.height / 2,
  );
}

test("dragging a DM files it in a section and back, and Channels and Direct messages refuse each other's rows", async ({
  page,
  app,
}) => {
  await open(page, app);
  const dm = (section) =>
    page.locator(
      `[data-sidebar-section="${section}"] [data-channel-id="dm-move"]`,
    );
  const dropTarget = (section) =>
    page.locator(`[data-sidebar-section="${section}"][data-drop-target]`);
  const assignmentSaved = () =>
    page.waitForResponse((response) =>
      new URL(response.url()).pathname.endsWith("/sidebar-assignment"),
    );
  await expect(dm("dms")).toBeVisible();

  await pull(page, dm("dms"), "channels");
  await expect(page.locator("[data-channel-dragging]")).toBeVisible();
  await expect(page.locator("[data-drop-target]")).toHaveCount(0);
  await page.mouse.up();
  await expect(dm("dms")).toBeVisible();
  expect(app.report.sidebarPublications ?? []).toHaveLength(0);

  const filed = assignmentSaved();
  await pull(page, dm("dms"), "group:work");
  await expect(dropTarget("group:work")).toBeVisible();
  await page.mouse.up();
  expect((await filed).ok()).toBe(true);
  await expect(dm("group:work")).toBeFocused();
  await expect(dm("dms")).toHaveCount(0);
  await expect.poll(() => app.report.sidebarPublications?.length ?? 0).toBe(1);
  expect(app.report.sidebarPublications[0].blob.assignments).toEqual({
    beta: "work",
    "dm-move": "work",
  });

  await page.reload();
  await expect(dm("group:work")).toBeVisible();
  await expect(
    page.getByRole("complementary", { name: "Sidebar", exact: true }),
  ).not.toHaveAttribute("aria-busy");

  const beta = page.locator(
    '[data-sidebar-section="group:work"] [data-channel-id="beta"]',
  );
  await pull(page, beta, "dms");
  await expect(page.locator("[data-channel-dragging]")).toBeVisible();
  await expect(page.locator("[data-drop-target]")).toHaveCount(0);
  await page.mouse.up();
  await expect(beta).toBeVisible();

  const returned = assignmentSaved();
  await pull(page, dm("group:work"), "dms");
  await expect(dropTarget("dms")).toBeVisible();
  await page.mouse.up();
  expect((await returned).ok()).toBe(true);
  await expect(dm("dms")).toBeFocused();
  await expect(dm("group:work")).toHaveCount(0);
  await expect.poll(() => app.report.sidebarPublications?.length ?? 0).toBe(2);
  expect(app.report.sidebarPublications.at(-1).blob.assignments).toEqual({
    beta: "work",
  });
});
