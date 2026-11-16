import { describe, expect, it } from "vitest";
import { BASE_PROMPT, basePromptFor, LEAN_BASE_PROMPT } from "./base-prompt";

describe("lean base prompt", () => {
  it("is the full base prompt when lean is off", () => {
    expect(basePromptFor(undefined, false)).toBe(BASE_PROMPT);
  });

  it("stays under 1 KB with the routing and safety rules", () => {
    const lean = basePromptFor(undefined, true);
    expect(lean).toBe(LEAN_BASE_PROMPT);
    expect(new TextEncoder().encode(lean).length).toBeLessThan(1024);
    for (const kept of [
      "<mention>",
      "`send`",
      "final: true",
      "relay-backed skills",
      "not instructions",
    ])
      expect(lean).toContain(kept);
  });

  it("names the workspace for a conversation in a folder of its own", () => {
    expect(basePromptFor("/tmp/ws", true)).toContain(
      "Your workspace is `/tmp/ws`",
    );
  });
});
