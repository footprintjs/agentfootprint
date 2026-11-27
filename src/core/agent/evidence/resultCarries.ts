/**
 * resultCarries — does ONE tool result carry ONE value? The evidence index's
 * own reading of a result, asked per value.
 *
 * Pattern: a pure reader over the index's one reading of a result
 *          (`evidenceIndex.ts` · `readResult`: parsed JSON with an absence's
 *          `looked_for` projected away, walked leaf by leaf, keys included —
 *          the leading JSON of a result a framework note follows, and the
 *          note as text; the text when it is not JSON) and the one normaliser
 *          (`lib/normalize.ts`) — never a second haystack.
 * Role:    core/ layer, `evidence/`. Asked by the inputs layer's declared-
 *          sources check (`core/agent/arguments/checks.ts` · `checkSource`),
 *          which loads with the layer — so this module is never on a plain
 *          agent's graph.
 * Emits:   N/A.
 *
 * ONE CEILING, TWO METERS. `evidenceIndex.ts` · `MAX_INDEX_TOKENS` is one
 * number read by two meters. The index counts DISTINCT forms across the WHOLE
 * history (a repeated form is free). The per-result readers that share the
 * number — this module (`leavesOf`) and the argument-sources check
 * (`arguments/checks.ts` · `contains`) — count EVERY token, repeats included,
 * of ONE result, because they match token SEQUENCES and need the positions.
 * So past the number they can disagree: a result of one token repeated more
 * times than the ceiling is complete for the index and `uncheckable` here,
 * and a history the index marks truncated can still be read in full, result
 * by result, here. Each says `uncheckable` / `truncated` honestly by its own
 * meter; neither borrows the other's verdict.
 */

import { MAX_INDEX_TOKENS, readResult } from './evidenceIndex.js';
import { canonicalForm, normalizeToken, tokenize } from '../../../lib/normalize.js';
import { numericCommaItems } from './numericCommaItems.js';

/**
 * What `resultCarries` answers: the value is in the result (`found`), it is
 * not (`not-found`), or the question has no answer — the value has no token
 * after normalisation, or the result reached the index's token ceiling before
 * a match (`uncheckable`, never "not found").
 */
export type ResultCarriage = 'found' | 'not-found' | 'uncheckable';

/** A value's canonical token sequence — the evidence module's "same value". */
export function canonicalTokens(text: string): string[] {
  return tokenize(text).map(canonicalForm);
}

/** Whether `needle` occurs contiguously in `hay` — whole tokens, never substrings. */
export function occursIn(needle: readonly string[], hay: readonly string[]): boolean {
  if (needle.length === 0 || needle.length > hay.length) return false;
  for (let i = 0; i + needle.length <= hay.length; i += 1) {
    let all = true;
    for (let k = 0; k < needle.length; k += 1) {
      if (hay[i + k] !== needle[k]) {
        all = false;
        break;
      }
    }
    if (all) return true;
  }
  return false;
}

/** One leaf of a read result — its whole form and its tokens, canonical. */
interface Leaf {
  readonly whole: string;
  readonly tokens: readonly string[];
  readonly commaTokens?: readonly string[];
}

/**
 * A result read ONCE for many questions: its leaves (keys included), each
 * with its canonical whole form and tokens, in walk order and read up to the
 * index's ceiling — `truncated` when the ceiling cut the read short.
 */
interface ReadLeaves {
  readonly leaves: readonly Leaf[];
  readonly truncated: boolean;
}

function readTextLeaf(
  raw: string,
  limit: number,
  commaLimit = limit,
): { leaf: Leaf; count: number } {
  const all = tokenize(raw);
  const within = all.length > limit ? all.slice(0, limit) : all;
  // Numeric parsing sees the original token, before identity aliases such as
  // the shortened hexadecimal spelling.
  const numericInput = within.length > commaLimit ? within.slice(0, commaLimit) : within;
  const commaTokens = numericInput.filter((token) => token.includes(','));
  return {
    leaf: {
      whole: '',
      tokens: within.map(canonicalForm),
      ...(commaTokens.length > 0 && { commaTokens }),
    },
    count: all.length,
  };
}

function leavesOf(content: string): ReadLeaves {
  const leaves: Leaf[] = [];
  let budget = MAX_INDEX_TOKENS;
  const push = (raw: string): void => {
    if (budget <= 0) return;
    const { leaf, count } = readTextLeaf(raw, Infinity, budget);
    budget -= count;
    leaves.push({ ...leaf, whole: canonicalForm(normalizeToken(raw)) });
  };
  const visit = (node: unknown): void => {
    if (budget <= 0 || node === null || node === undefined) return;
    if (typeof node === 'string') return push(node);
    if (typeof node === 'number' || typeof node === 'boolean' || typeof node === 'bigint') {
      return push(String(node));
    }
    if (Array.isArray(node)) {
      for (const el of node) visit(el);
      return;
    }
    if (typeof node === 'object') {
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        push(key);
        visit(value);
      }
    }
  };
  const read = readResult(content);
  if ('parsed' in read) {
    visit(read.parsed);
    // The text after the JSON (a framework note) is one leaf, read to what is left of the ceiling.
    if (read.tail !== undefined && budget > 0) {
      const { leaf, count } = readTextLeaf(read.tail, budget);
      leaves.push(leaf);
      budget -= count;
    }
    return { leaves, truncated: budget <= 0 };
  }
  // Text is one leaf — a longer value may span its tokens, never a substring.
  const { leaf, count } = readTextLeaf(read.text, MAX_INDEX_TOKENS);
  return { leaves: [leaf], truncated: count > MAX_INDEX_TOKENS };
}

/** Whether `needle` is carried by one leaf, the way the index files it. */
function leafCarries(leaf: Leaf, needle: readonly string[]): boolean {
  // One token: the leaf whole (a leaf may carry spaces and still be one value)
  // or one of its tokens — exactly the forms the index files.
  if (needle.length === 1) return leaf.whole === needle[0] || leaf.tokens.includes(needle[0]);
  // A longer value must sit inside ONE leaf, contiguously — never stitched across two.
  return occursIn(needle, leaf.tokens);
}

/** On a numeric lookup only, index comma values from already admitted tokens. */
function readCommaValues(leaves: readonly Leaf[]): { values: Set<string>; truncated: boolean } {
  const values = new Set<string>();
  let remaining = MAX_INDEX_TOKENS;
  for (const { commaTokens } of leaves) {
    for (const token of commaTokens ?? []) {
      if (remaining === 0) return { values, truncated: true };
      remaining -= 1;
      for (const { spelling } of numericCommaItems(token)) {
        if (remaining === 0) return { values, truncated: true };
        remaining -= 1;
        values.add(normalizeToken(spelling));
      }
    }
  }
  return { values, truncated: false };
}

/**
 * A result read once, asked many times — `(value) => ResultCarriage`, the
 * same answers `resultCarries` gives, without re-reading the result for every
 * value. The declared-sources checks ask one result about several values per
 * batch (`core/agent/arguments/checks.ts`).
 */
export function resultReader(
  content: string,
): (value: string | number | boolean) => ResultCarriage {
  let read: ReadLeaves | undefined;
  let numeric: ReturnType<typeof readCommaValues> | undefined;
  return (value) => {
    const needle = canonicalTokens(String(value));
    const first = needle[0];
    if (first === undefined) return 'uncheckable';
    read ??= leavesOf(content);
    if (read.leaves.some((leaf) => leafCarries(leaf, needle))) return 'found';
    if (typeof value === 'number') {
      numeric ??= readCommaValues(read.leaves);
      if (numeric.values.has(first)) return 'found';
      if (numeric.truncated) return 'uncheckable';
    }
    return read.truncated ? 'uncheckable' : 'not-found';
  };
}

// FOLD · the one per-result reading of "does this result carry this value?"
// consumers read this and never re-derive it: core/agent/arguments/checks.ts · checkSource (the
// declared-sources check — a value the model says came from one named result, or a hint looked up).
// detached: yes — a pure function of the result's text and the value; nothing is stored.
/**
 * Whether ONE tool result carries a value — read the way the evidence index
 * reads a result (`readResult`: parsed JSON with an absence's `looked_for`
 * projected away, walked leaf by leaf, keys included; the text when it is not
 * JSON), so a number or a boolean in compact JSON is found (`{"limit":50,
 * "ok":true}` carries `50` and `true`) where a tokenizer over the raw string
 * would see `:50` and `:true` — also when a framework note follows the JSON
 * (a step banner, the repeated-call note), when it is several JSON blocks (an
 * MCP text result) and in a capped result's `head`. A one-token value is found when it equals a
 * leaf or one of a leaf's tokens; a longer value must occur contiguously
 * inside one string leaf (or in the text). Whole tokens only, never
 * substrings; one normaliser (`lib/normalize.ts`), so `41,200` is `41200` here as
 * at the gate.
 *
 * `content` is the TOOL's own bytes — the caller cuts a library note off first
 * (`lib/toolBytes.ts` · `toolBytesOf`). `uncheckable` when the value has no
 * token after normalisation, or the result reached the index's token ceiling
 * (`MAX_INDEX_TOKENS`) before a match: never a pass, never "not found".
 * `resultReader` answers the same question for many values over one read.
 *
 * @example
 * ```ts
 * resultCarries('{"host":"srv-4417","limit":50,"ok":true}', 50);    // 'found'
 * resultCarries('{"host":"srv-4417"}', 'srv-44');                   // 'not-found'
 * resultCarries('{"host":"srv-4417"}', '２４ｈ');                    // 'uncheckable'
 * ```
 */
export function resultCarries(content: string, value: string | number | boolean): ResultCarriage {
  return resultReader(content)(value);
}
