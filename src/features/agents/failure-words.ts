/** How much of a provider's own words a failed turn's reply quotes: as much
 * as a report keeps of any failure. */
const QUOTED = 500;

/** A failed turn's reply once `explanation` (Markdown, such as a sentence
 * that links Settings) explains it: the explanation first, then, after a
 * blank line, what `who` said, quoted on the lines right under it, so the
 * thread keeps the provider's words rather than only the Activity tab. Words
 * cut short end in "…"; with no words, the explanation stands alone. */
export function withProviderWords(
  explanation: string,
  who: string,
  words: string,
) {
  const said = words.trim();
  if (!said) return explanation;
  const kept =
    said.length > QUOTED ? `${said.slice(0, QUOTED).trimEnd()}…` : said;
  const quote = kept
    .split(/\r\n?|\n/)
    .map((line) => `> ${line}`.trimEnd())
    .join("\n");
  return `${explanation}\n\n${who} said:\n${quote}`;
}

/** The explanation for a failed turn whose request never reached `who`'s
 * provider because a network gateway answered it instead, or undefined when
 * the error doesn't say so. Cloudflare Access answers a lapsed WARP session
 * with its sign-in page: Claude reports "server cloudflare" with an HTML
 * body, other clients a redirect to the Cloudflare Access login. Other
 * proxies show up as Claude's "proxy or gateway intercepting the request". */
export function interceptedWords(who: string, error: string) {
  if (
    /\bserver cloudflare\b|\bcloudflare ?access\b|cloudflareaccess\.com/i.test(
      error,
    )
  )
    return `Cloudflare answered instead of ${who}'s provider, so the request never reached it. Cloudflare WARP has likely disconnected or needs you to sign in again. Reconnect it, then mention me again.`;
  if (/\bproxy or gateway intercepting\b/i.test(error))
    return `A proxy or gateway answered instead of ${who}'s provider, so the request never reached it. Check this computer's VPN or proxy connection, then mention me again.`;
  return undefined;
}
