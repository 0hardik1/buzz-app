import { expect, test } from "vitest";
import {
  type Mode,
  normal,
  press,
  REDO,
  type Range,
  type Register,
  selection,
  type Vim,
} from "./editing";

/** Type `keys` in `start`, whose `|` marks the cursor; the text after, with
 * `|` at the cursor, and the mode. `<C-r>` and `<Esc>` are single keys. */
function vim(
  start: string,
  keys: string,
  { atoms = [] as Range[], mode = "normal" as Mode } = {},
) {
  let text = start.replace("|", "");
  let state: Vim = { ...normal(start.indexOf("|")), mode };
  let register: Register | undefined;
  const history: string[] = [];
  for (const key of keys.match(/<C-r>|<Esc>|./gu) ?? []) {
    const result = press(
      state,
      { text, atoms },
      key === "<Esc>" ? "Escape" : key,
      register,
    );
    if (result.edit)
      text =
        text.slice(0, result.edit.start) +
        result.edit.text +
        text.slice(result.edit.end);
    if (result.history)
      history.push(
        `${result.history.redo ? "redo" : "undo"}×${result.history.times}`,
      );
    register = result.register ?? register;
    state = result.vim;
  }
  const shown =
    state.mode === "visual" || state.mode === "visual-line"
      ? selection(state, { text, atoms })
      : undefined;
  return {
    text: `${text.slice(0, state.cursor)}|${text.slice(state.cursor)}`,
    mode: state.mode,
    register: register?.text,
    selected: shown && text.slice(shown.start, shown.end),
    history,
  };
}

test("motions move by characters, words and lines, with counts", () => {
  expect(vim("|hello world", "l").text).toBe("h|ello world");
  expect(vim("|hello world", "5l").text).toBe("hello| world");
  expect(vim("|hello world", "20l").text).toBe("hello worl|d");
  expect(vim("hel|lo", "h0").text).toBe("|hello");
  expect(vim("  |hi there", "$").text).toBe("  hi ther|e");
  expect(vim("  hi th|ere", "^").text).toBe("  |hi there");
  expect(vim("|one two, three", "w").text).toBe("one |two, three");
  expect(vim("|one two, three", "2w").text).toBe("one two|, three");
  expect(vim("one two, |three", "b").text).toBe("one two|, three");
  expect(vim("|one two", "e").text).toBe("on|e two");
  expect(vim("|one two", "2e").text).toBe("one tw|o");
  // Down and up keep the column, short lines clamp it.
  expect(vim("ab|cd\nx\nefgh", "j").text).toBe("abcd\n|x\nefgh");
  expect(vim("ab|cd\nx\nefgh", "2j").text).toBe("abcd\nx\nef|gh");
  expect(vim("abcd\nx\nef|gh", "2k").text).toBe("ab|cd\nx\nefgh");
  expect(vim("a\n  b\n|c", "gg").text).toBe("|a\n  b\nc");
  expect(vim("|a\n  b\nc", "G").text).toBe("a\n  b\n|c");
  expect(vim("|a\n  b\nc", "2G").text).toBe("a\n  |b\nc");
  // w crosses lines and stops on an empty one.
  expect(vim("|ab\n\ncd", "w").text).toBe("ab\n|\ncd");
});

test("operators delete and yank over motions, lines and counts", () => {
  expect(vim("|one two three", "dw")).toMatchObject({
    text: "|two three",
    register: "one ",
  });
  expect(vim("|one two three", "d2w").text).toBe("|three");
  expect(vim("|one two three", "2dw").text).toBe("|three");
  // dw on a line's last word keeps the line break.
  expect(vim("one |two\nthree", "dw").text).toBe("one| \nthree");
  expect(vim("one |two three", "d$").text).toBe("one| ");
  expect(vim("one |two three", "D").text).toBe("one| ");
  expect(vim("|abc", "dl").text).toBe("|bc");
  expect(vim("|abcdef", "3x")).toMatchObject({ text: "|def", register: "abc" });
  expect(vim("ab|c", "x").text).toBe("a|b");
  expect(vim("a\n|b\nc\nd", "dd")).toMatchObject({
    text: "a\n|c\nd",
    register: "b\n",
  });
  expect(vim("a\n|b\nc\nd", "3dd").text).toBe("|a");
  expect(vim("a\nb\n|c", "dd").text).toBe("a\n|b");
  expect(vim("a\n|b\nc", "dj").text).toBe("|a");
  expect(vim("one |two", "yw")).toMatchObject({
    text: "one |two",
    register: "two",
  });
  expect(vim("one |two", "yb")).toMatchObject({
    text: "|one two",
    register: "one ",
  });
});

test("p and P put the register after and before, by character or line", () => {
  expect(vim("|one two", "dwP").text).toBe("one| two");
  expect(vim("|ab", "xp").text).toBe("b|a");
  expect(vim("|a\nb", "yyp").text).toBe("a\n|a\nb");
  expect(vim("|a\nb", "yyjP").text).toBe("a\n|a\nb");
  expect(vim("|a\nb", "dd2p").text).toBe("b\n|a\na");
  expect(vim("|a", "p").text).toBe("|a");
});

test("i, a, I, A, o and O enter insert mode where Vim does", () => {
  expect(vim("ab|c", "i")).toMatchObject({ text: "ab|c", mode: "insert" });
  expect(vim("ab|c", "a").text).toBe("abc|");
  expect(vim("  a|bc", "I").text).toBe("  |abc");
  expect(vim("a|bc\nd", "A").text).toBe("abc|\nd");
  expect(vim("a|bc\nd", "o").text).toBe("abc\n|\nd");
  expect(vim("abc\n|d", "O").text).toBe("abc\n|\nd");
  // Escape leaves insert mode one character back, as Vim does.
  expect(vim("abc|", "<Esc>", { mode: "insert" })).toMatchObject({
    text: "ab|c",
    mode: "normal",
  });
  expect(vim("a\n|b", "<Esc>", { mode: "insert" }).text).toBe("a\n|b");
  // Other keys in insert mode are the editor's.
  expect(
    press({ ...normal(0), mode: "insert" }, { text: "", atoms: [] }, "x")
      .handled,
  ).toBe(false);
});

test("u and Ctrl-r use the editor's history; Escape cancels a command", () => {
  expect(vim("|a", "u").history).toEqual(["undo×1"]);
  expect(vim("|a", `3u${REDO}`).history).toEqual(["undo×3", "redo×1"]);
  expect(vim("|one two", "d<Esc>w").text).toBe("one |two");
  // Escape with nothing pending is not Vim's: it leaves the field.
  expect(press(normal(0), { text: "", atoms: [] }, "Escape").handled).toBe(
    false,
  );
});

test("visual modes select, extend with motions, delete and yank", () => {
  expect(vim("|one two", "vw")).toMatchObject({
    mode: "visual",
    selected: "one t",
  });
  expect(vim("|one two", "vwd")).toMatchObject({
    text: "|wo",
    mode: "normal",
    register: "one t",
  });
  expect(vim("one |two", "vhhx").text).toBe("on|wo");
  expect(vim("|one two", "vey")).toMatchObject({
    text: "|one two",
    register: "one",
  });
  expect(vim("a\n|b\nc", "Vj")).toMatchObject({
    mode: "visual-line",
    selected: "b\nc",
  });
  expect(vim("a\n|b\nc", "Vjd").text).toBe("|a");
  expect(vim("a\n|b\nc", "Vy")).toMatchObject({ register: "b\n" });
  expect(vim("a|b", "v<Esc>").mode).toBe("normal");
  expect(vim("a|b", "vV").mode).toBe("visual-line");
  expect(vim("a|b", "Vv").mode).toBe("visual");
  expect(vim("a|b", "VV").mode).toBe("normal");
});

test("J and K in visual line mode move the lines and keep them selected", () => {
  expect(vim("|a\nb\nc", "VJ")).toMatchObject({
    text: "b\n|a\nc",
    mode: "visual-line",
    selected: "a",
  });
  expect(vim("|a\nb\nc\nd", "VjJ")).toMatchObject({
    text: "c\na\n|b\nd",
    selected: "a\nb",
  });
  expect(vim("a\nb\n|c", "VK").selected).toBe("c");
  expect(vim("a\nb\n|c", "VK").text).toBe("a\n|c\nb");
  expect(vim("a\nb\n|c", "V2K").text).toBe("|c\na\nb");
  // At the edge they stay put.
  expect(vim("a\n|b", "VJ").text).toBe("a\n|b");
  expect(vim("|a\nb", "VK").text).toBe("|a\nb");
});

test("an atom such as a mention chip moves and deletes as a whole", () => {
  const atoms = [{ start: 3, end: 9 }];
  expect(vim("hi |@alice ok", "l", { atoms }).text).toBe("hi @alice| ok");
  expect(vim("hi @alice| ok", "h", { atoms }).text).toBe("hi |@alice ok");
  expect(vim("hi |@alice ok", "x", { atoms }).text).toBe("hi | ok");
  expect(vim("h|i @alice ok", "d3l", { atoms }).text).toBe("h| ok");
});
