import { expect, it } from "vitest";
import { interceptedWords, withProviderWords } from "./failure-words";

it("follows the explanation with the provider's words, quoted and attributed", () => {
  expect(
    withProviderWords(
      "Head to [Settings](buzz://settings) to sign in.",
      "Codex",
      "unexpected status 401 Unauthorized",
    ),
  ).toBe(
    "Head to [Settings](buzz://settings) to sign in.\n\nCodex said:\n> unexpected status 401 Unauthorized",
  );
});

it("quotes every line of the provider's words, without stray whitespace", () => {
  expect(
    withProviderWords("Explained.", "goose", "  first\r\n\nsecond  \n\n"),
  ).toBe("Explained.\n\ngoose said:\n> first\n>\n> second");
});

it("quotes at most 500 characters of the provider's words, marking the cut", () => {
  expect(withProviderWords("Explained.", "Codex", "a".repeat(501))).toBe(
    `Explained.\n\nCodex said:\n> ${"a".repeat(500)}…`,
  );
  // 500 characters is all of them: nothing is cut.
  expect(withProviderWords("Explained.", "goose", "a".repeat(500))).toBe(
    `Explained.\n\ngoose said:\n> ${"a".repeat(500)}`,
  );
});

it("lets the explanation stand alone when the provider said nothing", () => {
  for (const words of ["", "  \n\t "])
    expect(withProviderWords("Explained.", "Claude", words)).toBe("Explained.");
});

it("says a network gateway answered in the provider's place, naming no VPN for certain", () => {
  for (const error of [
    "API Error: API returned an empty or malformed response (HTTP 200) — check for a proxy or gateway intercepting the request. Response: content-type html, body is an HTML page, 67064 bytes, request-id absent, server cloudflare",
    "failed to look up workstation: unavailable: redirected to Cloudflare Access login",
    "302 Found: https://example.cloudflareaccess.com/cdn-cgi/access/login",
  ])
    expect(interceptedWords("Claude", error)).toBe(
      "A network gateway answered instead of Claude's provider. If this computer uses a VPN, proxy or access gateway (such as Cloudflare WARP), it may have disconnected or need you to sign in again. Reconnect it, then mention me again.",
    );
});

it("leaves errors that a provider itself sent unexplained", () => {
  for (const error of [
    "Error: overloaded",
    "Cloudflare R2 bucket not found",
    "502 Bad Gateway, server cloudflare",
  ])
    expect(interceptedWords("Claude", error)).toBeUndefined();
});
