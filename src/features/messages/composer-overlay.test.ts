// @vitest-environment jsdom
import { afterEach, expect, it } from "vitest";
import { overlayHost, registerOverlayComposer } from "./composer-overlay";
import { setThreadPlacementPreference } from "./thread-preferences";

afterEach(() => document.body.replaceChildren());

it("finds a composer by name and opens over it outside its sheet once it attaches", () => {
  const reader = document.createElement("section");
  reader.dataset.composerHost = "";
  const composer = document.createElement("form");
  reader.append(composer);
  // React can register the editor before its portal attaches.
  const release = registerOverlayComposer("channel:C", composer);
  try {
    expect(overlayHost("channel:C")).toBeNull();
    const layer = document.createElement("div");
    layer.dataset.detailsSheet = "";
    const sheet = document.createElement("div");
    sheet.append(reader);
    layer.append(sheet);
    document.body.append(layer);
    const nested = overlayHost("channel:C");
    expect(nested?.container).toBe(document.body);
    expect(nested?.composer).toBe(composer);
    expect(nested?.pane).toBe(reader);
  } finally {
    release();
  }
  expect(overlayHost("channel:C")).toBeNull();
});

it("opens nothing over a composer unless threads and details open inline", () => {
  const reader = document.createElement("section");
  reader.dataset.composerHost = "";
  const composer = document.createElement("form");
  reader.append(composer);
  document.body.append(reader);
  const release = registerOverlayComposer("channel:C", composer);
  try {
    expect(overlayHost("channel:C")?.composer).toBe(composer);
    setThreadPlacementPreference("side");
    expect(overlayHost("channel:C")).toBeNull();
  } finally {
    release();
    localStorage.clear();
  }
});
