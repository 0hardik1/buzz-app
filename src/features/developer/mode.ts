// DEV keeps packaged desktop builds out: they load a production bundle, where
// the bundler fixes it to false. The hostname would not, because their page is
// tauri://localhost on macOS and Linux. The hostname check is for a
// development server opened through another host (`--host`, a tunnel), which
// stays out. Outside a browser, as in Node tests, there is no hostname to check.
export const developerMode =
  import.meta.env.DEV &&
  typeof window !== "undefined" &&
  /^(localhost|127\.0\.0\.1)$/.test(window.location.hostname);
