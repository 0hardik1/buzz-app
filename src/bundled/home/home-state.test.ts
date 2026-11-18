// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { readView, writeView } from "../../shared/view-state";
import {
  composerSchema as schema,
  projectComposerDocument,
} from "../../features/messages/composer-document";
import { composerMarkdown } from "../../features/messages/composer-markdown";
import { mentionDraft } from "../../features/messages/mention-draft";
import { canvasKey, readObjects, updateObjects } from "./canvas-state";
import { stageBestieRequest } from "./bestie-request";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

it("restores arranged objects only in their saved account/community and preserves an empty canvas", () => {
  updateObjects("community:viewer", () => [
    {
      id: "note",
      kind: "note",
      name: "Note",
      x: -40,
      y: 90,
      text: "A thought",
    },
  ]);
  expect(readObjects("community:viewer")).toEqual([
    {
      id: "note",
      kind: "note",
      name: "Note",
      x: -40,
      y: 90,
      text: "A thought",
    },
  ]);
  expect(
    readObjects("community:other").some((item) => item.kind === "note"),
  ).toBe(false);
  updateObjects("community:viewer", () => []);
  expect(readObjects("community:viewer")).toEqual([]);
});

it("reports a failed save without silently replacing the durable canvas", () => {
  writeView("scope", canvasKey, []);
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Quota exceeded", "QuotaExceededError");
  });
  expect(() =>
    updateObjects("scope", () => [
      { id: "x", kind: "clock", name: "Clock", x: 0, y: 0 },
    ]),
  ).toThrow("could not be saved");
  expect(readObjects("scope")).toEqual([]);
});

it("brings the anchored feed into saved arrangements and remembers moving or removing it", () => {
  const note = {
    id: "note",
    kind: "note",
    name: "Note",
    x: -40,
    y: 90,
    text: "Keep me",
  };
  writeView("scope", "home:canvas:v1", [note]);
  expect(readObjects("scope")).toEqual([
    { id: "attention", kind: "attention", name: "For you", x: -280, y: 0 },
    note,
  ]);
  updateObjects("scope", (items) =>
    items.map((item) =>
      item.kind === "attention" ? { ...item, x: 32, y: 64 } : item,
    ),
  );
  expect(
    readObjects("scope").find((item) => item.kind === "attention"),
  ).toMatchObject({ x: 32, y: 64 });
  updateObjects("scope", (items) =>
    items.filter((item) => item.kind !== "attention"),
  );
  expect(readObjects("scope")).toEqual([note]);
  writeView("old-empty", "home:canvas:v1", []);
  expect(readObjects("old-empty").map((item) => item.kind)).toEqual([
    "attention",
  ]);
  updateObjects("old-empty", () => []);
  expect(readObjects("old-empty")).toEqual([]);
});

it("adds Bestie source context without losing formatting or explicit notification intent, and avoids duplicates", () => {
  const recipient = "a".repeat(64);
  const doc = schema.nodes.doc.create(
    null,
    schema.nodes.paragraph.create(null, [
      schema.text("Keep this", [schema.marks.bold.create()]),
      schema.text(" "),
      schema.nodes.token.create({
        source: "@Avery",
        recipient: { pubkey: recipient, name: "Avery" },
      }),
    ]),
  );
  const original = projectComposerDocument(doc).draft;
  writeView("scope", "draft:bestie", original);
  stageBestieRequest("scope", "bestie", "source", "b".repeat(64));
  const staged = mentionDraft(readView("scope", "draft:bestie", null));
  const markdown = composerMarkdown(staged);
  expect(markdown).toContain("**Keep this**");
  expect(staged.recipients).toEqual(original.recipients);
  expect(markdown).toContain(
    `buzz://message?channel=source&id=${"b".repeat(64)}`,
  );
  stageBestieRequest("scope", "bestie", "source", "b".repeat(64));
  expect(
    composerMarkdown(mentionDraft(readView("scope", "draft:bestie", null))),
  ).toBe(markdown);
  expect(readView("other", "draft:bestie", null)).toBeNull();
});
