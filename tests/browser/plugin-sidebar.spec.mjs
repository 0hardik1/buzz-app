import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";

test.use({ historyCounts: { alpha: 20, beta: 1 } });

// Exercises real page routing and the retained sidebar together, beyond the shell fixture.
test("opening a plugin retains the Messages sidebar and return path", async ({
  page,
  app,
}, info) => {
  await open(page, app);
  const sidebar = page.getByRole("complementary", {
    name: "Sidebar",
    exact: true,
  });
  const retained = await sidebar.elementHandle();
  const plugins = sidebar.getByRole("navigation", {
    name: "Plugins",
    exact: true,
  });
  await expect(
    plugins.getByRole("button", { name: "Switch app: Messages" }),
  ).toBeVisible();
  const composer = page.getByRole("textbox", {
    name: "Message #Alpha",
    exact: true,
  });
  await composer.fill("Keep this draft while using a plugin");
  await plugins.getByRole("button", { name: "Switch app: Messages" }).click();
  await expect(page.getByRole("menu", { name: "Apps" })).toBeVisible();
  await expect(page.getByRole("menu", { name: "Apps" })).toHaveCSS(
    "opacity",
    "1",
  );
  await page.screenshot({ path: info.outputPath("app-switcher-open.png") });
  await page.getByRole("menuitem", { name: "Agents", exact: true }).click();
  await expect(
    page.getByRole("region", { name: "Agents", exact: true }),
  ).toBeVisible();
  expect(await retained.evaluate((node) => node.isConnected)).toBe(true);
  await expect(
    plugins.getByRole("button", { name: "Switch app: Agents" }),
  ).toBeVisible();
  await plugins.getByRole("button", { name: "Switch app: Agents" }).click();
  await page.getByRole("menuitem", { name: "Messages", exact: true }).click();
  await expect(
    sidebar.getByRole("navigation", { name: "Subscribed channels" }),
  ).toBeVisible();
  await sidebar.locator('button[data-channel-id="alpha"]').click();
  await expect(composer).toBeVisible();
  await expect(composer).toHaveText("Keep this draft while using a plugin");
});
