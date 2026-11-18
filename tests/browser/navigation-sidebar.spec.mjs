import {
  channelRow,
  conversationList,
  openCommunityPicker,
  openPage,
  pageChoice,
  rail,
  selectCommunity,
  showRailCards,
} from "./navigation.mjs";
import { checkDurationConsumer } from "./duration-layout.mjs";
import { showChannels } from "./rail-helpers.mjs";
import { test, expect } from "./fixture.mjs";
import { open } from "./timeline.mjs";
import { createServer } from "./vite-server.mjs";
import { animationsSettled } from "./animations.mjs";
const button = (page, name) => page.getByRole("button", { name, exact: true });
test.use({
  enabledPlugins: ["buzz.workflows"],
  largeSidebar: true,
  historyCounts: { alpha: 1, beta: 1 },
});

// Selection motion and cancellation during window resize need real CSS layout
// and animation timelines, which a DOM emulator cannot exercise.
test("segmented selections slide but window resizing follows the selected tab immediately", async ({
  page,
}) => {
  const server = await createServer({
    configFile: false,
    envFile: false,
    logLevel: "error",
    server: { host: "127.0.0.1", port: 0, open: false },
  });
  try {
    await server.listen();
    await page.goto(
      `http://127.0.0.1:${server.httpServer.address().port}/tests/fixtures/design-system.html#/design/components/tabs`,
    );
    for (const label of [
      "Segmented filters",
      "Small segmented filters",
      "Icon segmented filters",
    ]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      const list = page.getByRole("tablist", { name: label, exact: true });
      await list.getByRole("tab").first().click();
      await animationsSettled(list.locator(".buzz-tabs-indicator"));
      const capture = await list.evaluateHandle((list) => {
        const indicator = list.querySelector(".buzz-tabs-indicator");
        if (!indicator) throw new Error("Missing segmented indicator");
        const start = indicator.getBoundingClientRect().left;
        const state = {
          progress: undefined,
          resizeError: undefined,
        };
        let targetWidth;
        const observer = new MutationObserver(() => {
          const selected = list
            .querySelector('[aria-selected="true"]')
            ?.getBoundingClientRect();
          if (!selected) throw new Error("Missing selected tab");
          if (state.progress === undefined) {
            const animation = indicator
              .getAnimations()
              .find(
                (animation) =>
                  animation instanceof CSSTransition &&
                  animation.transitionProperty === "transform",
              );
            if (!animation?.effect || selected.left === start) return;
            // Hold an actual intermediate frame, independent of runner speed.
            animation.pause();
            animation.currentTime =
              Number(animation.effect.getTiming().duration) / 2;
            state.progress =
              (indicator.getBoundingClientRect().left - start) /
              (selected.left - start);
            targetWidth = selected.width;
          } else if (Math.abs(selected.width - targetWidth) > 1) {
            const pill = indicator.getBoundingClientRect();
            state.resizeError = Math.max(
              Math.abs(pill.left - selected.left),
              Math.abs(pill.right - selected.right),
            );
          }
        });
        observer.observe(indicator, {
          attributes: true,
          attributeFilter: ["style"],
        });
        return {
          state,
          dispose() {
            observer.disconnect();
            indicator.getAnimations().forEach((animation) => {
              animation.finish();
            });
          },
        };
      });
      try {
        await list.getByRole("tab").last().click();
        await expect
          .poll(() => capture.evaluate(({ state }) => state.progress))
          .toBeDefined();
        const progress = await capture.evaluate(({ state }) => state.progress);
        expect(
          progress,
          `${label} travels from its previous selection`,
        ).toBeGreaterThan(0);
        expect(
          progress,
          `${label} has not jumped to its destination`,
        ).toBeLessThan(1);
        // Window resizing must also cancel a slide already in progress.
        await page.setViewportSize({ width: 640, height: 900 });
        await expect
          .poll(() => capture.evaluate(({ state }) => state.resizeError))
          .toBeDefined();
        expect(
          await capture.evaluate(({ state }) => state.resizeError),
          label,
        ).toBeLessThan(1);
      } finally {
        await capture.evaluate(({ dispose }) => dispose());
        await capture.dispose();
      }
    }
  } finally {
    await server.close();
  }
});

// Channel creation needs a connection that can write 9007.
const creationSidebar = test.extend({ channelWriteKinds: [9, 9007, 30315] });
creationSidebar(
  "the Create menu opens the shared channel creation dialog",
  async ({ page, app }, testInfo) => {
    await page.goto(app.origin);
    await showChannels(page);
    await showRailCards(page);
    const create = rail(page).getByRole("button", {
      name: "Create",
      exact: true,
    });
    await create.click();
    await page
      .getByRole("menu", { name: "New", exact: true })
      .getByRole("menuitem", { name: /^New channel/ })
      .click();

    const dialog = page.getByRole("dialog", { name: "Create a channel" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Name" })).toBeFocused();
    await dialog.getByRole("radio", { name: /Temporary/ }).click();
    await checkDurationConsumer(page, dialog, "create-duration", testInfo);
    await expect(
      dialog.getByRole("radio", { name: /Temporary/ }),
    ).toBeChecked();
    await dialog
      .getByRole("button", { name: "Close channel creation" })
      .click();
    await page
      .getByRole("dialog", { name: "Discard changes?" })
      .getByRole("button", { name: "Discard changes" })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(create).toBeFocused();
  },
);

test("hovering a list row marks only that row, not its siblings", async ({
  page,
  app,
}) => {
  await page.goto(app.origin);
  await showChannels(page);
  // Buzzin' light is where hover differs most from resting navigation.
  await page.evaluate(() => {
    document.documentElement.dataset.colorMode = "light";
    document.documentElement.dataset.colorLevel = "high";
  });
  const row = channelRow(page, "beta");
  const sibling = channelRow(page, "alpha");
  const paint = (element) =>
    element.evaluate((element) => {
      const style = getComputedStyle(element);
      return { background: style.backgroundColor, color: style.color };
    });
  // Rows transition into the new level's colors; settle before hovering.
  await expect(row).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
  const rest = await paint(row);
  const siblingRest = await paint(sibling);
  await row.hover();
  await expect
    .poll(async () => (await paint(row)).background)
    .not.toBe(rest.background);
  expect(await paint(sibling)).toEqual(siblingRest);
});

test("channel navigation preserves the list's DOM", async ({ page, app }) => {
  await open(page, app);
  const list = conversationList(page);
  const node = await list.elementHandle();
  await channelRow(page, "beta").click();
  await expect(
    page.getByRole("textbox", { name: "Message #Beta", exact: true }),
  ).toBeVisible();
  expect(await node.evaluate((element) => element.isConnected)).toBe(true);
  await button(page, "Go back").click();
  await expect(
    page.getByRole("textbox", { name: "Message #Alpha", exact: true }),
  ).toBeVisible();
  expect(await node.evaluate((element) => element.isConnected)).toBe(true);
  await button(page, "Go forward").click();
  await expect(
    page.getByRole("textbox", { name: "Message #Beta", exact: true }),
  ).toBeVisible();
  expect(await node.evaluate((element) => element.isConnected)).toBe(true);
});

test("community picker stays available across pages and restores focus after joining", async ({
  page,
  app,
}) => {
  await open(page, app);
  await showRailCards(page);
  const rail = page.getByRole("navigation", {
    name: "Apps",
    exact: true,
  });
  await expect(
    rail.getByRole("button", {
      name: "Community switcher: Primary",
      exact: true,
    }),
  ).toBeVisible();
  await selectCommunity(page, "Secondary");
  await openPage(page, "Workflows");
  await expect(rail).toBeVisible();
  await expect(
    page.getByRole("dialog", { name: "Switch community", exact: true }),
  ).toHaveCount(0);
  await selectCommunity(page, "Personal space");
  await (await openCommunityPicker(page))
    .getByRole("button", { name: "Join a community", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Join a community", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    rail.getByRole("button", {
      name: "Community switcher: Personal space",
      exact: true,
    }),
  ).toBeFocused();
});

test("rail loads relay-owned image icons for inactive communities without acquiring sessions", async ({
  page,
  app,
}) => {
  const rasterIcon =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y79d4sAAAAASUVORK5CYII=";
  const emojiSvg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512"><rect width="512" height="512" rx="112" fill="#ffe75c"/><text x="50%" y="56%" dominant-baseline="middle" text-anchor="middle" font-size="258">🐝</text></svg>';
  const emojiIcon = `data:image/svg+xml,${encodeURIComponent(emojiSvg)}`;
  const infoRequests = [];
  await page.route("**/api/relay/*/icon-info", (route) => {
    infoRequests.push(route.request().url());
    const icon = route.request().url().includes("primary")
      ? rasterIcon
      : emojiIcon;
    return route.fulfill({ json: { icon } });
  });
  // The inactive community's background unread session is held: its icon
  // must load without it.
  const background = Promise.withResolvers();
  await page.route("**/api/relay/secondary/session", async (route) => {
    await background.promise;
    await route.fallback().catch(() => {});
  });
  await open(page, app);
  const rail = await openCommunityPicker(page);
  for (const [name, icon] of [
    ["Primary", rasterIcon],
    ["Secondary", emojiIcon],
  ]) {
    const image = rail
      .getByRole("button", { name: `Switch to ${name}` })
      .locator("img");
    await expect(image).toHaveAttribute("src", icon);
    await expect(image).toHaveAttribute("data-loaded", "true");
  }
  expect(infoRequests).toHaveLength(2);
  expect(app.report.sessions).toEqual(["primary"]);
  background.resolve();
  await expect
    .poll(() => app.report.sessions)
    .toEqual(["primary", "secondary"]);
});

// Team's page choice opens its list in place; keyboard page search focuses main.
test("Team from page search shows its list and focuses main", async ({
  page,
  app,
}) => {
  await open(page, app);
  await channelRow(page, "beta").click();
  const composer = page.getByRole("textbox", {
    name: "Message #Beta",
    exact: true,
  });
  await expect(composer).toBeVisible();
  await button(page, "Search Buzz").focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "Search Buzz", exact: true });
  const search = dialog.getByRole("combobox", { name: "Search Buzz" });
  await expect(search).toBeFocused();
  await search.pressSequentially("Team");
  await expect(pageChoice(dialog, "Team")).toHaveAttribute(
    "data-highlighted",
    "true",
  );
  await search.press("Enter");
  await expect(channelRow(page, "beta")).toBeVisible();
  await expect(page.locator("#main-content")).toBeFocused();
});
