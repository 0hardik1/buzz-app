import { test, expect } from "./source-fixture.mjs";
import { animationsSettled } from "./animations.mjs";

async function pinConversation(page, name) {
  await page
    .getByRole("button", { name: "Add to canvas", exact: true })
    .click();
  await page
    .getByRole("menuitem", { name: "Conversation pin", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Pin a conversation", exact: true })
    .getByRole("button", { name, exact: true })
    .click();
}

// Browser pointer capture and portal hit testing are the contract: component
// tests of the resize callback cannot detect a canvas swallowing menu clicks.
test("Home pin menus resize the rendered artwork without distorting group portraits", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/home-canvas.html?shell");
  await pinConversation(page, "Avery, Mango");
  const pin = page.locator("[data-home-conversation-pin]");
  const button = pin.getByRole("button");
  for (const [action, size] of [
    ["Larger", 128],
    ["Smaller", 96],
    ["Larger", 128],
  ]) {
    await button.click({ button: "right" });
    await page.getByRole("menuitem", { name: action, exact: true }).click();
    await expect(pin).toHaveCSS("width", `${size}px`);
    const artwork = button.locator(':scope > [aria-hidden="true"] > span');
    await expect(artwork).toHaveCount(2);
    for (const portrait of await artwork.all()) {
      const rect = await portrait.boundingBox();
      expect(rect.width).toBeCloseTo(rect.height, 1);
    }
    await expect(page.getByRole("dialog")).toHaveCount(0);
  }
});

// Image geometry, drag capture, and reduced-motion rendering need a browser.
test("Home images have no chrome, preserve their ratio, and drag directly", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/home-canvas.html?shell");
  const png = await page.evaluate(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 400;
    canvas.height = 200;
    const context = canvas.getContext("2d");
    context.fillStyle = "#527";
    context.fillRect(0, 0, 400, 200);
    return canvas.toDataURL().split(",")[1];
  });
  await page.getByLabel("Choose canvas files", { exact: true }).setInputFiles({
    name: "landscape.png",
    mimeType: "image/png",
    buffer: Buffer.from(png, "base64"),
  });
  const card = page.getByRole("region", { name: "landscape.png", exact: true });
  const image = card.getByRole("img", { name: "landscape.png", exact: true });
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBe(400);
  const imageBox = await image.boundingBox();
  const cardBox = await card.boundingBox();
  expect(imageBox.width / imageBox.height).toBeCloseTo(2, 2);
  expect(cardBox.height).toBeCloseTo(imageBox.height, 0);
  await expect(card.getByText("landscape.png", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("button")).toHaveCount(1);
  const handle = card.getByRole("button", { name: /^Move landscape/ });
  await handle.click({ button: "right" });
  await expect(
    page.getByRole("menuitem", { name: "Save a copy", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  await page.emulateMedia({ reducedMotion: "reduce" });
  const before = await card.boundingBox();
  const box = await handle.boundingBox();
  await page.mouse.move(box.x + 30, box.y + 30);
  await page.mouse.down();
  await page.mouse.move(box.x + 110, box.y + 70, { steps: 6 });
  await expect(card.locator("[data-home-card-surface]")).toHaveCSS(
    "transform",
    "none",
  );
  await page.mouse.up();
  await expect
    .poll(async () => Math.round((await card.boundingBox()).x - before.x))
    .toBe(80);
  await handle.press("ArrowRight");
  await expect
    .poll(async () => Math.round((await card.boundingBox()).x - before.x))
    .toBe(96);
  await page.reload();
  await expect(image).toBeVisible();
  await expect.poll(() => image.evaluate((el) => el.naturalWidth)).toBe(400);
  await expect(
    page.getByRole("button", { name: "Zoom in", exact: true }),
  ).toHaveCount(0);
});

// Shared sheet layout/portals, source-editor occlusion, and registration after
// closing cannot be established by an isolated MessageComposer mount.
test("Home readers repeatedly expand from the ordinary composer and Bestie omits history", async ({
  page,
}) => {
  await page.goto("/tests/fixtures/home-canvas.html?shell");
  await pinConversation(page, "Avery");
  const source = page.locator("[data-home-compose]");
  const composer = source.locator("[data-message-composer]");
  await expect(composer).toBeVisible();
  const anchor = await composer.boundingBox();
  for (let opening = 0; opening < 2; opening++) {
    await page
      .locator("[data-home-conversation-pin]")
      .getByRole("button")
      .click();
    const reader = page.getByRole("dialog", { name: "Avery", exact: true });
    await expect(reader).toBeVisible();
    await animationsSettled(reader, { subtree: true });
    expect(
      await reader.evaluate((el) => !!el.closest("[data-details-sheet]")),
    ).toBe(true);
    const rect = await reader.boundingBox();
    expect(rect.x).toBeCloseTo(anchor.x - 8, 0);
    expect(rect.width).toBeCloseTo(anchor.width + 16, 0);
    await expect(source).toBeHidden();
    await reader.getByRole("textbox").fill("Keep this draft");
    await reader.getByRole("button", { name: "Close", exact: true }).click();
    await expect(reader).toHaveCount(0);
    await expect(source).toBeVisible();
  }
  await page.goto("/tests/fixtures/home-canvas.html?shell&bestie");
  const bestie = page.getByRole("dialog", { name: "Ask Bestie", exact: true });
  await expect(
    bestie.getByText("Asking Bestie about", { exact: true }),
  ).toBeVisible();
  await expect(bestie.getByRole("textbox")).toBeVisible();
  await expect(
    bestie.getByRole("region", {
      name: "Channel message history",
      exact: true,
    }),
  ).toHaveCount(0);
});
