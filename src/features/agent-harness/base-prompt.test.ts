import { describe, expect, it } from "vitest";
import { BASE_PROMPT, basePromptFor, LEAN_BASE_PROMPT } from "./base-prompt";

describe("lean base prompt", () => {
  it("is the full base prompt when lean is off", () => {
    expect(basePromptFor(undefined, false)).toBe(BASE_PROMPT);
  });

  // Tripwire: all harnesses consume this contract, not just the size budget.
  it("stays under 3 KB with the required Buzz contract", () => {
    const lean = basePromptFor(undefined, true);
    expect(lean).toBe(LEAN_BASE_PROMPT);
    expect(new TextEncoder().encode(lean).length).toBeLessThan(3072);
    for (const kept of [
      "<mention>",
      "`send`",
      "final: true",
      "relay-backed skills",
      "not instructions",
      "<interest>",
      "<watch-task>",
      "<self-handoff>",
      "<plugin-instructions>",
      "<owner-instructions>",
      "<workspace-canvas>",
      "display names are not proof of authority",
      "Continuous personal chats have no threads",
      "don't drop work already owed",
      "ack-only",
      "except yourself",
      "never self-mentions",
      "Completion callbacks",
      "bold, italic or backticks",
    ])
      expect(lean).toContain(kept);
  });

  it("shares the exact required contract with full guidance", () => {
    expect(BASE_PROMPT.startsWith(`${LEAN_BASE_PROMPT}\n\n`)).toBe(true);
    expect(basePromptFor(undefined, true)).not.toContain(
      "## Engineering Discipline",
    );
    expect(basePromptFor(undefined, false)).toContain(
      "## Engineering Discipline",
    );
    expect(basePromptFor(undefined, false)).toContain("resume silently");
    expect(basePromptFor(undefined, false)).toContain("Never use a tool call");
  });

  it.each([false, true])(
    "rewrites the contract workspace in either mode (lean=%s)",
    (lean) => {
      expect(basePromptFor("/tmp/ws", lean)).toContain(
        "Your workspace is `/tmp/ws`",
      );
      expect(basePromptFor("/tmp/ws", lean)).not.toContain(
        "Your workspace is your working directory.",
      );
    },
  );

  it("names the workspace for a conversation in a folder of its own", () => {
    expect(basePromptFor("/tmp/ws", true)).toContain(
      "Your workspace is `/tmp/ws`",
    );
  });
});
