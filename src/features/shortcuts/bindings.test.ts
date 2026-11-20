import { describe, expect, it } from "vitest";
import { resolveBindings, type BindingRow, type KeyBinding } from "./bindings";

const dock: KeyBinding = { key: "d", mod: true };
const focus: KeyBinding = { key: "l", mod: true };
const home: KeyBinding = { key: "h", mod: true };
const other: KeyBinding = { key: "p", mod: true };
const resolve = (
  rows: BindingRow[],
  saved: Record<string, unknown>,
  native: readonly KeyBinding[] = [dock],
) => resolveBindings(rows, (key) => saved[key] as never, native);

describe("resolveBindings", () => {
  it("gives a row with no override its defaults", () => {
    const resolved = resolve([{ key: "a", defaults: [focus, home] }], {});
    expect(resolved.get("a")).toEqual({ effective: [focus, home] });
  });

  it("applies an override that is not a native chord, even over another row's default", () => {
    const resolved = resolve(
      [
        { key: "a", defaults: [focus] },
        { key: "b", defaults: [home] },
      ],
      { a: [other], b: [focus] },
    );
    expect(resolved.get("a")).toEqual({ effective: [other] });
    expect(resolved.get("b")).toEqual({ effective: [focus] });
  });

  it("restores the default of a row whose override a native chord took, when the default is free", () => {
    const resolved = resolve([{ key: "a", defaults: [focus] }], { a: [dock] });
    expect(resolved.get("a")).toEqual({
      effective: [focus],
      masked: { override: [dock], restored: true },
    });
  });

  it("masks an override on any of several native chords and matches keys case-insensitively", () => {
    const resolved = resolve([{ key: "a", defaults: [focus] }], {
      a: [{ key: "D", mod: true }],
    });
    expect(resolved.get("a")?.masked?.restored).toBe(true);
    // A different modifier set is not the native chord.
    const shifted = resolve([{ key: "a", defaults: [focus] }], {
      a: [{ key: "d", mod: true, shift: true }],
    });
    expect(shifted.get("a")).toEqual({
      effective: [{ key: "d", mod: true, shift: true }],
    });
  });

  it("leaves a masked row unbound when another row's override took its default", () => {
    const resolved = resolve(
      [
        { key: "a", defaults: [focus] },
        { key: "b", defaults: [home] },
      ],
      { a: [dock], b: [focus] },
    );
    expect(resolved.get("b")).toEqual({ effective: [focus] });
    expect(resolved.get("a")).toEqual({
      effective: [],
      masked: { override: [dock], restored: false },
    });
  });

  it("leaves a masked row unbound when another row's own default holds its default chord", () => {
    const resolved = resolve(
      [
        { key: "a", defaults: [focus] },
        { key: "b", defaults: [focus] },
      ],
      { a: [dock] },
    );
    expect(resolved.get("b")).toEqual({ effective: [focus] });
    expect(resolved.get("a")?.effective).toEqual([]);
    expect(resolved.get("a")?.masked?.restored).toBe(false);
  });

  it("leaves a masked row unbound when its default is itself native", () => {
    const resolved = resolve([{ key: "a", defaults: [dock] }], { a: [dock] });
    expect(resolved.get("a")).toEqual({
      effective: [],
      masked: { override: [dock], restored: false },
    });
    // One native default among several is enough to refuse the restore.
    const mixed = resolve([{ key: "a", defaults: [focus, dock] }], {
      a: [dock],
    });
    expect(mixed.get("a")?.effective).toEqual([]);
  });

  it("gives a default shared by two masked rows to the first in row order", () => {
    const rows: BindingRow[] = [
      { key: "a", defaults: [focus] },
      { key: "b", defaults: [focus] },
    ];
    const saved = { a: [dock], b: [dock] };
    const forward = resolve(rows, saved);
    expect(forward.get("a")?.effective).toEqual([focus]);
    expect(forward.get("a")?.masked?.restored).toBe(true);
    expect(forward.get("b")?.effective).toEqual([]);
    expect(forward.get("b")?.masked?.restored).toBe(false);
    const reversed = resolve([...rows].reverse(), saved);
    expect(reversed.get("b")?.effective).toEqual([focus]);
    expect(reversed.get("a")?.effective).toEqual([]);
  });

  it("does not let a field-local row and a global row take each other's chords", () => {
    const resolved = resolve(
      [
        { key: "a", defaults: [focus], local: true },
        { key: "b", defaults: [focus] },
      ],
      { a: [dock] },
    );
    expect(resolved.get("a")?.effective).toEqual([focus]);
    expect(resolved.get("a")?.masked?.restored).toBe(true);
  });

  it("applies every override unchanged when no chord is native", () => {
    const resolved = resolve(
      [
        { key: "a", defaults: [focus] },
        { key: "b", defaults: [home] },
      ],
      { a: [dock], b: [focus] },
      [],
    );
    expect(resolved.get("a")).toEqual({ effective: [dock] });
    expect(resolved.get("b")).toEqual({ effective: [focus] });
  });

  it.each([
    ["a bare binding", { key: "d", mod: true }],
    ["an empty list", []],
    ["a string", "⌘D"],
    ["a list with a malformed binding", [{ key: 5 }]],
    ["null", null],
  ])("gives a row whose override is %s its defaults", (_name, saved) => {
    const resolved = resolve([{ key: "a", defaults: [focus] }], { a: saved });
    expect(resolved.get("a")).toEqual({ effective: [focus] });
  });

  it("never mutates the saved overrides or the rows", () => {
    const saved = { a: [dock] };
    const rows: BindingRow[] = [{ key: "a", defaults: [focus] }];
    const before = JSON.stringify({ saved, rows });
    resolve(rows, saved);
    expect(JSON.stringify({ saved, rows })).toBe(before);
  });
});
