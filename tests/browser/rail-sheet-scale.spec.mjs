import { test, expect } from "./fixture.mjs";

test.use({ largeSidebar: true, historyCounts: { alpha: 3, beta: 2 } });

// Real viewport measurement, focus retention and native scrolling need a browser.
test("large card sheets bound mounted rows and retain focus while reaching every item", async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  const rail = page.getByRole("navigation", { name: "Apps", exact: true });
  await rail.getByRole("button", { name: "Team", exact: true }).click();
  const sheet = rail.locator("[data-rail-card-sheet]");
  const list = sheet.getByRole("list", { name: "Conversations", exact: true });
  const rows = list.getByRole("listitem");
  await expect(rows.first()).toHaveAttribute("aria-setsize", "130");
  await expect.poll(() => rows.count()).toBeLessThan(40);
  const first = rows.first();
  const firstId = await first.getAttribute("data-activity-row");
  const retained = list
    .locator(`[data-activity-row="${firstId}"]`)
    .getByRole("button")
    .first();
  await retained.focus();
  const scrollToEnd = () =>
    list.evaluate((node) => {
      let scroll = node.parentElement;
      while (scroll && !/auto|scroll/.test(getComputedStyle(scroll).overflowY))
        scroll = scroll.parentElement;
      if (!scroll) throw new Error("No collection scrollport");
      scroll.scrollTop = scroll.scrollHeight;
    });
  await scrollToEnd();
  const last = list.locator('[aria-posinset="130"]');
  await expect(last).toBeInViewport();
  await expect(retained).toBeFocused();
  await retained.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Pin", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(sheet).toBeVisible();
  await expect(retained).toBeFocused();
  await scrollToEnd();
  await expect(last).toBeInViewport();
  const destination = await last.getAttribute("data-activity-row");
  await last.getByRole("button").first().click();
  await expect
    .poll(
      () =>
        JSON.parse(decodeURIComponent(new URL(page.url()).hash.slice(6)))
          .channelId,
    )
    .toBe(destination);
  await expect(sheet).toBeVisible();
  await expect.poll(() => rows.count()).toBeLessThan(40);
  await sheet
    .getByRole("button", { name: "Close expanded card" })
    .press("Escape");
  await expect(sheet).toHaveCount(0);
  await expect(
    rail.getByRole("button", { name: "Team", exact: true }),
  ).toBeFocused();
});
