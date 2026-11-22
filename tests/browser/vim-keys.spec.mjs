import {
  closeSettings,
  openSettings,
  selectSettingsSection,
} from "./navigation.mjs";
import { animationsSettled } from "./animations.mjs";
import { setPluginEnabled } from "./plugin-settings.mjs";
import { test, expect } from "./fixture.mjs";
import { open, wheel } from "./timeline.mjs";

// Real focus, key dispatch through the app's own handlers, Base UI menus and
// focus return need a browser; key tables and letters are unit-tested.
test.use({ historyCounts: { alpha: 4, beta: 1 } });

const apple = process.platform === "darwin";
const composer = (page, name) =>
  page.getByRole("textbox", { name: `Message #${name}`, exact: true });

const selectedId = (page) =>
  page.evaluate(
    () =>
      document.activeElement?.closest("[data-message-id]")?.dataset.messageId ??
      null,
  );
const nothingFocused = (page) =>
  page.evaluate(() => document.activeElement?.blur());

async function enableVimKeys(page) {
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  await setPluginEnabled(page, "Vim keys", true);
  await closeSettings(page);
}

test("Vim keys select messages, act on them with go, and leave the composer", async ({
  page,
  app,
}) => {
  await open(page, app);
  const alpha = composer(page, "Alpha");
  // Off by default: j types nowhere and selects nothing.
  await nothingFocused(page);
  await page.keyboard.press("j");
  expect(await selectedId(page)).toBeNull();

  await enableVimKeys(page);
  await nothingFocused(page);
  await page.keyboard.press("j");
  await expect.poll(() => selectedId(page)).not.toBeNull();
  const newest = await selectedId(page);
  await page.keyboard.press("k");
  await expect.poll(() => selectedId(page)).not.toBe(newest);
  await page.keyboard.press("j");
  await expect.poll(() => selectedId(page)).toBe(newest);
  // Down past the newest message stays on it instead of typing.
  await page.keyboard.press("j");
  await expect.poll(() => selectedId(page)).toBe(newest);
  await expect(alpha).not.toBeFocused();

  // go opens the message's own menu, each item with its key.
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  const menu = page.getByRole("menu");
  const reply = menu.getByRole("menuitem", { name: "Reply", exact: true });
  // Its key is the message's own: t replies, r reacts.
  await expect(reply).toHaveAttribute("aria-keyshortcuts", "t");
  await expect(
    menu.getByRole("menuitem", { name: "Copy message", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", /^[a-z0-9]$/);
  // go moves focus into the menu, so its keys reach it.
  await expect
    .poll(() =>
      page.evaluate(() => !!document.activeElement?.closest('[role="menu"]')),
    )
    .toBe(true);
  // An open menu keeps its keys: Space starts no leader sequence, so the
  // next key still reaches the menu.
  await page.keyboard.press(" ");
  await expect(page.locator("[data-vim-which-key]")).toHaveCount(0);
  await page.keyboard.press("t");
  await expect(menu).toHaveCount(0);
  await expect(
    page.getByRole("region", { name: "Thread messages", exact: true }),
  ).toBeVisible();
  // Reply hands focus to the thread's composer; let that and the panel's
  // entrance finish first, since i skips a composer the panel still covers.
  await expect(
    page.getByRole("textbox", { name: "Reply to thread", exact: true }),
  ).toBeFocused();
  await animationsSettled(page.locator("[data-panel-dock]"));

  // i types; Escape stops typing so j moves again.
  await nothingFocused(page);
  await page.keyboard.press("i");
  await expect(alpha).toBeFocused();
  await page.keyboard.press("j");
  await expect(alpha).toHaveText("j");
  await page.keyboard.press("Escape");
  await expect(alpha).not.toBeFocused();
});

test("the leader shows what can follow and runs Buzz's own actions by id", async ({
  page,
  app,
}) => {
  await open(page, app);
  await enableVimKeys(page);
  await nothingFocused(page);

  await page.keyboard.press(" ");
  const whichKey = page.locator("[data-vim-which-key]");
  await expect(whichKey).toBeVisible();
  await expect(
    whichKey.getByRole("menuitem", { name: "Settings", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", ",");
  // No items that only repeat another leader key, and no focus toggle.
  await expect(
    whichKey.getByRole("menuitem", { name: /^(Search|Toggle)…$/ }),
  ).toHaveCount(0);
  await page.keyboard.press(",");
  await expect(whichKey).toHaveCount(0);
  await expect(page.getByRole("dialog", { name: "Settings" })).toBeVisible();
  await closeSettings(page);

  // Escape cancels a sequence without acting.
  await nothingFocused(page);
  await page.keyboard.press(" ");
  await expect(whichKey).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(whichKey).toHaveCount(0);

  await nothingFocused(page);
  await page.keyboard.press(" ");
  await page.keyboard.press(" ");
  await expect(page.getByRole("dialog", { name: "Search Buzz" })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("dialog", { name: "Search Buzz", includeHidden: true }),
  ).toHaveCount(0);

  // ]b opens the next conversation in the sidebar.
  await nothingFocused(page);
  await page.keyboard.press("]");
  await page.keyboard.press("b");
  await expect(composer(page, "Beta")).toBeVisible();

  // \ focuses its sidebar row; go opens that conversation's own menu.
  await nothingFocused(page);
  await page.keyboard.press("\\");
  const row = page.locator('button[data-channel-id][aria-current="page"]');
  await expect(row).toBeFocused();
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  const menu = page.getByRole("menu");
  await expect(menu.getByRole("menuitem").first()).toHaveAttribute(
    "aria-keyshortcuts",
    /^[a-z0-9]$/,
  );
  await page.keyboard.press("Escape");
  await expect(menu).toHaveCount(0);
  await expect(row).toBeFocused();
  await expect(composer(page, "Beta")).toBeVisible();
});

test("leader keys follow Buzz's shortcut when it is rebound", async ({
  page,
  app,
}) => {
  await page.addInitScript(() => {
    localStorage.setItem(
      "buzz-shortcut-bindings.v1",
      JSON.stringify({ "global-search": { key: "F9" } }),
    );
  });
  await open(page, app);
  await enableVimKeys(page);
  const search = page.getByRole("dialog", { name: "Search Buzz" });
  // The rebind is in effect: its new key opens Search.
  await page.keyboard.press("F9");
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);
  await nothingFocused(page);
  await page.keyboard.press(" ");
  await page.keyboard.press(" ");
  await expect(search).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(search).toHaveCount(0);

  // Turning the plugin off takes the keys out of every menu.
  const profile = page.getByRole("button", {
    name: "Your profile",
    exact: true,
  });
  await profile.click();
  await expect(
    page.getByRole("menuitem", { name: "Settings", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", /./);
  await page.keyboard.press("Escape");
  await openSettings(page);
  await selectSettingsSection(page, "Manage plugins");
  await setPluginEnabled(page, "Vim keys", false);
  await closeSettings(page);
  await profile.click();
  await expect(
    page.getByRole("menuitem", { name: "Settings", exact: true }),
  ).not.toHaveAttribute("aria-keyshortcuts");
});

// Painted selection, the preview card's own Tab and Escape, and Base UI's
// return focus need a browser; the person menu is unit-tested.
test("a selection stays visible through its menus, and Tab and j reach people and rows", async ({
  page,
  app,
}) => {
  await open(page, app);
  await enableVimKeys(page);
  await nothingFocused(page);
  const painted = (locator) =>
    locator.evaluate(
      (element) => getComputedStyle(element, "::after").content !== "none",
    );
  await page.keyboard.press("j");
  await expect.poll(() => selectedId(page)).not.toBeNull();
  const newest = await selectedId(page);
  const message = page.locator(`[data-message-id="${newest}"] > [data-layout]`);
  await expect(message).toBeFocused();
  expect(await painted(message)).toBe(true);

  // Tab reaches the message's author; go opens the person's own menu, and
  // the message stays marked while it is open.
  await page.keyboard.press("Tab");
  const avatar = page.getByRole("button", {
    name: "View Fixture Reader profile",
  });
  await expect(avatar).toBeFocused();
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  const actions = page.getByRole("menu", { name: "Fixture Reader actions" });
  await expect(
    actions.getByRole("menuitem", { name: "View profile", exact: true }),
  ).toHaveAttribute("aria-keyshortcuts", "v");
  expect(await painted(message)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(actions).toHaveCount(0);
  await expect(avatar).toBeFocused();
  // The menu's return focus does not reopen the person's card, so one Escape
  // goes back to the message.
  await page.keyboard.press("Escape");
  await expect.poll(() => selectedId(page)).toBe(newest);
  await expect(avatar).not.toBeFocused();

  // The message's own menu returns focus to the message, not its author.
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  await expect(page.getByRole("menu")).toBeVisible();
  expect(await painted(message)).toBe(true);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(message).toBeFocused();
  // Focus can reach a just-opened menu late; until then the menu still owns
  // Escape, and the conversation does not take it as a move to the composer.
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  await expect(page.getByRole("menu")).toBeVisible();
  await message.focus();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(message).toBeFocused();

  // j and k step between sidebar rows, which have no arrow keys of their own.
  await page.keyboard.press("\\");
  const nav = page.getByRole("navigation", { name: "Subscribed channels" });
  await expect(nav.getByRole("button", { name: "Alpha" })).toBeFocused();
  await page.keyboard.press("j");
  await expect(nav.getByRole("button", { name: "Beta" })).toBeFocused();
  await page.keyboard.press("k");
  await expect(nav.getByRole("button", { name: "Alpha" })).toBeFocused();
});

// Real focus handoffs (the host's composer autofocus, Base UI's return
// focus), painting, wheel scrolling over a virtualized list and preview cards
// need a browser; cursor bookkeeping is unit-tested in cursor.test.ts.
test.describe("the cursor", () => {
  // Tall messages, so scrolling away unmounts rows.
  test.use({ historyCounts: { alpha: 40, beta: 3 }, tallMessages: true });
  const box = (page, n, channel = "alpha") =>
    page.locator("[data-message-id] > [data-layout]").filter({
      hasText: new RegExp(`primary ${channel} message ${n}(?!\\d)`),
    });
  const cursor = (page) => page.locator("[data-message-cursor]");
  const painted = (locator) =>
    locator.evaluate(
      (element) => getComputedStyle(element, "::after").content !== "none",
    );
  const history = (page) =>
    page.getByRole("region", { name: "Channel message history" });

  test("a conversation always has one focused selection that only moves and clicks change", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await enableVimKeys(page);
    // Opening takes focus to the newest message, not the composer.
    await expect(box(page, 39)).toBeFocused();
    await expect(cursor(page)).toHaveCount(1);
    await expect(box(page, 39)).toHaveAttribute("data-message-cursor", "");
    await page.keyboard.press("k");
    await expect(box(page, 38)).toBeFocused();
    await expect(cursor(page)).toHaveCount(1);

    // Escape on the message stays on it; i types and Escape comes back.
    await page.keyboard.press("Escape");
    await expect(box(page, 38)).toBeFocused();
    // The cursor is where focus is: typing, the sidebar and the which-key
    // menu leave the message unmarked, and Escape comes back to it.
    await page.keyboard.press("i");
    await expect(composer(page, "Alpha")).toBeFocused();
    await expect(cursor(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(box(page, 38)).toBeFocused();

    await page.keyboard.press("\\");
    const nav = page.getByRole("navigation", { name: "Subscribed channels" });
    await expect(nav.getByRole("button", { name: "Alpha" })).toBeFocused();
    await expect(cursor(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(box(page, 38)).toBeFocused();
    await page.keyboard.press(" ");
    await expect(page.locator("[data-vim-which-key]")).toBeVisible();
    await expect(cursor(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(page.locator("[data-vim-which-key]")).toHaveCount(0);
    await expect(box(page, 38)).toBeFocused();

    // Scrolling moves the view, not the selection; the next move brings the
    // view back to the selection.
    await history(page).hover();
    await wheel(page, -6000);
    await expect(box(page, 38)).not.toBeInViewport();
    await expect(box(page, 38)).toBeFocused();
    await expect(box(page, 38)).toHaveAttribute("data-message-cursor", "");
    await page.keyboard.press("k");
    await expect(box(page, 37)).toBeFocused();
    await expect(box(page, 37)).toBeInViewport();
    // While typing too: the selection stays rendered, and Escape returns to it.
    await page.keyboard.press("i");
    await expect(composer(page, "Alpha")).toBeFocused();
    await history(page).hover();
    await wheel(page, -6000);
    await expect(box(page, 37)).not.toBeInViewport();
    await page.keyboard.press("Escape");
    await expect(box(page, 37)).toBeFocused();
    await expect(box(page, 37)).toBeInViewport();

    // A click selects, and painting does not need keyboard navigation.
    await box(page, 39).click({ position: { x: 4, y: 4 } });
    await expect(box(page, 39)).toBeFocused();
    await expect(cursor(page)).toHaveCount(1);
    await expect.poll(() => painted(box(page, 39))).toBe(true);
    await page.keyboard.press("k");
    await expect(box(page, 38)).toBeFocused();
    await page.keyboard.press("j");
    await expect(box(page, 39)).toBeFocused();

    // Each conversation keeps its own selection, focused on arrival.
    await page.keyboard.press("k");
    await expect(box(page, 38)).toBeFocused();
    await page.keyboard.press("]");
    await page.keyboard.press("b");
    await expect(box(page, 2, "beta")).toBeFocused();
    await page.keyboard.press("[");
    await page.keyboard.press("b");
    await expect(box(page, 38)).toBeFocused();
    // So does a click in the sidebar.
    await nav.getByRole("button", { name: "Beta" }).click();
    await expect(box(page, 2, "beta")).toBeFocused();
    await expect(composer(page, "Beta")).not.toBeFocused();
  });

  test("gg, G, Ctrl-d and Ctrl-u move the selection, and the view follows", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await enableVimKeys(page);
    await expect(box(page, 39)).toBeFocused();
    const selected = () =>
      page.evaluate(() =>
        Number(
          /message (\d+)/.exec(document.activeElement?.textContent ?? "")?.[1],
        ),
      );
    await page.keyboard.press("Control+u");
    await expect.poll(selected).toBeLessThan(39);
    const up = await selected();
    await expect(box(page, up)).toBeInViewport();
    await expect(box(page, up)).toHaveAttribute("data-message-cursor", "");
    await page.keyboard.press("Control+d");
    await expect.poll(selected).toBeGreaterThan(up);
    await expect(box(page, await selected())).toBeInViewport();

    await page.keyboard.press("g");
    await page.keyboard.press("g");
    // The oldest loaded message; history pages in from the reader's own
    // upward scrolling.
    const oldest = page.locator("[data-message-id] > [data-layout]").first();
    await expect(oldest).toBeFocused();
    await expect(oldest).toBeInViewport();
    await expect(oldest).toHaveAttribute("data-message-cursor", "");
    await page.keyboard.press("Shift+G");
    await expect(box(page, 39)).toBeFocused();
    await expect(box(page, 39)).toBeInViewport();
  });

  test("gg, G and Ctrl-d move the selection in the sidebar and in menus too", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await enableVimKeys(page);
    await expect(box(page, 39)).toBeFocused();
    const nav = page.getByRole("navigation", { name: "Subscribed channels" });
    const sidebar = page.locator('aside[aria-label="Sidebar"]');
    await page.keyboard.press("\\");
    await expect(nav.getByRole("button", { name: "Alpha" })).toBeFocused();
    // Headings are stops too; h and l reach their buttons on the same line.
    await page.keyboard.press("k");
    const team = nav.locator("summary").filter({ hasText: "Team" });
    await expect(team).toBeFocused();
    await page.keyboard.press("l");
    await expect(
      nav.getByRole("button", { name: "More actions for Team" }),
    ).toBeFocused();
    await page.keyboard.press("h");
    await expect(team).toBeFocused();
    // The whole sidebar, from Activity at the top to New at the bottom.
    await page.keyboard.press("Shift+G");
    await expect(
      sidebar.getByRole("button", { name: "New options" }),
    ).toBeFocused();
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    const activity = sidebar.getByRole("button", { name: /^Activity/ });
    await expect(activity).toBeFocused();
    await page.keyboard.press("j");
    await expect(nav.locator("summary").first()).toBeFocused();
    await page.keyboard.press("Control+d");
    await expect
      .poll(() =>
        sidebar.evaluate(
          (element) =>
            element.contains(document.activeElement) &&
            document.activeElement?.tagName !== "SUMMARY",
        ),
      )
      .toBe(true);
    // An open tooltip takes the first Escape, so leave once it has gone.
    await page.keyboard.press("\\");
    await expect(page.getByRole("tooltip")).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(box(page, 39)).toBeFocused();

    // In a menu, g is not an item's letter: gg and G reach its ends.
    await page.keyboard.press("g");
    await page.keyboard.press("o");
    const items = page.getByRole("menu").getByRole("menuitem");
    await expect(items.first()).toBeVisible();
    await expect
      .poll(() =>
        page.evaluate(() => !!document.activeElement?.closest('[role="menu"]')),
      )
      .toBe(true);
    await page.keyboard.press("Shift+G");
    await expect(items.last()).toBeFocused();
    // The menu's typeahead does not take j and k from Vim keys.
    await page.keyboard.press("k");
    await expect(items.nth((await items.count()) - 2)).toBeFocused();
    await page.keyboard.press("j");
    await expect(items.last()).toBeFocused();
    await page.keyboard.press("g");
    await page.keyboard.press("g");
    await expect(items.first()).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(box(page, 39)).toBeFocused();
  });

  test("Tab switches between a message's parts and never enters them", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await enableVimKeys(page);
    const newest = box(page, 39);
    await expect(newest).toBeFocused();
    const avatar = page.getByRole("button", {
      name: "View Fixture Reader profile",
    });
    const card = page.getByRole("dialog", {
      name: "Fixture Reader profile preview",
    });
    await page.keyboard.press("Tab");
    await expect(avatar).toBeFocused();
    // The person's card shows, but Tab moves on rather than into it.
    await expect(card).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(newest).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(avatar).toBeFocused();
    await expect(card).toBeVisible();
    await page.keyboard.press("Shift+Tab");
    await expect(newest).toBeFocused();
    await expect(card).toHaveCount(0);
    // Escape from a part goes back to its message.
    await page.keyboard.press("Tab");
    await expect(avatar).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(newest).toBeFocused();

    // A message without parts keeps focus.
    await page.keyboard.press("k");
    await expect(box(page, 38)).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(box(page, 38)).toBeFocused();
  });
});

// Settings has no arrow keys of its own: its section list and its controls
// are Tab stops, so moves walk them by line.
test("j, k, gg, G and Ctrl-d walk Settings without opening its choices", async ({
  page,
  app,
}) => {
  await open(page, app);
  await enableVimKeys(page);
  await openSettings(page);
  await selectSettingsSection(page, "Notifications");
  const sections = page.getByRole("navigation", { name: "Settings sections" });
  const notifications = sections.getByRole("button", {
    name: "Notifications",
    exact: true,
  });
  await notifications.focus();
  await page.keyboard.press("j");
  await expect(
    sections.getByRole("button", { name: "Shortcuts", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("k");
  await expect(notifications).toBeFocused();
  await page.keyboard.press("Shift+G");
  await expect(sections.getByRole("button").last()).toBeFocused();
  await page.keyboard.press("g");
  await page.keyboard.press("g");
  await expect(sections.getByRole("button").first()).toBeFocused();

  // The section's own controls, staying out of the section list.
  const dialog = page.getByRole("dialog", { name: "Settings" });
  await dialog.getByRole("switch", { name: "Mentions" }).focus();
  await page.keyboard.press("j");
  await expect(
    dialog.getByRole("switch", { name: "Direct messages" }),
  ).toBeFocused();
  await page.keyboard.press("Shift+G");
  const last = dialog.getByRole("combobox").last();
  await expect(last).toBeFocused();
  // j and k step over a choice without opening it.
  await page.keyboard.press("k");
  await expect(dialog.getByRole("combobox").nth(-2)).toBeFocused();
  await expect(page.getByRole("listbox")).toHaveCount(0);
  await page.keyboard.press("Control+u");
  await expect(dialog.getByRole("combobox").nth(-2)).not.toBeFocused();
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          !!document.activeElement?.closest('[role="dialog"]') &&
          !document.activeElement.closest("nav"),
      ),
    )
    .toBe(true);
});

// A thread opens beside the conversation in a side panel with its own
// message box and list, and its tab's own Escape; that handoff needs a browser.
test.describe("with a thread", () => {
  test.use({ readState: true, threadUnread: true, productionBroker: true });
  const panel = (page) => page.locator("[data-panel-workspace]");
  const marked = (page) => page.locator("[data-message-cursor]");
  /** Where focus is, as a message's text, or null outside a message. */
  const focusedText = (page) =>
    page.evaluate(
      () =>
        document.activeElement?.closest("[data-message-id]")?.textContent ??
        null,
    );
  async function enterThread(page, app) {
    await open(page, app);
    await enableVimKeys(page);
    const root = app.histories
      .get("primary/alpha")
      .find((event) => event.content === "Thread root 1");
    const message = page.locator(
      `[data-channel-timeline] [data-message-id="${root.id}"] > [data-layout]`,
    );
    await message.getByText("Thread root 1").click();
    await expect(message).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(
      panel(page).getByRole("tab", { name: "Thread root 1", exact: true }),
    ).toBeVisible();
    // The thread's newest message has taken focus from its message box.
    await expect.poll(() => focusedText(page)).toContain("Unread reply 1");
    return message;
  }

  test("Enter enters the thread at its newest message, and Escape from its message box comes back", async ({
    page,
    app,
  }) => {
    await enterThread(page, app);
    const reply = panel(page)
      .locator("[data-message-id] > [data-layout]")
      .filter({ hasText: "Unread reply 1" });
    await expect(reply).toBeFocused();
    const box = panel(page).getByRole("textbox");
    // j and k move in the thread; they never type into its message box.
    await page.keyboard.press("k");
    await expect.poll(() => focusedText(page)).toContain("Thread root 1");
    expect(
      await page.evaluate(
        () => !!document.activeElement?.closest("[data-panel-workspace]"),
      ),
    ).toBe(true);
    await page.keyboard.press("j");
    await expect(reply).toBeFocused();
    await expect(box).toHaveText("");
    // Escape from the message box returns to the thread's message and keeps
    // the thread and the draft.
    await page.keyboard.press("i");
    await expect(box).toBeFocused();
    await page.keyboard.type("hello");
    await page.keyboard.press("Escape");
    await expect(reply).toBeFocused();
    await expect(
      panel(page).getByRole("tab", { name: "Thread root 1", exact: true }),
    ).toBeVisible();
    await expect(box).toHaveText("hello");
  });

  test("there is only ever one cursor, and it is where focus is", async ({
    page,
    app,
  }) => {
    const root = await enterThread(page, app);
    const one = () =>
      expect
        .poll(() =>
          page.evaluate(() => {
            const marks = document.querySelectorAll("[data-message-cursor]");
            return (
              marks.length === 1 && !!marks[0]?.contains(document.activeElement)
            );
          }),
        )
        .toBe(true);
    await one();
    await page.keyboard.press("k");
    await expect.poll(() => focusedText(page)).toContain("Thread root 1");
    await one();
    // The conversation's own selection stays put while the thread moves.
    await expect(root).not.toHaveAttribute("data-message-cursor");
    // Moving to the conversation takes the cursor there, and back again.
    await page.keyboard.press(apple ? "Control+h" : "Alt+h");
    await expect(root).toBeFocused();
    await one();
    await page.keyboard.press(apple ? "Control+l" : "Alt+l");
    await expect
      .poll(() =>
        page.evaluate(
          () => !!document.activeElement?.closest("[data-panel-workspace]"),
        ),
      )
      .toBe(true);
    await expect.poll(() => focusedText(page)).toContain("Thread root 1");
    await one();
    // In the message box, a menu or the sidebar, no message is marked.
    await page.keyboard.press("i");
    await expect(panel(page).getByRole("textbox")).toBeFocused();
    await expect(marked(page)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await one();
    await page.keyboard.press("\\");
    await expect(marked(page)).toHaveCount(0);
    // A window without focus shows no cursor; it comes back with focus.
    await page.keyboard.press("Escape");
    await one();
    await page.evaluate(() => {
      document.hasFocus = () => false;
      window.dispatchEvent(new FocusEvent("blur"));
    });
    await expect(marked(page)).toHaveCount(0);
    await page.evaluate(() => {
      delete document.hasFocus;
      window.dispatchEvent(new FocusEvent("focus"));
    });
    await one();
  });

  test("go offers React on r, and r opens the reaction picker", async ({
    page,
    app,
  }) => {
    const root = await enterThread(page, app);
    await page.keyboard.press(apple ? "Control+h" : "Alt+h");
    await expect(root).toBeFocused();
    await page.keyboard.press("g");
    await page.keyboard.press("o");
    const react = page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Add reaction", exact: true });
    await expect(react).toHaveAttribute("aria-keyshortcuts", "r");
    await page.keyboard.press("r");
    await expect(page.locator("em-emoji-picker")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("em-emoji-picker")).toHaveCount(0);
    await expect(root).toBeFocused();
    // Buzz's own r on the selected message opens it too.
    await page.keyboard.press("r");
    await expect(page.locator("em-emoji-picker")).toBeVisible();
  });
});

// Escape in the composer competes with Buzz's Escape for marking an unread
// conversation read, which needs live delivery to the open conversation.
test.describe("with an unread conversation", () => {
  test.use({
    historyCounts: { alpha: 4, beta: 1 },
    readState: true,
    productionBroker: true,
    soloAgentNames: ["Robo"],
  });
  test("Escape leaves the message box for the selection before marking read", async ({
    page,
    app,
  }) => {
    await open(page, app);
    await enableVimKeys(page);
    const selected = page.locator("[data-message-cursor]");
    await expect(selected).toBeFocused();
    await page.keyboard.press("i");
    const alpha = composer(page, "Alpha");
    await expect(alpha).toBeFocused();
    await page.keyboard.type("hello");
    app.soloAgentMessage("alpha", "A new message arrives");
    await expect(page.getByText("A new message arrives")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(selected).toBeFocused();
    await expect(alpha).toHaveText("hello");
    // So the pane keys work again, rather than editing the draft.
    await page.keyboard.press(apple ? "Control+h" : "Alt+h");
    const nav = page.getByRole("navigation", { name: "Subscribed channels" });
    await expect(nav.getByRole("button", { name: "Alpha" })).toBeFocused();
    await expect(alpha).toHaveText("hello");
  });
});
