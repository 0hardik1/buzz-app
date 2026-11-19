import type { FileData } from "./parse";
export type DiffLine = { side: "deletions" | "additions"; lineNumber: number };
/** Context retains both coordinates so selecting it never guesses a side. */
export function commentLines(file: FileData): DiffLine[][] {
  return file.hunks.flatMap((hunk) =>
    hunk.changes.map((change): DiffLine[] =>
      change.type === "normal"
        ? [
            { side: "deletions", lineNumber: change.oldLineNumber },
            { side: "additions", lineNumber: change.newLineNumber },
          ]
        : [
            {
              side: change.type === "delete" ? "deletions" : "additions",
              lineNumber: change.lineNumber,
            },
          ],
    ),
  );
}

export function commentableLine(file: FileData, line: DiffLine): boolean {
  return (
    !file.isBinary &&
    commentLines(file).some((row) =>
      row.some(
        (entry) =>
          entry.side === line.side && entry.lineNumber === line.lineNumber,
      ),
    )
  );
}
