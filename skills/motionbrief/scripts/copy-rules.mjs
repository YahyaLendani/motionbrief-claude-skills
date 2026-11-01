/**
 * copy-rules — the one definition of "this required copy line matches". Used by
 * the static check and the runtime check, so both apply the same rules.
 *
 * Matching is deliberately not byte-for-byte equality:
 *
 *   capitalization  ignored — uppercase is a styling choice (text-transform,
 *                   .toUpperCase()), the words are not.
 *   whitespace      ignored — "MOT<em>IONS</em>" and one <span> per word are
 *                   both legitimate ways to set a line.
 *   punctuation     significant, except that curly quotes fold to straight ones
 *                   and an ellipsis character folds to three dots.
 *   entities        decoded before comparing (&amp; is &).
 *   numbers         a line that is only a number ("12,480", "98%") is compared as a
 *                   whole number, ignoring digit grouping: 12,480 equals 12480 and
 *                   12 480, and 412,480 does not satisfy it. Decimal points, currency
 *                   signs and unit suffixes stay significant.
 *
 * A required line may be part of a longer visible string. These rules detect
 * missing or changed words, not added ones.
 */

const ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  mdash: "—",
  ndash: "–",
  hellip: "…",
};

export function decodeEntities(s) {
  return String(s).replace(/&(#x[\da-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    if (code[0] === "#") {
      const n = code[1].toLowerCase() === "x" ? parseInt(code.slice(2), 16) : parseInt(code.slice(1), 10);
      return Number.isFinite(n) ? String.fromCodePoint(n) : m;
    }
    return ENTITIES[code.toLowerCase()] ?? m;
  });
}

/** Comparable form of a piece of text: no case, no whitespace, plain quotes. */
export function normalizeCopy(s) {
  return decodeEntities(s)
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/…/g, "...")
    .replace(/\\(['"`])/g, "$1")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export const isNumericCopy = (s) => /^[^\d\p{L}]*\d[\d,.\s]*[%kmbx+]?$/iu.test(decodeEntities(s).trim());

/** "12,480" -> "12480": grouping gone, decimal point and suffix kept. */
const ungroup = (s) => normalizeCopy(s).replace(/,/g, "");

/** The bare digits of a numeric line, for finding a count-up's target literal. */
export const digitsOf = (s) => ungroup(s).replace(/[^\d.]/g, "").replace(/\.$/, "");

/**
 * A whole number as written: "12,480", "12 480", "12480" or "12.5". Word breaks are
 * kept while looking, so "beat. 12 480" is the number 12480 after a full stop, not
 * the decimal .12480.
 */
const NUMBER = /\d{1,3}(?:[,   ]\d{3})+(?!\d)(?:\.\d+)?|\d+(?:\.\d+)?/g;

/** Where a number-only line occurs in `text`, currency sign and unit included. */
function numberSpans(text, line) {
  const parts = /^([^\d\p{L}]*)(\d[\d,.\s]*?)[.,\s]*([%kmbx+]?)$/iu.exec(decodeEntities(line).trim());
  if (!parts) return [];
  const prefix = parts[1].trim();
  const suffix = parts[3].toLowerCase();
  const want = digitsOf(parts[2]);

  const spans = [];
  for (const m of text.matchAll(NUMBER)) {
    if (digitsOf(m[0]) !== want) continue;
    const end = m.index + m[0].length;
    const after = text.slice(end);
    const gap = after.length - after.trimStart().length;
    if (suffix && !after.slice(gap).toLowerCase().startsWith(suffix)) continue;
    if (prefix && !text.slice(0, m.index).trimEnd().endsWith(prefix)) continue;
    spans.push([m.index, suffix ? end + gap + suffix.length : end]);
  }
  return spans;
}

/** Does `haystack` (any source text) contain the line under the rules above? */
export function textContainsCopy(haystack, line) {
  const needle = normalizeCopy(line);
  if (needle === "") return false;
  if (isNumericCopy(line)) return numberSpans(decodeEntities(haystack), line).length > 0;
  return normalizeCopy(haystack).includes(needle);
}

const DIGITS_ONLY = /^[\d,.\s]+$/;

/** Digits split across inline spans are one number; anything else is a separate piece. */
function searchNumber(line, list) {
  let hay = "";
  const owners = [];
  list.forEach((frag, i) => {
    const piece = decodeEntities(frag.text).trim();
    const prev = list[i - 1];
    if (hay !== "" && !(DIGITS_ONLY.test(frag.text) && DIGITS_ONLY.test(prev.text) && frag.block === prev.block)) {
      hay += "\n";
      owners.push(-1);
    }
    for (let c = 0; c < piece.length; c++) owners.push(i);
    hay += piece;
  });
  return numberSpans(hay, line).map(([from, to]) => [...new Set(owners.slice(from, to))].filter((i) => i !== -1).map((i) => list[i]));
}

function searchWords(line, list) {
  const needle = normalizeCopy(line);
  let hay = "";
  const owners = [];
  list.forEach((frag, i) => {
    const piece = normalizeCopy(frag.text);
    for (let c = 0; c < piece.length; c++) owners.push(i);
    hay += piece;
  });
  const hits = [];
  for (let at = hay.indexOf(needle); at !== -1; at = hay.indexOf(needle, at + 1)) {
    hits.push([...new Set(owners.slice(at, at + needle.length))].map((i) => list[i]));
  }
  return hits;
}

/**
 * Match a required line against the text fragments on screen at one instant.
 * Fragments are `{ text, reasons, block? }` in document order; an empty `reasons`
 * means the fragment is readable. Returns `{ visible, present, reasons, fragments }`:
 * present means the words are in the DOM, visible means they can be read.
 */
export function matchFragments(line, fragments) {
  if (normalizeCopy(line) === "") return { visible: false, present: false, reasons: [], fragments: [] };
  const search = isNumericCopy(line) ? searchNumber : searchWords;

  const readable = search(line, fragments.filter((f) => f.reasons.length === 0));
  if (readable.length > 0) return { visible: true, present: true, reasons: [], fragments: readable[0] };

  const anywhere = search(line, fragments);
  if (anywhere.length === 0) return { visible: false, present: false, reasons: [], fragments: [] };
  return { visible: false, present: true, reasons: [...new Set(anywhere[0].flatMap((f) => f.reasons))], fragments: anywhere[0] };
}
