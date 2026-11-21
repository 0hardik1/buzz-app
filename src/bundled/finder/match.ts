// Fuzzy matching and scoring ported from fzf's `FuzzyMatchV1` and
// `calculateScore` (src/algo/algo.go, MIT, Copyright (c) 2013-2026 Junegunn
// Choi). See NOTICE.md. The greedy v1 pass is linear in the text, which keeps
// long messages cheap; fzf itself falls back to it for long input.

const scoreMatch = 16;
const scoreGapStart = -3;
const scoreGapExtension = -1;
const bonusBoundary = scoreMatch / 2;
const bonusNonWord = scoreMatch / 2;
const bonusCamel123 = bonusBoundary + scoreGapExtension;
const bonusConsecutive = -(scoreGapStart + scoreGapExtension);
const bonusFirstCharMultiplier = 2;
const bonusBoundaryWhite = bonusBoundary + 2;
const bonusBoundaryDelimiter = bonusBoundary + 1;

const White = 0;
const NonWord = 1;
const Delimiter = 2;
const Lower = 3;
const Upper = 4;
const Letter = 5;
const NumberClass = 6;

function classify(code: number) {
  const char = String.fromCharCode(code);
  if (/\s/u.test(char)) return White;
  if ("/,:;|".includes(char)) return Delimiter;
  if (/\p{Lu}/u.test(char)) return Upper;
  if (/\p{Ll}/u.test(char)) return Lower;
  if (/\p{N}/u.test(char)) return NumberClass;
  if (/[\p{L}\p{M}]/u.test(char)) return Letter;
  return NonWord;
}

/** Every UTF-16 unit's class, filled as units are first seen (surrogate
 * halves count as letters, which emoji rarely need to be otherwise). */
const classes = new Uint8Array(65536).fill(255);
const classOf = (code: number) => {
  let found = classes[code] as number;
  if (found === 255) {
    found = code >= 0xd800 && code <= 0xdfff ? Letter : classify(code);
    classes[code] = found;
  }
  return found;
};

function bonusOf(previous: number, current: number) {
  if (current > NonWord) {
    if (previous === White) return bonusBoundaryWhite;
    if (previous === Delimiter) return bonusBoundaryDelimiter;
    if (previous === NonWord) return bonusBoundary;
  }
  if (
    (previous === Lower && current === Upper) ||
    (previous !== NumberClass && current === NumberClass)
  )
    return bonusCamel123;
  if (current === NonWord || current === Delimiter) return bonusNonWord;
  if (current === White) return bonusBoundaryWhite;
  return 0;
}
/** `bonus[previous * 7 + current]`, as fzf precomputes it. */
const bonus = Int8Array.from({ length: 49 }, (_, n) =>
  bonusOf(Math.floor(n / 7), n % 7),
);

/** fzf's score for `pattern` matched in order within `text[start..end]`.
 * Pushes matched indexes into `positions` when given. */
function scoreSpan(
  text: string,
  pattern: string,
  start: number,
  end: number,
  positions?: number[],
) {
  let p = 0;
  let score = 0;
  let inGap = false;
  let consecutive = 0;
  let firstBonus = 0;
  let previous = start > 0 ? classOf(text.charCodeAt(start - 1)) : White;
  for (let i = start; i < end; i++) {
    const code = text.charCodeAt(i);
    const current = classOf(code);
    if (code === pattern.charCodeAt(p)) {
      positions?.push(i);
      score += scoreMatch;
      let gain = bonus[previous * 7 + current] as number;
      if (consecutive === 0) firstBonus = gain;
      else {
        if (gain >= bonusBoundary && gain > firstBonus) firstBonus = gain;
        gain = Math.max(gain, firstBonus, bonusConsecutive);
      }
      score += p === 0 ? gain * bonusFirstCharMultiplier : gain;
      inGap = false;
      consecutive++;
      p++;
    } else {
      score += inGap ? scoreGapExtension : scoreGapStart;
      inGap = true;
      consecutive = 0;
      firstBonus = 0;
    }
    previous = current;
  }
  return score;
}

/** A fuzzy match of `pattern` in `text`: forward to the first complete
 * occurrence, then backward to its shortest end-anchored span. Both strings
 * are already in the case being compared. */
export function fuzzyMatch(
  text: string,
  pattern: string,
  positions?: number[],
): number | undefined {
  if (!pattern) return 0;
  let at = -1;
  let start = -1;
  for (let p = 0; p < pattern.length; p++) {
    at = text.indexOf(pattern[p] as string, at + 1);
    if (at < 0) return undefined;
    if (p === 0) start = at;
  }
  const end = at + 1;
  // Walk back from the last match to the latest start that still fits.
  let p = pattern.length - 1;
  for (let i = end - 1; i >= start; i--)
    if (text.charCodeAt(i) === pattern.charCodeAt(p) && --p < 0) {
      start = i;
      break;
    }
  return scoreSpan(text, pattern, start, end, positions);
}

/** An exact substring match, scored like fzf's exact match: the occurrence
 * with the best boundary bonus wins. */
export function exactMatch(
  text: string,
  pattern: string,
  positions?: number[],
): number | undefined {
  if (!pattern) return 0;
  let best: number | undefined;
  let bestAt = -1;
  for (
    let at = text.indexOf(pattern);
    at >= 0;
    at = text.indexOf(pattern, at + 1)
  ) {
    const score = scoreSpan(text, pattern, at, at + pattern.length);
    if (best === undefined || score > best) {
      best = score;
      bestAt = at;
    }
    // A word-start hit cannot be beaten by a later one.
    if (
      at === 0 ||
      classOf(text.charCodeAt(at - 1)) === White ||
      best >= pattern.length * scoreMatch + bonusBoundaryWhite * 3
    )
      break;
  }
  if (best === undefined) return undefined;
  if (positions)
    for (let i = 0; i < pattern.length; i++) positions.push(bestAt + i);
  return best;
}

export type Term = Readonly<{
  text: string;
  exact: boolean;
  negate: boolean;
  /** Smart case: a term with a capital letter matches case. */
  caseSensitive: boolean;
}>;

/** Space-separated terms that must all match, as in fzf's extended search:
 * `'word` matches exactly and `!word` excludes. */
export function parseQuery(query: string): readonly Term[] {
  return query
    .trim()
    .split(/\s+/)
    .flatMap((raw): Term[] => {
      let text = raw;
      const negate = text.startsWith("!");
      if (negate) text = text.slice(1);
      const exact = negate || text.startsWith("'");
      if (text.startsWith("'")) text = text.slice(1);
      if (!text) return [];
      const caseSensitive = text !== text.toLowerCase();
      return [{ text, exact, negate, caseSensitive }];
    });
}

/** Letters and digits as bits, so a text lacking any of a term's letters is
 * skipped without scanning it. */
export function charMask(text: string) {
  let mask = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i) | 0x20;
    if (code >= 97 && code <= 122) mask |= 1 << (code - 97);
    else if (code >= 48 && code <= 57) mask |= 1 << (26 + ((code - 48) % 6));
  }
  return mask;
}

/** Whether every term matches, without scoring: a forward `indexOf` chain,
 * far cheaper than `matchTerms`. */
export function termsMatch(
  terms: readonly Term[],
  text: string,
  lower: string,
) {
  for (const term of terms) {
    const haystack = term.caseSensitive ? text : lower;
    let found: boolean;
    if (term.exact) found = haystack.includes(term.text);
    else {
      let at = -1;
      for (let p = 0; p < term.text.length; p++) {
        at = haystack.indexOf(term.text[p] as string, at + 1);
        if (at < 0) break;
      }
      found = at >= 0;
    }
    if (found === term.negate) return false;
  }
  return true;
}

/** The best score `matchTerms` can give these terms: each one whole, at the
 * start of a word after a space. */
export function bestScore(terms: readonly Term[]) {
  let total = 0;
  for (const term of terms)
    if (!term.negate)
      total +=
        term.text.length * scoreMatch +
        bonusBoundaryWhite * (bonusFirstCharMultiplier + term.text.length - 1);
  return total;
}

/** Scores `text` (with `lower`, its lowercase form) against every term, or
 * undefined when any fails. Negated terms add nothing. */
export function matchTerms(
  terms: readonly Term[],
  text: string,
  lower: string,
  positions?: number[],
): number | undefined {
  let total = 0;
  for (const term of terms) {
    const haystack = term.caseSensitive ? text : lower;
    const found = term.exact
      ? exactMatch(haystack, term.text, term.negate ? undefined : positions)
      : fuzzyMatch(haystack, term.text, positions);
    if (term.negate) {
      if (found !== undefined) return undefined;
      continue;
    }
    if (found === undefined) return undefined;
    total += found;
  }
  return total;
}
