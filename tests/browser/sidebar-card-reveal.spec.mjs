import { test, expect } from "./fixture.mjs";
import { newChat } from "./navigation.mjs";

const ids = Array.from(
  { length: 12 },
  (_, index) => `33333333-3333-4333-8333-${String(index).padStart(12, "0")}`,
);
test.use({
  productionBroker: true,
  channelIds: ids,
  channelNames: Object.fromEntries(
    ids.map((id, index) => [id, `Reveal chat ${index}`]),
  ),
  soloChannels: ids,
  ownSoloChannels: ids,
  historyCounts: Object.fromEntries(ids.map((id) => [id, 0])),
});

// Pointer capture, measured row height and live layout during a resize need a
// browser. Keyboard boundaries and pinned-row policy stay in SoloWorkspaces tests.
test("dragging the card bottom previews rows, cancels, and saves the reveal across reload", async ({
  page,
  app,
}, testInfo) => {
  await page.goto(app.origin);
  await newChat(page);
  const handle = page.getByRole("separator", { name: "Resize Chats card" });
  const rows = page.locator("[data-solo-channel-id]");
  await expect(rows).toHaveCount(7);
  await page.mouse.move(900, 300);
  await expect(handle).toHaveCSS("opacity", "0");
  const pull = async () => {
    await handle.scrollIntoViewIfNeeded();
    const start = await handle.boundingBox();
    const row = await rows
      .first()
      .locator("xpath=ancestor::*[@data-solo-menu-id][1]")
      .boundingBox();
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2,
    );
    await expect(handle).toHaveCSS("opacity", "1");
    await page.mouse.down();
    await page.mouse.move(
      start.x + start.width / 2,
      start.y + start.height / 2 + row.height * 3,
      { steps: 6 },
    );
    await expect(rows).toHaveCount(10);
  };
  await pull();
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(rows).toHaveCount(7);
  await page.reload();
  await expect(rows).toHaveCount(7);
  await pull();
  await page.mouse.up();
  await expect(handle).toBeFocused();
  await page.reload();
  await expect(rows).toHaveCount(10);
  await page
    .locator(".shell-sidebar")
    .screenshot({ path: testInfo.outputPath("resized-card.png") });
  await handle.press("Home");
  await expect(rows).toHaveCount(7);
});

// Sticky positioning and section containment require real scroll geometry.
test("scope headings stick while their cards scroll underneath", async ({
  page,
  app,
}) => {
  await page.setViewportSize({ width: 1100, height: 480 });
  await page.goto(app.origin);
  await newChat(page);
  await expect(page.locator("[data-solo-channel-id]")).toHaveCount(7);
  await page.evaluate(() => document.fonts.ready);
  const scopes = page.locator("[data-sticky-heading]");
  await expect(scopes).toHaveCount(2);
  const fadeOpacity = (heading) =>
    heading.evaluate((element) => getComputedStyle(element, "::after").opacity);
  for (const scope of await scopes.all()) {
    await scope.evaluate((section) => {
      const scroll = section.closest("[data-scroll-fade]");
      scroll.scrollTop = 0;
    });
    const heading = scope.locator(":scope > [data-disclosure]");
    await expect.poll(() => fadeOpacity(heading)).toBe("0");
    await scope.evaluate((section) => {
      const scroll = section.closest("[data-scroll-fade]");
      scroll.scrollTop +=
        section.getBoundingClientRect().top -
        scroll.getBoundingClientRect().top +
        30;
    });
    await expect
      .poll(() =>
        heading.evaluate((element) => {
          const scroll = element
            .closest("[data-scroll-fade]")
            .getBoundingClientRect();
          return Math.abs(element.getBoundingClientRect().top - scroll.top);
        }),
      )
      .toBeLessThan(1);
    await expect.poll(() => fadeOpacity(heading)).toBe("1");
    await expect(heading.locator("summary")).toBeVisible();
    await scope.evaluate((section) => {
      section.closest("[data-scroll-fade]").scrollTop = 0;
    });
    await expect.poll(() => fadeOpacity(heading)).toBe("0");
  }
});
