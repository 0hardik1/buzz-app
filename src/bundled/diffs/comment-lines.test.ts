import { expect, it } from "vitest";
import { commentLines } from "./DiffViewer";
import { parsePatch } from "./parse";

it("preserves both context coordinates after insertions in a renamed file", () => {
  const files = parsePatch(`diff --git a/old.ts b/new.ts
similarity index 80%
rename from old.ts
rename to new.ts
--- a/old.ts
+++ b/new.ts
@@ -5000,2 +5000,3 @@
-old
+new
+inserted
 context
`);
  expect(files).toHaveLength(1);
  const file = files?.[0];
  if (!file) throw new Error("Missing parsed fixture");
  expect(commentLines(file)).toEqual([
    [{ side: "deletions", lineNumber: 5000 }],
    [{ side: "additions", lineNumber: 5000 }],
    [{ side: "additions", lineNumber: 5001 }],
    [
      { side: "deletions", lineNumber: 5001 },
      { side: "additions", lineNumber: 5002 },
    ],
  ]);
});
