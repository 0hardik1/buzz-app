import { fileURLToPath } from "node:url";
import { test, expect } from "./fixture.mjs";
import { open, settle } from "./timeline.mjs";

// Browser-only: the sideline follows real scroll geometry and margin width.
const size = { width: 1680, height: 1000 };
test.use({
  productionBroker: true,
  historyCounts: { alpha: 0, beta: 1 },
  viewport: size,
});

const asset = (path) => fileURLToPath(new URL(path, import.meta.url));
const media = {
  "gradient.png": [asset("../../public/shell-gradient.png"), "image/png"],
  "cubes.webp": [
    asset("../../src-tauri/src/oauth_callback/cubes.webp"),
    "image/webp",
  ],
  "screen.png": [
    asset("../../docs/assets/readme/create-agent.png"),
    "image/png",
  ],
  "gloopy.png": [
    asset("../../src/features/agents/avatar-packs/gloopies-18.png"),
    "image/png",
  ],
  "demo.mp4": [
    asset("../fixtures/message-gallery/assets/sample.mp4"),
    "video/mp4",
  ],
};
const images = ["gradient.png", "screen.png", "cubes.webp", "gloopy.png"];
const links = [
  "Draft is up: [Sideline timeline prototype](https://github.com/example/chat/pull/4310)",
  "Root cause is in https://github.com/example/chat/issues/4288, the scroll anchor drifts",
  "See [ChannelTimeline.tsx](https://github.com/example/chat/blob/main/src/features/messages/ChannelTimeline.tsx) for the reveal path",
  "Follow-up: [Pins should survive edits](https://github.com/example/chat/issues/4302)",
  "CI fix landed in https://github.com/example/chat/pull/4315 and https://github.com/example/chat/pull/4316",
  "[Relay load budget](https://github.com/example/relay/pull/882) needs a second review",
  "Bisected to https://github.com/example/chat/commit/8bd322c2cc0f1e2d3c4b5a6978695a4b3c2d1e0f",
  "[Media thumbnails at small sizes](https://github.com/example/chat/pull/4321)",
];
const prose = [
  "Morning! Picking up where we left off yesterday.",
  "I think the margin is wide enough on most laptop screens once the side panel is closed. We should check a 13 inch window too.",
  "Agreed.",
  "Here's the thing I keep running into: by the time I scroll back to find the screenshot someone shared, I've lost my place in the conversation and the thread I was replying to.",
  "Can we keep the pinned decisions visible while scrolling? That's most of what I go back for.",
  "lol yes",
  "Running the fixture again with more history so it scrolls properly.",
  "The compressed timeline should move slower than the chat, like an editor minimap, so it covers more history than the screen does.",
  "Ok, back from lunch.",
  "One more idea: markers that scroll past the edge could stack there instead of vanishing.",
  "Ship it behind a setting first so nobody's normal view changes.",
];

const titles = {
  4310: "Sideline timeline prototype",
  4288: "Scroll anchor drifts after a reveal",
  4302: "Pins should survive edits",
  4315: "Fix flaky first-paint journey",
  4316: "Retry media uploads on reconnect",
  882: "Relay load budget",
  4321: "Media thumbnails at small sizes",
};

function seed(app) {
  const pins = [];
  const start = 1700000000;
  for (let i = 0; i < 96; i++) {
    let content = prose[i % prose.length];
    let attachments = [];
    if (i === 46) {
      content = "Screen recording of the scroll bug";
      attachments = [
        ["imeta", "url https://primary.example/media/demo.mp4", "m video/mp4"],
      ];
    } else if (i % 11 === 3) {
      const name = images[Math.floor(i / 11) % images.length];
      content = [
        "Mockup for the margin",
        "",
        "How it looks today",
        "Board from the planning session",
      ][Math.floor(i / 11) % 4];
      attachments = [
        [
          "imeta",
          `url https://primary.example/media/${name}`,
          `m ${media[name][1]}`,
        ],
      ];
    } else if (i % 9 === 5) content = links[Math.floor(i / 9) % links.length];
    if ([8, 30, 57, 79, 93].includes(i))
      content = [
        "Decision: the sideline only shows media, GitHub links and pins for now.",
        "Decision: hide it whenever the right-hand panel is open.",
        "Reminder: record demos with the headless fixture, never a native build.",
        "Decision: markers jump the chat to their message.",
        "Next step: get baxen's reaction before polishing.",
      ][[8, 30, 57, 79, 93].indexOf(i)];
    const event = app.append(
      "primary",
      "alpha",
      content,
      false,
      i % 3 !== 0,
      undefined,
      undefined,
      attachments,
      start + i * 1500,
    );
    if ([8, 30, 57, 79, 93].includes(i)) pins.unshift(event.id);
  }
  app.pin("alpha", pins);
}

test("the sideline maps media, GitHub links and pins beside the history", async ({
  page,
  app,
}) => {
  await page.route("**/api/relay/primary/media?**", (route) => {
    const url = decodeURIComponent(route.request().url());
    const name = Object.keys(media).find((key) => url.includes(key));
    if (!name) return route.fulfill({ status: 404 });
    const [path, contentType] = media[name];
    return route.fulfill({ path, contentType });
  });
  await page.route("https://api.github.com/**", (route) => {
    const number = new URL(route.request().url()).pathname.split("/").at(-1);
    return route.fulfill({
      json: { title: titles[number] ?? "A change", state: "open" },
    });
  });
  await page.addInitScript(() =>
    localStorage.setItem("buzz-sideline.v1", "on"),
  );
  seed(app);
  await open(page, app);
  const history = page.getByRole("region", { name: "Channel message history" });
  const sideline = page.locator("[data-sideline][data-visible]");
  const markers = sideline.getByRole("button", { name: /^Jump to/ });
  await expect(markers.first()).toBeVisible();
  await expect(
    sideline.getByRole("button", { name: /^Jump to Pinned: Next step/ }),
  ).toBeVisible();
  await expect(
    sideline.getByRole("button", { name: /^Jump to #4310 / }),
  ).toBeVisible();
  await expect(
    sideline.getByRole("button", { name: /^Jump to Video/ }),
  ).toBeAttached();
  await page.screenshot({
    path: test.info().outputPath("sideline-latest.png"),
  });

  // Scrolling the chat moves the sideline's viewport band with it.
  const band = page.locator("[data-sideline-viewport]");
  const bandAt = async () => (await band.boundingBox()).y;
  const before = await bandAt();
  await history.hover();
  await page.mouse.wheel(0, -4000);
  await settle(page);
  await expect.poll(bandAt).toBeLessThan(before);

  // A marker stuck to the top edge jumps the chat to its message.
  const stuck = sideline.locator('[data-edge="top"] button').last();
  const target = await stuck.getAttribute("data-sideline-marker");
  await stuck.click();
  await expect(
    history.locator(`[data-message-id="${target}"]`),
  ).toBeInViewport();
  await page.screenshot({
    path: test.info().outputPath("sideline-jumped.png"),
  });

  // It gives way to the right-hand panel and to a narrow margin.
  const pins = page.getByRole("button", {
    name: "Pinned messages",
    exact: true,
  });
  await pins.click();
  await expect(sideline).toHaveCount(0);
  await pins.click();
  await expect(markers.first()).toBeVisible();
  await page.setViewportSize({ width: 1100, height: size.height });
  await expect(sideline).toHaveCount(0);
  await page.setViewportSize(size);
  await expect(markers.first()).toBeVisible();
});
