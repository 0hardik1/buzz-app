// PROTOTYPE (not for merge): the sticky aside's place while an older page lands.
import { test, expect } from "./fixture.mjs";
import { open, settle } from "./timeline.mjs";

test.use({
  pluginFixtures: true,
  historyCounts: { alpha: 640, beta: 3 },
  viewport: { width: 1280, height: 800 },
});

const history = (page) =>
  page.getByRole("region", { name: "Channel message history" });

async function openAside(page) {
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const result = await window.fixtureNavigation
          ?.open({
            version: 1,
            kind: "page",
            pluginId: "fixture.session",
            pageId: "reader",
            route: {
              version: 1,
              params: { channelId: "alpha", aside: "tall" },
            },
          })
          .catch(() => undefined);
        return result?.status;
      }),
    )
    .toBe("opened");
  await expect(
    history(page).getByRole("region", { name: "Fixture dashboard" }),
  ).toBeVisible();
}

// The widget's top in the history and the offset past the latest message.
const place = (region) =>
  region.evaluate((element) => {
    const widget = element.querySelector('[aria-label="Fixture dashboard"]');
    return {
      top:
        widget.getBoundingClientRect().top -
        element.getBoundingClientRect().top,
      past: Number(element.dataset.prototypePast),
    };
  });

test("a fast reversal while an older page lands moves the widget with the scroll", async ({
  page,
  app,
}) => {
  await open(page, app);
  await openAside(page);
  const region = history(page);
  await settle(page, region);
  const rest = await place(region);
  expect(Math.abs(rest.past)).toBeLessThanOrEqual(1);

  // Scroll a little past the latest message: only the widget moves.
  await region.hover();
  for (let i = 0; i < 4; i++) await page.mouse.wheel(0, 60);
  await expect
    .poll(async () => (await place(region)).past)
    .toBeGreaterThan(200);
  const past = await place(region);
  expect(Math.abs(past.top - (rest.top - past.past))).toBeLessThanOrEqual(2);

  // A fresh channel's first older page is already requested. Hold it, then
  // scroll back quickly as it lands: one step per frame, sampled each frame.
  await expect.poll(() => app.pending.length).toBe(1);
  await region.evaluate((element) => {
    const height = element.scrollHeight;
    const samples = [];
    const widget = element.querySelector('[aria-label="Fixture dashboard"]');
    window.reversal = new Promise((resolve) => {
      const frame = () => {
        if (element.scrollHeight !== height) {
          samples.push({
            top:
              widget.getBoundingClientRect().top -
              element.getBoundingClientRect().top,
            past: Number(element.dataset.prototypePast),
          });
          if (samples.length > 8) return resolve(samples);
          element.scrollTop -= 150;
        }
        requestAnimationFrame(frame);
      };
      requestAnimationFrame(frame);
    });
  });
  app.pending.shift().release();
  // Past the latest message the widget moves 1:1; in history it sticks at
  // its resting top.
  for (const sample of await page.evaluate(() => window.reversal))
    expect(
      Math.abs(sample.top - (rest.top - Math.max(0, sample.past))),
      `widget at ${Math.round(sample.top)}, ${sample.past}px past latest`,
    ).toBeLessThanOrEqual(2);
});
