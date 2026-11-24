/*
 * Vim's modes over plain text: a pure engine that reads a key and returns
 * the next state and, at most, one edit. Each edit is one undo step in the
 * editor. Positions are offsets in the text; in normal mode the cursor is on
 * the character at its offset, as Vim's block cursor is.
 */
export type Mode = "normal" | "insert" | "visual" | "visual-line";
export type Range = Readonly<{ start: number; end: number }>;
/** The unnamed register: what `d`, `x` and `y` saved, for `p` and `P`. */
export type Register = Readonly<{ text: string; linewise: boolean }>;
export type Vim = Readonly<{
  mode: Mode;
  cursor: number;
  /** Where a visual selection began; the cursor is its moving end. */
  anchor: number;
  /** Keys of a command still being typed, such as `3d`. */
  typed: readonly string[];
  /** The column `j` and `k` keep, as Vim's curswant; Infinity after `$`. */
  column?: number | undefined;
}>;
/** The text and its atoms: ranges such as mention chips that move and
 * delete only as a whole. */
export type Buffer = Readonly<{ text: string; atoms: readonly Range[] }>;
export type Result = Readonly<{
  vim: Vim;
  /** Replace `start`..`end` with `text`. The cursor is already after it. */
  edit?: Range & { text: string };
  /** Run the editor's own undo or redo this many times. */
  history?: Readonly<{ redo: boolean; times: number }>;
  register?: Register;
  /** False: the key is not Vim's here, so it keeps its usual meaning. */
  handled: boolean;
}>;

export const REDO = "<C-r>";
const MOTIONS = new Set(["h", "l", "j", "k", "w", "b", "e", "0", "^", "$"]);
const OPERATORS = new Set(["d", "y"]);
type Kind = "exclusive" | "inclusive" | "linewise";

export const normal = (cursor = 0): Vim => ({
  mode: "normal",
  cursor,
  anchor: cursor,
  typed: [],
});
export const insert = (cursor: number): Vim => ({
  mode: "insert",
  cursor,
  anchor: cursor,
  typed: [],
});

const lineStart = (text: string, at: number) =>
  text.lastIndexOf("\n", at - 1) + 1;
const lineEnd = (text: string, at: number) => {
  const end = text.indexOf("\n", at);
  return end < 0 ? text.length : end;
};
/** The start of each line. */
const lineStarts = (text: string) => {
  const starts = [0];
  for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", at + 1))
    starts.push(at + 1);
  return starts;
};
const lineOf = (text: string, at: number) =>
  lineStarts(text).filter((start) => start <= at).length - 1;
/** The last character of the line, or its start when it is empty. */
const lastChar = (text: string, at: number) =>
  Math.max(lineStart(text, at), lineEnd(text, at) - 1);
const firstNonBlank = (text: string, at: number) => {
  const end = lineEnd(text, at);
  let index = lineStart(text, at);
  while (index < end && (text[index] === " " || text[index] === "\t")) index++;
  return Math.min(index, lastChar(text, at));
};

/** Word classes: blank, keyword and other punctuation, as Vim's `w`. */
const kind = (char: string | undefined) =>
  char === undefined || /\s/.test(char)
    ? 0
    : /[\p{L}\p{N}_]/u.test(char)
      ? 1
      : 2;
/** An empty line is a word of its own. */
const emptyLine = (text: string, at: number) =>
  text[at] === "\n" && (at === 0 || text[at - 1] === "\n");

function wordForward(text: string, from: number) {
  let at = from;
  const start = kind(text[at]);
  if (start) while (at < text.length && kind(text[at]) === start) at++;
  else if (text[at] === "\n") at++;
  while (at < text.length && !kind(text[at]) && !emptyLine(text, at)) at++;
  return at;
}
function wordBackward(text: string, from: number) {
  let at = from - 1;
  while (at > 0 && !kind(text[at]) && !emptyLine(text, at)) at--;
  if (at <= 0) return 0;
  const start = kind(text[at]);
  if (start) while (at > 0 && kind(text[at - 1]) === start) at--;
  return at;
}
function wordEnd(text: string, from: number) {
  let at = from + 1;
  while (at < text.length && !kind(text[at])) at++;
  const start = kind(text[at]);
  while (at + 1 < text.length && kind(text[at + 1]) === start) at++;
  return Math.min(at, Math.max(0, text.length - 1));
}

/** Where a move lands: never inside an atom, nor past the line's end. */
function land(buffer: Buffer, at: number, forward: boolean, mode: Mode) {
  const { text, atoms } = buffer;
  const inside = (spot: number) =>
    atoms.find((atom) => atom.start < spot && spot < atom.end);
  let spot = Math.max(0, Math.min(at, text.length));
  const atom = inside(spot);
  if (atom) spot = forward ? atom.end : atom.start;
  if (mode !== "insert") spot = Math.min(spot, lastChar(text, spot));
  return inside(spot)?.start ?? spot;
}
/** Grow a range over every atom it cuts into. */
function whole(buffer: Buffer, range: Range): Range {
  let { start, end } = range;
  for (const atom of buffer.atoms)
    if (atom.start < end && start < atom.end) {
      start = Math.min(start, atom.start);
      end = Math.max(end, atom.end);
    }
  return { start, end };
}

type Motion = { at: number; kind: Kind; column?: number | undefined };

/** Where a motion goes from the cursor, `count` times. */
function motion(
  buffer: Buffer,
  vim: Vim,
  key: string,
  count: number | undefined,
  operator?: string,
): Motion {
  const { text } = buffer;
  const from = vim.cursor;
  const times = count ?? 1;
  const start = lineStart(text, from);
  const end = lineEnd(text, from);
  switch (key) {
    case "h":
      return { at: Math.max(start, from - times), kind: "exclusive" };
    case "l":
      return { at: Math.min(end, from + times), kind: "exclusive" };
    case "0":
      return { at: start, kind: "exclusive" };
    case "^":
      return { at: firstNonBlank(text, from), kind: "exclusive" };
    case "$": {
      const starts = lineStarts(text);
      const line = Math.min(lineOf(text, from) + times - 1, starts.length - 1);
      return {
        at: lineEnd(text, starts[line] ?? 0),
        kind: "exclusive",
        column: Number.POSITIVE_INFINITY,
      };
    }
    case "w": {
      let at = from;
      for (let step = 0; step < times; step++) {
        const next = wordForward(text, at);
        // `dw` on a line's last word stops at the line's end.
        if (
          operator &&
          step === times - 1 &&
          lineStart(text, next) !== lineStart(text, at)
        )
          return { at: Math.max(at, lineEnd(text, at)), kind: "exclusive" };
        at = next;
      }
      return { at, kind: "exclusive" };
    }
    case "b": {
      let at = from;
      for (let step = 0; step < times; step++) at = wordBackward(text, at);
      return { at, kind: "exclusive" };
    }
    case "e": {
      let at = from;
      for (let step = 0; step < times; step++) at = wordEnd(text, at);
      return { at, kind: "inclusive" };
    }
    case "j":
    case "k":
    case "gg":
    case "G": {
      const starts = lineStarts(text);
      const current = lineOf(text, from);
      const line = Math.max(
        0,
        Math.min(
          starts.length - 1,
          key === "j"
            ? current + times
            : key === "k"
              ? current - times
              : count !== undefined
                ? count - 1
                : key === "gg"
                  ? 0
                  : starts.length - 1,
        ),
      );
      const target = starts[line] ?? 0;
      if (key === "gg" || key === "G")
        return { at: firstNonBlank(text, target), kind: "linewise" };
      const column = vim.column ?? from - start;
      return {
        at: Math.min(target + column, lastChar(text, target)),
        kind: "linewise",
        column,
      };
    }
  }
  return { at: from, kind: "exclusive" };
}

/** The whole lines from `from`'s to `to`'s, and the range that deletes them. */
function lines(text: string, from: number, to: number) {
  const start = lineStart(text, Math.min(from, to));
  const end = lineEnd(text, Math.max(from, to));
  const register: Register = {
    text: `${text.slice(start, end)}\n`,
    linewise: true,
  };
  const range =
    end < text.length
      ? { start, end: end + 1 }
      : { start: Math.max(0, start - 1), end };
  return { start, end, range, register };
}

const splice = (text: string, range: Range, insert = "") =>
  text.slice(0, range.start) + insert + text.slice(range.end);

/** Delete or yank a range; the cursor ends at its start, on its line. */
function operate(
  buffer: Buffer,
  vim: Vim,
  operator: string,
  range: Range,
  register: Register,
  linewise: boolean,
  cursorAfterYank = range.start,
): Result {
  if (operator === "y")
    return {
      vim: { ...normal(cursorAfterYank) },
      register,
      handled: true,
    };
  const text = splice(buffer.text, range);
  // After deleting the last lines, the range starts at the end of the line
  // above, which is where the cursor goes.
  const at = Math.min(range.start, text.length);
  const cursor = linewise
    ? firstNonBlank(text, at)
    : Math.min(at, lastChar(text, at));
  return {
    vim: { ...vim, ...normal(cursor) },
    edit: { ...range, text: "" },
    register,
    handled: true,
  };
}

/** A count, then the rest of the command, or undefined while it is typed. */
function parse(typed: readonly string[]) {
  let index = 0;
  let digits = "";
  while (
    /^[0-9]$/.test(typed[index] ?? "") &&
    !(digits === "" && typed[index] === "0")
  )
    digits += typed[index++];
  return {
    count: digits ? Number(digits) : undefined,
    rest: typed.slice(index),
  };
}

/** The motion at the start of `keys`: complete, partial (`g`) or none. */
function readMotion(keys: readonly string[]) {
  const [first, second] = keys;
  if (first === undefined) return { pending: true } as const;
  if (MOTIONS.has(first) || first === "G")
    return { key: first, length: 1 } as const;
  if (first === "g") {
    if (second === undefined) return { pending: true } as const;
    if (second === "g") return { key: "gg", length: 2 } as const;
  }
  return {} as const;
}

const multiply = (a?: number, b?: number) =>
  a === undefined && b === undefined ? undefined : (a ?? 1) * (b ?? 1);

/** Feed one key to the engine. `register` is the unnamed register. */
export function press(
  vim: Vim,
  buffer: Buffer,
  key: string,
  register?: Register,
): Result {
  if (vim.mode === "insert") {
    if (key !== "Escape") return { vim, handled: false };
    const back = Math.max(lineStart(buffer.text, vim.cursor), vim.cursor - 1);
    return { vim: normal(land(buffer, back, false, "normal")), handled: true };
  }
  if (vim.mode === "normal") return normalKey(vim, buffer, key, register);
  return visualKey(vim, buffer, key);
}

function normalKey(
  vim: Vim,
  buffer: Buffer,
  key: string,
  register?: Register,
): Result {
  const { text } = buffer;
  if (key === "Escape")
    return { vim: { ...vim, typed: [] }, handled: vim.typed.length > 0 };
  const typed = [...vim.typed, key];
  const { count, rest } = parse(typed);
  const done = (next: Partial<Vim>, extra: Partial<Result> = {}): Result => ({
    vim: { ...vim, typed: [], ...next },
    handled: true,
    ...extra,
  });
  const waiting = { vim: { ...vim, typed }, handled: true };
  const [command, ...after] = rest;
  if (command === undefined) return waiting;
  const cursor = vim.cursor;
  const start = lineStart(text, cursor);
  const end = lineEnd(text, cursor);

  if (command !== undefined && OPERATORS.has(command)) {
    const inner = parse(after);
    const total = multiply(count, inner.count);
    if (inner.rest[0] === command) {
      // dd, yy: whole lines.
      const starts = lineStarts(text);
      const last =
        starts[
          Math.min(lineOf(text, cursor) + (total ?? 1) - 1, starts.length - 1)
        ] ?? 0;
      const span = lines(text, cursor, last);
      return operate(
        buffer,
        vim,
        command,
        span.range,
        span.register,
        true,
        cursor,
      );
    }
    const found = readMotion(inner.rest);
    if ("pending" in found) return waiting;
    if (!("key" in found)) return done({});
    const moved = motion(buffer, vim, found.key, total, command);
    if (moved.kind === "linewise") {
      const span = lines(text, cursor, moved.at);
      return operate(
        buffer,
        vim,
        command,
        span.range,
        span.register,
        true,
        Math.min(cursor, moved.at),
      );
    }
    const range = whole(buffer, {
      start: Math.min(cursor, moved.at),
      end: Math.max(cursor, moved.at) + (moved.kind === "inclusive" ? 1 : 0),
    });
    if (range.end <= range.start) return done({});
    return operate(
      buffer,
      vim,
      command,
      range,
      {
        text: text.slice(range.start, range.end),
        linewise: false,
      },
      false,
    );
  }

  const found = readMotion(rest);
  if ("pending" in found) return waiting;
  if ("key" in found) {
    const moved = motion(buffer, vim, found.key, count);
    return done({
      cursor: land(buffer, moved.at, moved.at > cursor, "normal"),
      column: moved.column,
    });
  }

  switch (command) {
    case "x":
    case "D": {
      const range = whole(buffer, {
        start: cursor,
        end: command === "D" ? end : Math.min(end, cursor + (count ?? 1)),
      });
      if (range.end <= range.start) return done({});
      return operate(
        buffer,
        vim,
        "d",
        range,
        {
          text: text.slice(range.start, range.end),
          linewise: false,
        },
        false,
      );
    }
    case "p":
    case "P": {
      if (!register) return done({});
      const times = count ?? 1;
      if (register.linewise) {
        const body = Array(times)
          .fill(register.text.replace(/\n$/, ""))
          .join("\n");
        const at = command === "p" ? end : start;
        const insertText = command === "p" ? `\n${body}` : `${body}\n`;
        const next = splice(text, { start: at, end: at }, insertText);
        const line = command === "p" ? at + 1 : at;
        return done(normal(firstNonBlank(next, line)), {
          edit: { start: at, end: at, text: insertText },
        });
      }
      const body = register.text.repeat(times);
      const at = land(
        buffer,
        command === "p" && end > start ? cursor + 1 : cursor,
        true,
        "insert",
      );
      return done(normal(Math.max(at, at + body.length - 1)), {
        edit: { start: at, end: at, text: body },
      });
    }
    case "u":
      return done({}, { history: { redo: false, times: count ?? 1 } });
    case REDO:
      return done({}, { history: { redo: true, times: count ?? 1 } });
    case "i":
      return done(insert(cursor));
    case "a":
      return done(
        insert(end > start ? land(buffer, cursor + 1, true, "insert") : cursor),
      );
    case "I": {
      let first = start;
      while (first < end && (text[first] === " " || text[first] === "\t"))
        first++;
      return done(insert(first));
    }
    case "A":
      return done(insert(end));
    case "o":
      return done(insert(end + 1), { edit: { start: end, end, text: "\n" } });
    case "O":
      return done(insert(start), { edit: { start, end: start, text: "\n" } });
    case "v":
    case "V":
      return done({
        mode: command === "v" ? "visual" : "visual-line",
        anchor: cursor,
      });
  }
  // Anything else does nothing, as Vim beeps.
  return done({});
}

/** The selection a visual mode shows, and what `d` and `y` act on. */
export function selection(vim: Vim, buffer: Buffer) {
  const { text } = buffer;
  const from = Math.min(vim.anchor, vim.cursor);
  const to = Math.max(vim.anchor, vim.cursor);
  if (vim.mode === "visual-line") {
    const span = lines(text, from, to);
    return {
      start: span.start,
      end: span.end,
      delete: span.range,
      register: span.register,
    };
  }
  const range = whole(buffer, {
    start: from,
    end: Math.min(text.length, to + 1),
  });
  return {
    ...range,
    delete: range,
    register: { text: text.slice(range.start, range.end), linewise: false },
  };
}

function visualKey(vim: Vim, buffer: Buffer, key: string): Result {
  const { text } = buffer;
  const done = (next: Partial<Vim>, extra: Partial<Result> = {}): Result => ({
    vim: { ...vim, typed: [], ...next },
    handled: true,
    ...extra,
  });
  if (key === "Escape") return done(normal(vim.cursor));
  const typed = [...vim.typed, key];
  const { count, rest } = parse(typed);
  const found = readMotion(rest);
  if ("pending" in found) return { vim: { ...vim, typed }, handled: true };
  if ("key" in found) {
    const moved = motion(buffer, vim, found.key, count);
    return done({
      cursor: land(buffer, moved.at, moved.at > vim.cursor, "normal"),
      column: moved.column,
    });
  }
  const selected = selection(vim, buffer);
  const linewise = vim.mode === "visual-line";
  switch (rest[0]) {
    case "d":
    case "x":
      return operate(
        buffer,
        vim,
        "d",
        selected.delete,
        selected.register,
        linewise,
      );
    case "y":
      return operate(
        buffer,
        vim,
        "y",
        selected.delete,
        selected.register,
        linewise,
        Math.min(vim.anchor, vim.cursor),
      );
    case "o":
      return done({ cursor: vim.anchor, anchor: vim.cursor });
    case "v":
      return done(
        vim.mode === "visual" ? normal(vim.cursor) : { mode: "visual" },
      );
    case "V":
      return done(
        vim.mode === "visual-line"
          ? normal(vim.cursor)
          : { mode: "visual-line" },
      );
    case "J":
    case "K":
      if (linewise) return moveLines(vim, text, rest[0] === "J", count ?? 1);
  }
  return done({});
}

/** `J` / `K` in visual line mode: move the selected lines down or up past
 * `count` lines, keeping them selected. */
function moveLines(
  vim: Vim,
  text: string,
  down: boolean,
  count: number,
): Result {
  const starts = lineStarts(text);
  const first = lineOf(text, Math.min(vim.anchor, vim.cursor));
  const last = lineOf(text, Math.max(vim.anchor, vim.cursor));
  const steps = Math.min(count, down ? starts.length - 1 - last : first);
  const same = { vim: { ...vim, typed: [] }, handled: true };
  if (steps <= 0) return same;
  const lineAt = (line: number) => starts[line] ?? 0;
  const blockStart = lineAt(first);
  const blockEnd = lineEnd(text, lineAt(last));
  const block = text.slice(blockStart, blockEnd);
  if (down) {
    const passedEnd = lineEnd(text, lineAt(last + steps));
    const passed = text.slice(blockEnd + 1, passedEnd);
    const shift = passed.length + 1;
    return {
      vim: {
        ...vim,
        typed: [],
        anchor: vim.anchor + shift,
        cursor: vim.cursor + shift,
      },
      edit: { start: blockStart, end: passedEnd, text: `${passed}\n${block}` },
      handled: true,
    };
  }
  const passedStart = lineAt(first - steps);
  const passed = text.slice(passedStart, blockStart - 1);
  const shift = passed.length + 1;
  return {
    vim: {
      ...vim,
      typed: [],
      anchor: vim.anchor - shift,
      cursor: vim.cursor - shift,
    },
    edit: { start: passedStart, end: blockEnd, text: `${block}\n${passed}` },
    handled: true,
  };
}

/** Keep a cursor read from the editor where the mode allows it. */
export function settle(vim: Vim, buffer: Buffer, cursor = vim.cursor): Vim {
  return { ...vim, cursor: land(buffer, cursor, false, vim.mode) };
}
