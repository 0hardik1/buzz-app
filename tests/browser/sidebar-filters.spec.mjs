import { test, expect } from "./fixture.mjs";
import {
  chooseDate,
  chooseViewOption,
  closeMenus,
  dateChoice,
  expectViewOption,
  moreActionsButton,
  openFilterMenu,
  openPage,
  openSortMenu,
  unreadsFirst,
  unreadsOnly,
} from "./navigation.mjs";
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

// A card's filter choices sit under Filter in its ••• menu, beside Sort and
// Layout. The header has no separate filter button.
const viewOptions = openFilterMenu;
const show = chooseViewOption;

// Browser-only contract: menu choices, save recovery and the real broker's
// encrypted preference readback must agree after a document reload.
test("section filters save activity windows from the Filter menu", async ({
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
  const trigger = moreActionsButton(page, "Team");
  const checked = expectViewOption;
  await shot("01-all");
  let popup = await viewOptions(page, "Team");
  await checked(popup, "All");
  await shot("02-filter-menu");
  await unreadsOnly(popup).click();
  await expect
    .poll(() => app.report.sidebarPublications?.at(-1)?.blob.groups.channels)
    .toBe("unreads");
  await checked(popup, "Unreads");
  await shot("03-unreads");
  // Date combines with Unreads: both are saved together.
  await chooseDate(popup, "7 days");
  await expect
    .poll(() => app.report.sidebarPublications.at(-1)?.blob)
    .toMatchObject({
      groups: { channels: "unreads" },
      // Unreads keeps its own window, apart from Active's.
      unreadsWindowSeconds: { channels: 7 * 86400 },
    });
  await checked(popup, "Unreads");
  await checked(popup, "7 days");
  await shot("04-unreads-seven-days");
  // Unreads first, under Sort, has nothing to reorder while Unreads is on.
  await page.keyboard.press("Escape");
  await expect(popup).toHaveCount(0);
  const sort = await openSortMenu(page, "Team");
  await expect(unreadsFirst(sort)).toBeDisabled();
  await shot("04b-sort-menu");
  await closeMenus(page);
  popup = await viewOptions(page, "Team");
  // Turning Unreads off keeps the date.
  await unreadsOnly(popup).click();
  await expect
    .poll(() => app.report.sidebarPublications.at(-1)?.blob.groups.channels)
    .toBe("active");
  await checked(popup, "7 days");
  await expect(section.locator('[data-channel-id="gamma"]')).toBeVisible();
  await expect(section.locator('[data-channel-id="delta"]')).toHaveCount(0);
  await shot("05-seven-days");
  await closeMenus(page);
  await page.mouse.move(0, 0);
  await trigger.blur();
  // A filtered card's actions still show only on hover.
  const revealed = () =>
    trigger.evaluate(
      (button) =>
        getComputedStyle(button.closest("[data-navigation-reveal]")).opacity,
    );
  await expect.poll(revealed).toBe("0");
  await page.getByLabel("Team", { exact: true }).hover();
  await expect.poll(revealed).toBe("1");
  // Filter lives only in the ••• menu, so the header has no button for it.
  await expect(
    section.getByRole("button", { name: /^Filter Team/ }),
  ).toHaveCount(0);
  await shot("06-filtered-hover");
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
  await chooseDate(popup, "30 days");
  const retry = page.getByRole("button", { name: "Retry filter", exact: true });
  await expect(retry).toBeVisible();
  await page.keyboard.press("Escape");
  await shot("06b-save-error");
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
  popup = await viewOptions(page, "Team");
  await checked(popup, "30 days");
  await page.emulateMedia({ colorScheme: "dark" });
  await shot("07-filter-menu-dark");
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
  await expect(unreadsOnly(popup)).toBeDisabled();
  await expect(dateChoice(popup, "Today")).toBeDisabled();
  await expect(dateChoice(popup, "All")).toBeDisabled();
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
    await chooseDate(popup, "30 days");
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
    // Unreads keeps what needs you, so Archive's unread message mentions you.
    app.histories.set("primary/delta", [
      ...(app.histories.get("primary/delta") ?? []),
      app.signPeer({
        kind: 9,
        tags: [
          ["h", "delta"],
          ["p", app.viewer],
        ],
        content: "Can you take a look?",
        created_at: 1700000950,
      }),
    ]);
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
    await expectViewOption(popup, "All");
    expect(app.report.sidebarPublications?.length ?? 0).toBe(published);
  });
});

test.describe("with a saved workspace filter", () => {
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
    // Unreads spans all time by default, so the failed save below is All alone.
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

    await page.reload();
    await openPage(page, "Messages");
    const options = await viewOptions(page, "Work");
    await expectViewOption(options, "All");
    await expect(unreadsOnly(options)).not.toBeChecked();
  });
});
