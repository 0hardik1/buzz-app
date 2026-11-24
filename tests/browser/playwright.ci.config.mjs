import assert from "node:assert/strict";
import { defineConfig } from "@playwright/test";
import config from "./playwright.config.mjs";

// Whole files preserve Playwright's suite and worker-fixture grouping. Discovery
// fails if an ordinary file imports native-fixture.mjs, even through a helper.
const nativeTests = ["conversation.spec.mjs", "plugin-cli-reload.spec.mjs"];
const nativeMode = process.env.BUZZ_BROWSER_NATIVE_TESTS || "all";
assert.ok(["all", "only", "exclude"].includes(nativeMode));
const nativeSelection = (project) =>
  nativeMode === "only"
    ? { testMatch: nativeTests }
    : nativeMode === "exclude"
      ? { testIgnore: [...project.testIgnore, ...nativeTests] }
      : {};

// Linux WebKit is built without MediaRecorder. Those cases run with the local
// config in the required macOS job; Chromium still records on Linux.
// The documented @local-webkit measurements remain local-only.
export default defineConfig({
  ...config,
  // Only the eight-core functional CI jobs opt into the extra worker.
  workers: Number(process.env.BUZZ_BROWSER_WORKERS || config.workers),
  projects: config.projects.map((project) =>
    project.name === "webkit-measurements"
      ? { ...project, grepInvert: /@local-webkit/ }
      : project.name === "webkit"
        ? {
            ...project,
            ...nativeSelection(project),
            grepInvert: /@classic-scrollbars|@media-recorder|@local-only/,
          }
        : project.name === "chromium"
          ? {
              ...project,
              ...nativeSelection(project),
              grepInvert: /@classic-scrollbars|@local-only/,
            }
          : project,
  ),
});
