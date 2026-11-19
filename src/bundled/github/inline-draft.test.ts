import { expect, it } from "vitest";
import { createInlineDraft } from "./inline-draft";
const target = {
  viewer: "example-reviewer",
  path: "src/example.ts",
  side: "LEFT",
  line: 5,
  head: "old",
  base: "base",
} as const;
it("locks synchronously and retains the captured anchor during edits", () => {
  const draft = createInlineDraft();
  draft.update({ body: "Keep this", target });
  expect(draft.begin()).toMatchObject({ body: "Keep this", target });
  expect(draft.begin()).toBeUndefined();
  expect(draft.get().target).toBe(target);
  draft.update({ busy: false, unknown: true });
  expect(draft.begin()).toBeUndefined();
  expect(draft.get().body).toBe("Keep this");
});
it("notifies subscribers and stops after unsubscribe", () => {
  const draft = createInlineDraft();
  let calls = 0;
  const stop = draft.subscribe(() => {
    calls += 1;
  });
  draft.update({ body: "retained" });
  stop();
  draft.update({ error: "Denied" });
  expect(calls).toBe(1);
  expect(draft.get().body).toBe("retained");
});
