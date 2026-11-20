import { test, expect } from "./fixture.mjs";
import { openPage } from "./navigation.mjs";
import { join } from "node:path";
import { fixtureRelayUrl } from "../relay-config.ts";

test.use({
  productionBroker: true,
  savedSidebar: true,
  channelIds: ["alpha", "beta", "gamma", "delta"],
  channelNames: {
    alpha: "General",
    beta: "Planning",
    gamma: "Design",
    delta: "Archive",
  },
  historyCounts: { alpha: 1, beta: 1, gamma: 1, delta: 1 },
});

// A card's view options popover holds its filter, sort and layout. Its button
// names the card and says when the card is filtered.
const viewOptionsButton = (scope, title) =>
  scope.getByRole("button", {
    name: new RegExp(`^View options for ${title}(, filtered)?$`),
  });
const viewOptions = async (page, title, scope = page) => {
  const button = viewOptionsButton(scope, title);
  // An unfiltered card reveals the button with its heading's other actions.
  await button.focus();
  await button.click();
  const popup = page.getByRole("dialog", {
    name: `View options for ${title}`,
    exact: true,
  });
  await expect(popup).toBeVisible();
  return popup;
};
const show = async (page, title, name, scope = page) => {
  const popup = await viewOptions(page, title, scope);
  await popup.getByRole("radio", { name, exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
};

// Browser-only contract: popover choices, save recovery and the real broker's
// encrypted preference readback must agree after a document reload.
test("section filters save activity windows from the view options popover", async ({
  page,
  app,
}, testInfo) => {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, age] of [
    ["alpha", 60],
    ["beta", 2],
    ["gamma", 0],
    ["delta", 45],
  ]) {
    app.histories.set(`primary/${id}`, [
      app.sign({
        kind: 9,
        tags: [["h", id]],
        content: "Project update",
        created_at: now - age * 86400,
      }),
    ]);
  }
  await page.goto(app.origin);
  await openPage(page, "Messages");
  // Filters preserve the current channel; choose a different destination from
  // the row whose exclusion this journey exercises, regardless of startup order.
  await page
    // A row leaving its startup section stays mounted without a name.
    .getByRole("navigation", { name: "Subscribed channels" })
    .getByRole("button", { name: "General", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message #General" }),
  ).toBeVisible();
  const section = page.locator('[data-sidebar-section="channels"]');
  await expect(section.locator('[data-channel-id="gamma"]')).toBeVisible();
  const shot = async (name) => {
    if (
      !process.env.BUZZ_FILTER_CAPTURE_DIR ||
      testInfo.project.name !== "chromium"
    )
      return;
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: join(process.env.BUZZ_FILTER_CAPTURE_DIR, `${name}.png`),
    });
  };
  const trigger = viewOptionsButton(page, "Team");
  const checked = (popup, name) =>
    expect(popup.getByRole("radio", { name, exact: true })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  await shot("01-all");
  let popup = await viewOptions(page, "Team");
  await checked(popup, "All");
  await expect(trigger).toHaveAttribute("data-icon-variant", "ghost");
  await shot("02-view-options");
  await popup.getByRole("radio", { name: "Unreads", exact: true }).click();
  await expect
    .poll(() => app.report.sidebarPublications?.at(-1)?.blob.groups.channels)
    .toBe("unreads");
  await checked(popup, "Unreads");
  // A filtered card's button fills with the accent and says so.
  await expect(trigger).toHaveAccessibleName("View options for Team, filtered");
  await expect(trigger).toHaveAttribute("data-icon-variant", "accent");
  await shot("03-unreads");
  // Activity windows are picked in place; there is no dialog step.
  await popup.getByRole("radio", { name: "7 days", exact: true }).click();
  await expect
    .poll(
      () =>
        app.report.sidebarPublications.at(-1)?.blob.activeWindowSeconds
          ?.channels,
    )
    .toBe(7 * 86400);
  await checked(popup, "7 days");
  await expect(section.locator('[data-channel-id="gamma"]')).toBeVisible();
  await expect(section.locator('[data-channel-id="delta"]')).toHaveCount(0);
  await shot("04-seven-days");
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await page.mouse.move(0, 0);
  await page.locator("body").focus();
  // Without hover or focus, the filled button stays in view.
  await expect(trigger).toBeVisible();
  await shot("05-filtered-button");
  await page.reload();
  await expect(section.locator('[data-channel-id="gamma"]')).toBeVisible();
  await expect(section.locator('[data-channel-id="delta"]')).toHaveCount(0);
  popup = await viewOptions(page, "Team");
  await checked(popup, "7 days");
  // A failed save offers Retry, which goes through the broker.
  const pattern = "**/sidebar-filter";
  await page.route(pattern, (route) => {
    app.report.sidebarPreferenceFailures ??= [];
    app.report.sidebarPreferenceFailures.push(route.request().url());
    return route.fulfill({
      status: 502,
      contentType: "application/json",
      body: JSON.stringify({ error: "Filter could not be saved. Try again." }),
    });
  });
  await popup.getByRole("radio", { name: "30 days", exact: true }).click();
  const retry = page.getByRole("button", { name: "Retry filter", exact: true });
  await expect(retry).toBeVisible();
  await page.keyboard.press("Escape");
  await shot("06-save-error");
  await page.unroute(pattern);
  await retry.click();
  await expect(retry).toHaveCount(0);
  await expect
    .poll(
      () =>
        app.report.sidebarPublications.at(-1)?.blob.activeWindowSeconds
          ?.channels,
    )
    .toBe(30 * 86400);
  // 30 days is Team's default, so its button no longer reads as filtered.
  await expect(trigger).toHaveAccessibleName("View options for Team");
  popup = await viewOptions(page, "Team");
  await checked(popup, "30 days");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("07-view-options-dark");
  await page.keyboard.press("Escape");
  await show(page, "Work", "Today");
  const work = page.locator('[data-sidebar-section="group:work"]');
  await expect(work.locator("[data-channel-id]")).toHaveCount(0);
  await expect(work.locator("details")).toHaveAttribute("open");
  await expect(page.getByText("0 matches", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText("No channels match this filter.", { exact: true }),
  ).toHaveCount(0);
  await shot("08-empty-header-dark");
  await page.emulateMedia({ colorScheme: "light" });
  await page.setViewportSize({ width: 800, height: 850 });
  popup = await viewOptions(page, "Team");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "150%";
  });
  await shot("09-narrow-enlarged-text");
  await page.evaluate(() => {
    document.documentElement.style.fontSize = "";
  });
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 1440, height: 950 });
  await page.getByLabel("Work", { exact: true }).click();
  await expect(work.locator("details")).not.toHaveAttribute("open");
  await shot("10-collapsed-empty");
  await page.route("**/session", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      json: { ...(await response.json()), sidebarFilterWrites: false },
    });
  });
  await page.reload();
  popup = await viewOptions(page, "Work");
  await expect(
    popup.getByRole("radio", { name: "All", exact: true }),
  ).toBeDisabled();
  await expect(
    popup.getByRole("radio", { name: "Today", exact: true }),
  ).toBeDisabled();
  await checked(popup, "Today");
  await shot("11-read-only");
});

test("failed activity reads explain the filter and recover on Retry", async ({
  page,
  app,
}, testInfo) => {
  app.histories.set("primary/delta", [
    app.sign({
      kind: 9,
      tags: [["h", "delta"]],
      content: "Old update",
      created_at: Math.floor(Date.now() / 1000) - 60 * 86400,
    }),
  ]);
  const unknown = page.locator(
    '[data-sidebar-section="channels"] [data-channel-id="delta"]',
  );
  app.histories.set("primary/gamma", [
    app.sign({
      kind: 9,
      tags: [["h", "gamma"]],
      content: "Project update",
      created_at: Math.floor(Date.now() / 1000),
    }),
  ]);
  await page.addInitScript(() =>
    localStorage.setItem("buzz-appearance.v1", "dark"),
  );
  let release;
  let started;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const requested = new Promise((resolve) => {
    started = resolve;
  });
  const pattern = "**/channel-activity";
  await page.route(pattern, async (route) => {
    started();
    await gate;
    app.report.sidebarActivityFailures ??= [];
    app.report.sidebarActivityFailures.push(route.request().url());
    // A denial: a transient failure would retry quietly first.
    await route.fulfill({
      status: 403,
      contentType: "application/json",
      body: JSON.stringify({ error: "Activity unavailable" }),
    });
  });
  await page.goto(app.origin);
  await openPage(page, "Messages");
  // Filters preserve the current channel; choose a different destination from
  // the row whose exclusion this journey exercises, regardless of startup order.
  await page
    // A row leaving its startup section stays mounted without a name.
    .getByRole("navigation", { name: "Subscribed channels" })
    .getByRole("button", { name: "General", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message #General" }),
  ).toBeVisible();
  const popup = await viewOptions(page, "Team");
  try {
    await popup.getByRole("radio", { name: "30 days", exact: true }).click();
    await requested;
    await expect(unknown).toBeVisible();
  } finally {
    release();
  }
  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Activity filters and Recent sorting may be out of date.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(unknown).toBeVisible();
  if (
    process.env.BUZZ_FILTER_CAPTURE_DIR &&
    testInfo.project.name === "chromium"
  ) {
    await page.evaluate(async () => {
      await Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      );
    });
    await page.screenshot({
      path: join(
        process.env.BUZZ_FILTER_CAPTURE_DIR,
        "15-activity-read-error.png",
      ),
    });
  }
  await page.unroute(pattern);
  await page.getByRole("button", { name: "Retry", exact: true }).click();
  await expect(
    page.locator('[data-sidebar-section="channels"] [data-channel-id="gamma"]'),
  ).toBeVisible();
  await expect(
    page.getByText("Activity filters and Recent sorting may be out of date.", {
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(unknown).toHaveCount(0);
});

test.describe("filter action focus", () => {
  test.use({ readState: true });
  // Native focus handoff after a menu action unmounts its trigger is browser-owned.
  test("filtered-out row actions return focus to the owning section", async ({
    page,
    app,
  }) => {
    // Without a saved selection, startup opens whichever channel loads first,
    // which can be Archive. A short focused dwell there marks it read, and the
    // Unreads filter then hides the row this journey needs.
    await page.addInitScript(
      ({ viewer, relay }) =>
        localStorage.setItem(
          `buzz-view.v1:${JSON.stringify([`${relay}:${viewer}`, "selected-channel"])}`,
          JSON.stringify("alpha"),
        ),
      { viewer: app.viewer, relay: fixtureRelayUrl },
    );
    await page.goto(app.origin);
    await openPage(page, "Messages");
    // Filters preserve the current channel; keep it away from the row whose
    // exclusion this journey exercises.
    await page
      // A row leaving its startup section stays mounted without a name.
      .getByRole("navigation", { name: "Subscribed channels" })
      .getByRole("button", { name: "General", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Message #General" }),
    ).toBeVisible();
    const channels = page.locator('[data-sidebar-section="channels"]');
    const work = page.locator('[data-sidebar-section="group:work"]');
    const row = channels.locator('[data-channel-id="delta"]');
    const filter = (section, title, name) => show(page, title, name, section);
    await expect(row).toBeVisible();
    // Unreads keeps only rows with observed unread history; wait for it first.
    await expect(row.getByRole("img", { name: /unread/ })).toBeVisible();
    await filter(channels, "Team", "Unreads");
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    await page
      .getByRole("menuitem", { name: "Mark as read", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await expect(channels.locator("details > summary")).toBeFocused();
    await filter(work, "Work", "Unreads");
    await filter(channels, "Team", "All");
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Move to…", exact: true }).hover();
    await page
      .getByRole("menuitemradio", { name: "Work", exact: true })
      .click();
    await expect(row).toHaveCount(0);
    await expect(work.locator('[data-channel-id="delta"]')).toHaveCount(0);
    await expect(work.locator("details > summary")).toBeFocused();
  });
});

test.describe("with no saved Team filter", () => {
  test.use({ showAllCards: [] });

  // Choosing All after a failed choice retires it: Retry must not bring the
  // failed choice back, and All needs no relay write when none is saved.
  test("All after a failed Unreads save leaves nothing to retry", async ({
    page,
    app,
  }) => {
    await page.goto(app.origin);
    await openPage(page, "Messages");
    const choose = (name) => show(page, "Team", name);
    const pattern = "**/sidebar-filter";
    await page.route(pattern, (route) => {
      app.report.sidebarPreferenceFailures ??= [];
      app.report.sidebarPreferenceFailures.push(route.request().url());
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Filter could not be saved." }),
      });
    });
    await choose("Unreads");
    const retry = page.getByRole("button", {
      name: "Retry filter",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await page.unroute(pattern);
    const published = app.report.sidebarPublications?.length ?? 0;
    await choose("All");
    await expect(retry).toHaveCount(0);
    const popup = await viewOptions(page, "Team");
    await expect(
      popup.getByRole("radio", { name: "All", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
    expect(app.report.sidebarPublications?.length ?? 0).toBe(published);
  });
});

test.describe("with a saved workspace filter", () => {
  test.use({ showAllCards: [] });

  // Menus name a workspace card group:x while Retry names its saved key
  // section:x. A retried All must still be remembered for the card itself.
  test("a retried All on a workspace card survives readback", async ({
    page,
    app,
  }) => {
    const choose = (name) => show(page, "Work", name);
    const filterSaves = () =>
      (app.report.sidebarPublications ?? []).filter(({ blob }) =>
        JSON.stringify(blob).includes("section:work"),
      ).length;
    await page.goto(app.origin);
    await openPage(page, "Messages");
    await choose("Unreads");
    await expect.poll(filterSaves).toBe(1);

    const pattern = "**/sidebar-filter";
    await page.route(pattern, (route) => {
      app.report.sidebarPreferenceFailures ??= [];
      app.report.sidebarPreferenceFailures.push(route.request().url());
      return route.fulfill({
        status: 502,
        contentType: "application/json",
        body: JSON.stringify({ error: "Filter could not be saved." }),
      });
    });
    await choose("All");
    const retry = page.getByRole("button", {
      name: "Retry filter",
      exact: true,
    });
    await expect(retry).toBeVisible();
    await page.unroute(pattern);
    const published = app.report.sidebarPublications.length;
    await retry.click();
    await expect(retry).toHaveCount(0);
    await expect
      .poll(() => app.report.sidebarPublications.length)
      .toBeGreaterThan(published);

    // The device remembers All under the card's own key, never the saved one.
    const remembered = () =>
      page.evaluate(() =>
        Object.keys(localStorage)
          .filter((key) => key.includes('"sidebar:filter-all"'))
          .flatMap((key) => Object.keys(JSON.parse(localStorage[key]))),
      );
    await expect.poll(remembered).toEqual(["group:work"]);

    await page.reload();
    await openPage(page, "Messages");
    const popup = await viewOptions(page, "Work");
    await expect(
      popup.getByRole("radio", { name: "All", exact: true }),
    ).toHaveAttribute("aria-checked", "true");
  });
});

// See all keeps the card's filter behind the same view options button, so
// what's selected always matches the list; choosing there changes the card too.
test("See all shares the card's view options and filter", async ({
  page,
  app,
}, testInfo) => {
  const now = Math.floor(Date.now() / 1000);
  for (const [id, age] of [
    ["alpha", 60],
    ["beta", 2],
    ["gamma", 0],
    ["delta", 45],
  ])
    app.histories.set(`primary/${id}`, [
      app.sign({
        kind: 9,
        tags: [["h", id]],
        content: "Project update",
        created_at: now - age * 86400,
      }),
    ]);
  await page.goto(app.origin);
  await openPage(page, "Messages");
  const section = page.locator('[data-sidebar-section="channels"]');
  const rowFor = (id) => section.locator(`[data-channel-id="${id}"]`);
  await expect(rowFor("delta")).toBeVisible();
  // Filters keep the open conversation; open one the filter keeps anyway.
  await page
    .getByRole("navigation", { name: "Subscribed channels" })
    .getByRole("button", { name: "Design", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message #Design" }),
  ).toBeVisible();
  const settle = () =>
    page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter(
            (animation) =>
              animation.effect?.getComputedTiming().iterations !== Infinity,
          )
          .map((animation) => animation.finished.catch(() => {})),
      ),
    );
  const sidebar = page.getByRole("complementary", {
    name: "Sidebar",
    exact: true,
  });
  const resize = page.getByRole("separator", { name: "Resize sidebar" });
  // The popover and filled button at the default and narrowest widths.
  const capture = async (name) => {
    const popup = await viewOptions(page, "Team");
    await settle();
    await page.screenshot({ path: testInfo.outputPath(`${name}-popover.png`) });
    await page.keyboard.press("Escape");
    await expect(popup).toHaveCount(0);
    await page.mouse.move(0, 0);
    await settle();
    await sidebar.screenshot({
      path: testInfo.outputPath(`${name}-filtered.png`),
    });
  };
  let popup = await viewOptions(page, "Team");
  await popup.getByRole("radio", { name: "7 days", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(rowFor("delta")).toHaveCount(0);
  await capture("card-default");
  await resize.press("Home");
  await capture("card-narrow");
  await resize.press("End");

  // See all has no icon, so its label sits clear of the pill's rounded edge
  // rather than where row icons start.
  const seeAllRow = page.getByRole("button", {
    name: "See all in Team",
    exact: true,
  });
  const { inset, expected } = await seeAllRow.evaluate((row) => {
    const label = row.querySelector(".navigation-item-label");
    const probe = document.createElement("div");
    probe.style.width = "var(--space-3)";
    row.append(probe);
    const expected = probe.getBoundingClientRect().width;
    probe.remove();
    return {
      inset:
        label.getBoundingClientRect().left - row.getBoundingClientRect().left,
      expected,
    };
  });
  expect(expected).toBeGreaterThan(0);
  expect(inset).toBeCloseTo(expected, 0);

  await seeAllRow.click();
  // See all has no row of filter controls, only the same filled button.
  await expect(page.getByRole("tablist", { name: "Filter Team" })).toHaveCount(
    0,
  );
  await expect(viewOptionsButton(page, "Team")).toHaveAccessibleName(
    "View options for Team, filtered",
  );
  await expect(rowFor("gamma")).toBeVisible();
  await expect(rowFor("delta")).toHaveCount(0);
  await capture("see-all-default");
  await resize.press("Home");
  await capture("see-all-narrow");
  await resize.press("End");

  popup = await viewOptions(page, "Team");
  await popup.getByRole("radio", { name: "All", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(rowFor("delta")).toBeVisible();
  await expect(viewOptionsButton(page, "Team")).toHaveAccessibleName(
    "View options for Team",
  );
});
