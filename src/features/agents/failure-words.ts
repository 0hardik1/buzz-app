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

/** The explanation for a failed turn that a network gateway answered in
 * place of `who`'s provider, or undefined when the error doesn't say so.
 * Claude reports such an answer (often an HTML sign-in or block page) as a
 * "proxy or gateway intercepting the request"; other clients show a redirect
 * to a Cloudflare Access login. Not every computer has a VPN or gateway, and
 * the error doesn't say which one answered, so the advice names none for
 * certain. */
export function interceptedWords(who: string, error: string) {
  return /\bproxy or gateway intercepting\b|\bcloudflare ?access\b|cloudflareaccess\.com/i.test(
    error,
  )
    ? `A network gateway answered instead of ${who}'s provider. If this computer uses a VPN, proxy or access gateway (such as Cloudflare WARP), it may have disconnected or need you to sign in again. Reconnect it, then mention me again.`
    : undefined;
}
