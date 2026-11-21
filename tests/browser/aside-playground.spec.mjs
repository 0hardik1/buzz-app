// PROTOTYPE PLAYGROUND (not for merge): serves the sticky-aside fixture at a
// fixed 127.0.0.1 URL for hands-on review. Runs only with ASIDE_PLAYGROUND=1
// and holds until killed. The Playwright fixture owns the app build and modeled
// relay; this proxy adds a review panel and lets any local browser open it.
import http from "node:http";
import { test } from "./fixture.mjs";
import { open } from "./timeline.mjs";

const PORT = Number(process.env.ASIDE_PLAYGROUND_PORT ?? 4418);

test.use({
  pluginFixtures: true,
  olderPageDelayMs: 300,
  historyCounts: { alpha: 640, beta: 3 },
});

// Runs in the reviewer's page before the app's scripts.
function boot(seed) {
  for (const [key, value] of Object.entries(seed))
    localStorage.setItem(key, value);
  const realMatch = window.matchMedia.bind(window);
  const reduced = () => localStorage.getItem("playground.reduced") === "1";
  window.matchMedia = (query) =>
    /prefers-reduced-motion/.test(query) && reduced()
      ? {
          matches: !query.includes("no-preference"),
          media: query,
          onchange: null,
          addEventListener() {},
          removeEventListener() {},
          addListener() {},
          removeListener() {},
          dispatchEvent: () => false,
        }
      : realMatch(query);
  const launch = new MutationObserver(() => {
    const node = document.getElementById("buzz-launch");
    if (!node) return;
    node.remove();
    for (const id of ["root", "buzz-toast-root"]) {
      document.getElementById(id)?.removeAttribute("inert");
      document.getElementById(id)?.removeAttribute("aria-hidden");
    }
    launch.disconnect();
  });
  launch.observe(document, { childList: true, subtree: true });

  let channel = "alpha";
  const region = () =>
    document.querySelector('[aria-label="Channel message history"]');
  let current = { channelId: "alpha", trailing: undefined, aside: "tall" };
  const select = async (channelId, trailing, aside) => {
    current = { channelId, trailing, aside };
    for (let tries = 0; tries < 150; tries++) {
      const result = await window.fixtureNavigation
        ?.open({
          version: 1,
          kind: "page",
          pluginId: "fixture.session",
          pageId: "reader",
          route: {
            version: 1,
            params: {
              channelId,
              ...(trailing ? { trailing } : {}),
              ...(aside ? { aside } : {}),
            },
          },
        })
        .catch(() => undefined);
      if (result?.status === "opened") {
        channel = channelId;
        return;
      }
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  };
  const jump = () =>
    [...(region()?.querySelectorAll("button") ?? [])]
      .find((button) => /Jump to latest|new message/.test(button.textContent))
      ?.click();

  const build = () => {
    const panel = document.createElement("div");
    panel.id = "aside-playground";
    panel.innerHTML = `
      <style>
        #aside-playground { position: fixed; left: 12px; bottom: 12px; z-index: 100000;
          width: 230px; padding: 10px; border-radius: 10px; background: #1b1d22f2; color: #fff;
          font: 13px/1.35 system-ui, sans-serif; box-shadow: 0 6px 24px #0006; }
        #aside-playground b { display: block; margin-top: 8px; font-size: 11px; opacity: .7; text-transform: uppercase; letter-spacing: .04em; }
        #aside-playground .state { font-size: 24px; font-weight: 700; margin: 2px 0 0; }
        #aside-playground .detail { font: 11px/1.3 ui-monospace, monospace; opacity: .75; margin-bottom: 8px; }
        #aside-playground button { display: block; width: 100%; margin: 4px 0 0; padding: 5px 8px;
          border: 1px solid #fff3; border-radius: 6px; background: #2c3038; color: #fff; font: inherit; text-align: left; cursor: pointer; }
        #aside-playground button:hover { background: #3a3f49; }
        #aside-playground label { display: flex; gap: 6px; align-items: center; margin-top: 8px; }
        #aside-playground .note { font-size: 11px; opacity: .7; min-height: 1.3em; margin-top: 6px; }
      </style>
      <b>Sticky aside playground</b>
      <div class="state">…</div>
      <div class="detail"></div>
      <b>Transcript</b>
      <button data-action="long">Long chat (640 messages)</button>
      <button data-action="short">Short chat (3 messages)</button>
      <b>Dashboard widget</b>
      <button data-action="tall">Taller than the window</button>
      <button data-action="shortAside">Shorter than the window</button>
      <button data-action="noAside">No widget</button>
      <b>3.b decision card</b>
      <button data-action="card">Toggle decision card</button>
      <b>Events</b>
      <button data-action="append">Add a new message</button>
      <button data-action="jump">Jump to latest</button>
      <label><input type="checkbox" data-action="reduced"> Reduced motion</label>
      <div class="note"></div>`;
    document.body.append(panel);
    const note = (text) => {
      panel.querySelector(".note").textContent = text;
    };
    const reducedBox = panel.querySelector("input");
    reducedBox.checked = reduced();
    const go = (patch, text) =>
      select(
        patch.channelId ?? current.channelId,
        "trailing" in patch ? patch.trailing : current.trailing,
        "aside" in patch ? patch.aside : current.aside,
      ).then(() => note(text));
    const actions = {
      async append() {
        const response = await fetch("/__playground/append", {
          method: "POST",
          body: JSON.stringify({ channel }),
        });
        note(response.ok ? `Added to #${channel}` : "Append failed");
      },
      jump() {
        jump();
        note("Jump to latest");
      },
      long: () => go({ channelId: "alpha" }, "Long chat"),
      short: () => go({ channelId: "beta" }, "Short chat"),
      tall: () => go({ aside: "tall" }, "Widget taller than the window"),
      shortAside: () =>
        go({ aside: "short" }, "Widget shorter than the window"),
      noAside: () => go({ aside: undefined }, "No widget"),
      card: () =>
        go(
          { trailing: current.trailing ? undefined : "long" },
          current.trailing ? "Card removed" : "Decision card added",
        ),
      reduced() {
        localStorage.setItem(
          "playground.reduced",
          reducedBox.checked ? "1" : "0",
        );
        note(reducedBox.checked ? "Reduced motion on" : "Reduced motion off");
      },
    };
    panel.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (action) actions[action]();
    });
    reducedBox.addEventListener("change", () => actions.reduced());

    const state = panel.querySelector(".state");
    const detail = panel.querySelector(".detail");
    const frame = () => {
      const element = region();
      const widget = element?.querySelector('[aria-label="Fixture dashboard"]');
      const card = element?.querySelector('[aria-label="Fixture card"]');
      if (!element) {
        state.textContent = "Loading";
        detail.textContent = "";
      } else {
        const maxTop = element.scrollHeight - element.clientHeight;
        const view = element.getBoundingClientRect();
        const box = widget?.getBoundingClientRect();
        const past = Number(element.dataset.prototypePast ?? 0);
        state.textContent =
          maxTop - element.scrollTop <= 1
            ? "End"
            : past > 1
              ? "Past latest"
              : past >= -1
                ? "Latest"
                : "History";
        detail.textContent =
          `#${channel} · top ${Math.round(element.scrollTop)} / ${Math.round(maxTop)}` +
          (box
            ? ` · widget ${Math.round(box.top - view.top)}..${Math.round(box.bottom - view.top)} of ${Math.round(view.height)}`
            : "") +
          (card ? " · card" : "");
      }
      requestAnimationFrame(frame);
    };
    requestAnimationFrame(frame);
  };
  addEventListener("DOMContentLoaded", () => {
    build();
    select("alpha", undefined, "tall");
  });
}

test("sticky aside playground", async ({ page, app }) => {
  test.skip(!process.env.ASIDE_PLAYGROUND, "Manual review server only");
  test.setTimeout(0);
  await open(page, app);
  const seed = await page.evaluate(
    (keys) =>
      Object.fromEntries(keys.map((key) => [key, localStorage.getItem(key)])),
    ["buzzodz.plugins.v1", `buzz-client.v1:${app.viewer}`],
  );
  await page.goto("about:blank");
  const target = new URL(app.origin);
  const script = `(${boot})(${JSON.stringify(seed)});`;
  let arrivals = 0;
  const server = http.createServer((req, res) => {
    if (req.url === "/__playground/boot.js") {
      res.writeHead(200, {
        "Content-Type": "text/javascript",
        "Cache-Control": "no-store",
      });
      return res.end(script);
    }
    if (req.url === "/__playground/append" && req.method === "POST") {
      let body = "";
      req.on("data", (chunk) => (body += chunk));
      req.on("end", () => {
        const { channel = "alpha" } = JSON.parse(body || "{}");
        app.append(
          "primary",
          channel,
          `New message ${++arrivals}, sent while you were reading`,
          true,
          false,
        );
        res.writeHead(204).end();
      });
      return;
    }
    const headers = { ...req.headers, host: target.host };
    delete headers["accept-encoding"];
    if (headers.origin) headers.origin = target.origin;
    if (headers.referer)
      headers.referer = headers.referer.replace(
        /^http:\/\/[^/]+/,
        target.origin,
      );
    const upstream = http.request(
      {
        host: target.hostname,
        port: target.port,
        method: req.method,
        path: req.url,
        headers,
      },
      (response) => {
        if (!(response.headers["content-type"] ?? "").includes("text/html")) {
          res.writeHead(response.statusCode, response.headers);
          return response.pipe(res);
        }
        let html = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => (html += chunk));
        response.on("end", () => {
          const { "content-length": _, ...rest } = response.headers;
          res.writeHead(response.statusCode, {
            ...rest,
            "cache-control": "no-store",
          });
          res.end(
            html.replace(
              "<head>",
              '<head><script src="/__playground/boot.js"></script>',
            ),
          );
        });
      },
    );
    upstream.on("error", () => {
      if (!res.headersSent) res.writeHead(502);
      res.end();
    });
    res.on("close", () => upstream.destroy());
    req.pipe(upstream);
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(PORT, "127.0.0.1", resolve);
  });
  console.log(`PLAYGROUND http://127.0.0.1:${PORT}/ (fixture ${app.origin})`);
  await new Promise(() => {});
});
