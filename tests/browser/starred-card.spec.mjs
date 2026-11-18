import { test, expect } from "./fixture.mjs";
import { openPage } from "./navigation.mjs";

test.use({ productionBroker: true, savedSidebar: true });

// Grid hit targets, keyboard focus after placement, and dragging an avatar tile
// through the real sidebar require browser layout; preference policy stays in Vitest.
test("Starred avatar tiles retain navigation, menus and movement", async ({
  page,
  app,
}, testInfo) => {
  await page.goto(app.origin);
  await openPage(page, "Messages");
  const stars = page.locator('[data-sidebar-section="starred"]');
  const beta = page.locator(
    '[data-sidebar-section="group:work"] [data-channel-id="beta"]',
  );
  await beta.focus();
  await page.keyboard.press("Shift+F10");
  await page
    .getByRole("menuitem", { name: "Move channel", exact: true })
    .focus();
  await page.keyboard.press("ArrowRight");
  const saved = page.waitForResponse(
    (response) => response.url().endsWith("/sidebar-star") && response.ok(),
  );
  await page
    .getByRole("menuitemradio", { name: "Starred", exact: true })
    .click();
  await saved;
  const tile = stars.locator('[data-channel-id="beta"]');
  const alpha = stars.locator('[data-channel-id="alpha"]');
  await expect(tile).toBeFocused();
  await expect(tile).toHaveAttribute("data-variant", "avatar");
  const first = await alpha.boundingBox();
  const second = await tile.boundingBox();
  expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
  expect(Math.abs(second.y - first.y)).toBeLessThan(1);
  await tile.press("Enter");
  await expect(tile).toHaveAttribute("aria-current", "page");
  await stars.screenshot({ path: testInfo.outputPath("starred-light.png") });
  await page.evaluate(() =>
    document.documentElement.setAttribute("data-color-mode", "dark"),
  );
  await stars.screenshot({ path: testInfo.outputPath("starred-dark.png") });
  await tile.focus();
  await page.keyboard.press("Shift+F10");
  await expect(
    page.getByRole("menuitem", { name: "Move channel", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await tile.hover();
  const from = await tile.boundingBox();
  const target = page.locator('[data-sidebar-section="group:work"]');
  const to = await target.boundingBox();
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
  await page.mouse.down();
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, {
    steps: 8,
  });
  await expect(target).toHaveAttribute("data-drop-target");
  const unstarred = page.waitForResponse(
    (response) => response.url().endsWith("/sidebar-star") && response.ok(),
  );
  await page.mouse.up();
  await unstarred;
  await expect(beta).toBeFocused();
  await expect(tile).toHaveCount(0);
  await page.reload();
  await expect(beta).toBeVisible();
  await expect(alpha).toBeVisible();
});
