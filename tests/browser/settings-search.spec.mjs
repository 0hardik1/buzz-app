import { test, expect } from "./fixture.mjs";
import {
  chooseColorMode,
  openSettings,
  settingsDialog,
  settingsSections,
} from "./navigation.mjs";

test.use({ historyCounts: { alpha: 0, beta: 0 } });

// Real dialog navigation, browser focus/scrolling, and responsive sidebar layout
// cannot be established by the search matcher or jsdom component tests.
test("settings search opens and focuses controls across themes, widths and enlarged text", async ({
  page,
  app,
}, info) => {
  await page.goto(app.origin);
  await openSettings(page);
  const dialog = settingsDialog(page);
  const search = dialog.getByRole("searchbox", { name: "Search settings" });
  for (const mode of ["Light", "Dark"]) {
    await settingsSections(page)
      .getByRole("button", { name: "Appearance", exact: true })
      .click();
    await chooseColorMode(page, mode);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await search.fill("thread");
      await search.press("Tab"); // Clear
      await page.keyboard.press("Tab"); // Result
      await expect(
        settingsSections(page).getByRole("button", {
          name: "Open threads in",
          exact: true,
        }),
      ).toBeFocused();
      await page.keyboard.press("Enter");
      const control = dialog.getByRole("combobox", {
        name: "Open threads in",
        exact: true,
      });
      await expect(control).toBeFocused();
      await expect(control).toBeInViewport();
      await search.fill("message width");
      await settingsSections(page)
        .getByRole("button", { name: /^Message width/ })
        .click();
      await expect(
        dialog.getByRole("combobox", { name: "Message width", exact: true }),
      ).toBeFocused();
      await expect(
        dialog.getByRole("combobox", { name: "Message width", exact: true }),
      ).toBeInViewport();
      await info.attach(`settings-search-${mode}-${width}`, {
        body: await page.screenshot(),
        contentType: "image/png",
      });
      await search.fill("no-such-preference");
      await expect(settingsSections(page).getByRole("status")).toHaveText(
        "No settings found. Try another search.",
      );
      await search.press("Escape");
      await expect(search).toHaveValue("");
      await expect(dialog).toBeVisible();
    }
  }
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "32px";
  });
  await search.fill("font size");
  const result = settingsSections(page).getByRole("button", {
    name: "Interface size",
    exact: true,
  });
  await expect(result).toBeVisible();
  await expect
    .poll(() =>
      settingsSections(page).evaluate(
        (nav) => nav.scrollWidth <= nav.clientWidth,
      ),
    )
    .toBe(true);
  await result.click();
  await expect(
    dialog.getByRole("button", { name: "Decrease interface size" }),
  ).toBeFocused();
});
