import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

test.use({ historyCounts: { alpha: 20, beta: 1 }, tallMessages: true });

// Real scroll geometry and backdrop painting cannot be checked in jsdom.
test("message top material appears only over scrolled history", async ({
  page,
  app,
}, info) => {
  await open(page, app);
  await page.evaluate(() => document.fonts.ready);
  const history = page.getByRole("region", { name: "Channel message history" });
  const material = history.locator("..").locator('[data-edge="top"]');
  for (const mode of ["light", "dark"]) {
    await page.evaluate((mode) => {
      localStorage.setItem("buzz-appearance.v1", mode);
      window.dispatchEvent(
        new StorageEvent("storage", {
          key: "buzz-appearance.v1",
          storageArea: localStorage,
        }),
      );
    }, mode);
    await expect(page.locator("html")).toHaveAttribute("data-color-mode", mode);
    await history.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await expect(material).toBeVisible();
    await expect(material).toHaveCSS("pointer-events", "none");
    await page.screenshot({ path: info.outputPath(`messages-${mode}.png`) });
    await history.evaluate((element) => {
      element.scrollTop = 0;
    });
    await expect(material).toBeHidden();
  }
  const composer = page.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await composer.fill("Keep typing after scrolling");
  await expect(composer).toBeFocused();
  await expect(composer).toHaveText("Keep typing after scrolling");
});
