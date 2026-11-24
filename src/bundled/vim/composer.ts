/*
 * Vim's modes in the message box. The editor's own text, selection, edits
 * and undo (`ComposerInputElement`) carry them out; `editing.ts` decides.
 * Focus entering the message box starts in insert mode, where every key is
 * the editor's. Escape there is normal mode, where no key types; Escape in
 * normal mode leaves, as before. The mode shows beside Send.
 */
import type { ComposerInputElement } from "../../features/messages/composer-dom";
import { setComposerStatus } from "../../features/messages/composer-status";
import {
  insert,
  type Mode,
  normal,
  press,
  REDO,
  type Register,
  selection,
  settle,
  type Vim,
} from "./editing";
import { WHICH_KEY } from "./pending";

const STATUS: Record<Mode, string> = {
  normal: "-- NORMAL --",
  insert: "-- INSERT --",
  visual: "-- VISUAL --",
  "visual-line": "-- VISUAL LINE --",
};
const SPOKEN: Record<Mode, string> = {
  normal: "Normal mode",
  insert: "Insert mode",
  visual: "Visual mode",
  "visual-line": "Visual line mode",
};
/** Named keys as Vim reads them in normal and visual modes; Enter does
 * nothing there. Tab and the rest keep their usual meaning. */
const NAMED: Record<string, string> = {
  ArrowLeft: "h",
  ArrowRight: "l",
  ArrowUp: "k",
  ArrowDown: "j",
  Backspace: "h",
  Delete: "x",
  Home: "0",
  End: "$",
  Enter: "",
};

/** The message box's editor, when `element` is one. */
export function composerEditor(element: Element | null | undefined) {
  return element instanceof HTMLElement &&
    element.matches('[role="textbox"]') &&
    element.closest("[data-composer-surface]") &&
    typeof (element as Partial<ComposerInputElement>).insertText ===
      "function" &&
    Array.isArray((element as Partial<ComposerInputElement>).atoms)
    ? (element as ComposerInputElement)
    : undefined;
}

const buffer = (input: ComposerInputElement) => ({
  text: input.value,
  atoms: input.atoms,
});
const head = (input: ComposerInputElement) =>
  input.selectionDirection === "backward"
    ? input.selectionStart
    : input.selectionEnd;
const visual = (mode: Mode) => mode === "visual" || mode === "visual-line";

export function composerModes({
  apple,
  announce,
  leader,
}: {
  apple: boolean;
  announce(text: string): void;
  /** Space in normal mode starts the leader keys. */
  leader(): void;
}) {
  /** The focused message box and its mode; one at a time, as focus is. */
  let active: { input: ComposerInputElement; vim: Vim } | undefined;
  /** The selection a visual mode last showed, to notice a click moving it. */
  let shown: { start: number; end: number } | undefined;
  let register: Register | undefined;

  const set = (input: ComposerInputElement, vim: Vim) => {
    const before = active?.input === input ? active.vim.mode : undefined;
    active = { input, vim };
    setComposerStatus(input, STATUS[vim.mode]);
    if (before && before !== vim.mode) announce(SPOKEN[vim.mode]);
  };
  const show = (input: ComposerInputElement, vim: Vim) => {
    if (!visual(vim.mode)) {
      shown = undefined;
      input.setSelectionRange(vim.cursor, vim.cursor);
      return;
    }
    const range = selection(vim, buffer(input));
    input.setSelectionRange(
      range.start,
      range.end,
      vim.cursor < vim.anchor ? "backward" : "forward",
    );
    shown = { start: input.selectionStart, end: input.selectionEnd };
  };
  const reset = () => {
    if (active) setComposerStatus(active.input, undefined);
    active = undefined;
    shown = undefined;
  };

  const keydown = (event: KeyboardEvent) => {
    const input = composerEditor(document.activeElement);
    if (
      !input ||
      active?.input !== input ||
      event.defaultPrevented ||
      event.isComposing ||
      event.keyCode === 229
    )
      return;
    const plain =
      !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey;
    const escaping =
      (event.key === "Escape" && plain) ||
      (apple &&
        event.key === "[" &&
        event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        !event.shiftKey);
    let vim = active.vim;
    if (vim.mode === "insert") {
      // A suggestion list has the first Escape.
      if (!escaping || input.hasAttribute("aria-controls")) return;
      event.preventDefault();
      event.stopPropagation();
      run(input, { ...vim, cursor: head(input) }, "Escape");
      return;
    }
    const key = escaping
      ? "Escape"
      : event.metaKey || event.altKey
        ? undefined
        : event.ctrlKey
          ? event.key === "r" && !event.shiftKey
            ? REDO
            : undefined
          : event.key.length === 1
            ? event.key
            : NAMED[event.key];
    if (key === undefined) return;
    // A click or the editor may have moved the caret since the last key.
    const caret = head(input);
    if (
      visual(vim.mode) &&
      (input.selectionStart !== shown?.start ||
        input.selectionEnd !== shown?.end)
    )
      vim = normal(caret);
    if (vim.mode === "normal") vim = settle(vim, buffer(input), caret);
    // Escape with nothing pending leaves the message box, as before.
    if (key === "Escape" && vim.mode === "normal" && !vim.typed.length) {
      active = { input, vim };
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    if (key === " " && vim.mode === "normal" && !vim.typed.length) {
      active = { input, vim };
      leader();
      return;
    }
    if (key) run(input, vim, key);
  };

  function run(input: ComposerInputElement, vim: Vim, key: string) {
    const result = press(vim, buffer(input), key, register);
    if (result.register) register = result.register;
    if (result.edit) {
      const { start, end, text } = result.edit;
      input.insertText(text, undefined, { start, end });
    }
    let next = result.vim;
    if (result.history) {
      for (let time = 0; time < result.history.times; time++)
        input.undo(result.history.redo);
      next = { ...next, cursor: input.selectionStart };
    }
    // An edit the editor refused leaves the cursor where the text allows.
    next = settle(next, buffer(input));
    set(input, next);
    show(input, next);
  }

  /** Pasting or cutting would type too, so normal and visual modes refuse. */
  const clipboard = (event: ClipboardEvent) => {
    if (
      active &&
      active.vim.mode !== "insert" &&
      composerEditor(document.activeElement) === active.input
    ) {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  /** Focus entering a message box types; the leader's menu keeps the mode. */
  const focusin = (event: FocusEvent) => {
    const target = event.target instanceof Element ? event.target : null;
    if (target?.closest(`[${WHICH_KEY}]`)) return;
    const input = composerEditor(target);
    if (active && active.input !== input) reset();
    if (input && !active) set(input, insert(head(input)));
  };
  /** Focus leaving for nothing, such as a removed element, ends the mode. */
  const focusout = () =>
    requestAnimationFrame(() => {
      const focus = document.activeElement;
      if (active && focus !== active.input && !focus?.closest(`[${WHICH_KEY}]`))
        reset();
    });

  addEventListener("keydown", keydown, true);
  addEventListener("paste", clipboard, true);
  addEventListener("cut", clipboard, true);
  document.addEventListener("focusin", focusin);
  document.addEventListener("focusout", focusout);
  const input = composerEditor(document.activeElement);
  if (input) set(input, insert(head(input)));

  return {
    /** `<leader>i`: type in the focused message box. */
    insert() {
      const input = composerEditor(document.activeElement);
      if (!input) return;
      const vim = insert(head(input));
      set(input, vim);
      show(input, vim);
    },
    stop() {
      removeEventListener("keydown", keydown, true);
      removeEventListener("paste", clipboard, true);
      removeEventListener("cut", clipboard, true);
      document.removeEventListener("focusin", focusin);
      document.removeEventListener("focusout", focusout);
      reset();
    },
  };
}
