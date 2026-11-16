import { test, expect } from "./source-fixture.mjs";
import { watchPageErrors } from "./page-errors.mjs";

const paint = (page) =>
  page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() =>
          requestAnimationFrame(() => requestAnimationFrame(resolve)),
        ),
      ),
  );

const anchorGap = (page, selector) =>
  page.evaluate((selector) => {
    const trigger = document.querySelector(selector).getBoundingClientRect();
    const menu = document
      .querySelector('[role="menu"]')
      .getBoundingClientRect();
    return Math.min(
      Math.abs(menu.top - trigger.bottom),
      Math.abs(trigger.top - menu.bottom),
    );
  }, selector);

test("action menus resize and remain tracked while text scale changes", async ({
  page,
}, testInfo) => {
  const watched = watchPageErrors(page);
  const errorsByMode = {};
  await page.setViewportSize({ width: 1024, height: 768 });

  for (const mode of ["menu", "refreshed", "context"]) {
    await page.goto(`/tests/fixtures/action-menu-sizing.html?mode=${mode}`);
    const triggerSelector =
      mode === "context"
        ? "[data-action-trigger]"
        : '[aria-label="More message actions"]';
    const trigger = page.locator(triggerSelector);
    const scroller = page.locator("[data-message-scroller]");
    const errorsBeforeOpen = watched.errors.length;
    if (mode === "context") {
      await trigger.click({ button: "right" });
    } else {
      await page.locator('[data-message-id="synthetic-message"]').hover();
      await expect(trigger).toBeVisible();
      await trigger.click();
    }

    const menu = page.getByRole("menu");
    await expect(menu).toBeVisible();
    const menuElement = await menu.elementHandle();
    expect(menuElement).not.toBeNull();
    await paint(page);
    expect(watched.errors).toHaveLength(errorsBeforeOpen);
    const errorsBeforeResize = watched.errors.length;
    let before = await menu.evaluate(
      (node, selector) => ({
        height: node.getBoundingClientRect().height,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        triggerTop: document.querySelector(selector).getBoundingClientRect()
          .top,
      }),
      triggerSelector,
    );

    if (mode === "refreshed") {
      await page.evaluate(() =>
        window.dispatchEvent(new Event("action-menu-content-refresh")),
      );
      await expect(
        menu.getByRole("menuitem", { name: "Updated message action 9" }),
      ).toBeAttached();
      await expect
        .poll(() => menu.evaluate((node) => node.scrollHeight))
        .toBeGreaterThan(before.scrollHeight);
      await expect(menu).toBeVisible();
      expect(await menuElement.evaluate((node) => node.isConnected)).toBe(true);
      before = await menu.evaluate(
        (node, selector) => ({
          height: node.getBoundingClientRect().height,
          clientHeight: node.clientHeight,
          scrollHeight: node.scrollHeight,
          triggerTop: document.querySelector(selector).getBoundingClientRect()
            .top,
        }),
        triggerSelector,
      );
    }

    await page.screenshot({
      path: testInfo.outputPath(`action-menu-${mode}-before.png`),
    });

    await page.locator("html").evaluate((node) => {
      node.style.setProperty("--buzz-text-scale", "1.5");
    });
    await expect
      .poll(() => menuElement.evaluate((node) => node.isConnected))
      .toBe(true);
    await expect
      .poll(() =>
        menu.evaluate(
          (node, height) =>
            Math.abs(node.getBoundingClientRect().height - height),
          before.height,
        ),
      )
      .toBeGreaterThan(1);
    await paint(page);
    await page.screenshot({
      path: testInfo.outputPath(`action-menu-${mode}-after.png`),
    });

    const after = await menu.evaluate((node, selector) => {
      const rect = node.getBoundingClientRect();
      return {
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        left: rect.left,
        height: rect.height,
        clientHeight: node.clientHeight,
        scrollHeight: node.scrollHeight,
        triggerTop: document.querySelector(selector).getBoundingClientRect()
          .top,
        side: node.dataset.side,
      };
    }, triggerSelector);
    await expect(menu).toBeVisible();
    console.info(
      "action-menu-sizing evidence",
      JSON.stringify({
        mode,
        before,
        after,
        errors: watched.errors.slice(errorsBeforeResize),
      }),
    );
    expect(after.scrollHeight).toBeGreaterThan(before.scrollHeight);
    expect(after.top).toBeGreaterThanOrEqual(0);
    expect(after.left).toBeGreaterThanOrEqual(0);
    expect(after.right).toBeLessThanOrEqual(1024);
    expect(after.bottom).toBeLessThanOrEqual(768);

    await menu.getByRole("menuitem").last().scrollIntoViewIfNeeded();
    await expect(menu.getByRole("menuitem").last()).toBeInViewport();
    if (mode !== "context") {
      const beforeScroll = await anchorGap(page, triggerSelector);
      const scrollTop = await scroller.evaluate((node) => node.scrollTop);
      await scroller.evaluate((node) => node.scrollBy(0, 16));
      await expect
        .poll(() => scroller.evaluate((node) => node.scrollTop))
        .toBeGreaterThan(scrollTop);
      await expect
        .poll(async () =>
          Math.abs((await anchorGap(page, triggerSelector)) - beforeScroll),
        )
        .toBeLessThan(1);
    }

    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);
    await expect(page.locator(".buzz-menu-positioner")).toHaveCount(0);
    const errorsAfterClose = watched.errors.length;
    await scroller.evaluate((node) => node.scrollBy(0, 8));
    await paint(page);
    expect(watched.errors).toHaveLength(errorsAfterClose);
    errorsByMode[mode] = watched.errors.slice(errorsBeforeResize);
  }

  expect(errorsByMode).toEqual({ menu: [], refreshed: [], context: [] });
});
