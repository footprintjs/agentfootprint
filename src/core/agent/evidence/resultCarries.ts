/**
 * resultCarries — does ONE tool result carry ONE value? The evidence index's
 * own reading of a result, asked per value.
 *
 * Pattern: a pure reader over the index's one reading of a result
 *          (`evidenceIndex.ts` · `readResult`: parsed JSON with an absence's
 *          `looked_for` projected away, walked leaf by leaf, keys included;
 *          the text when it is not JSON) and the one normaliser
 *          (`normalize.ts`) — never a second haystack.
 * Role:    core/ layer, `evidence/`. Asked by the inputs layer's declared-
 *          sources check (`core/agent/arguments/checks.ts` · `checkSource`),
 *          which loads with the layer — so this module is never on a plain
 *          agent's graph.
 * Emits:   N/A.
 */

import { MAX_INDEX_TOKENS, readResult } from './evidenceIndex.js';
import { canonicalForm, normalizeToken, tokenize } from './normalize.js';

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

function leafOf(raw: string): Leaf {
  const whole = normalizeToken(raw);
  return { whole: whole === '' ? '' : canonicalForm(whole), tokens: canonicalTokens(raw) };
}

function leavesOf(content: string): ReadLeaves {
  const leaves: Leaf[] = [];
  let budget = MAX_INDEX_TOKENS;
  const push = (raw: string): void => {
    if (budget <= 0) return;
    const leaf = leafOf(raw);
    budget -= leaf.tokens.length;
    leaves.push(leaf);
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
    return { leaves, truncated: budget <= 0 };
  }
  // Text is one leaf — a longer value may span its tokens, never a substring.
  const tokens = canonicalTokens(read.text);
  const within = tokens.length > MAX_INDEX_TOKENS ? tokens.slice(0, MAX_INDEX_TOKENS) : tokens;
  return {
    leaves: [{ whole: '', tokens: within }],
    truncated: tokens.length > MAX_INDEX_TOKENS,
  };
}

/** Whether `needle` is carried by one leaf, the way the index files it. */
function leafCarries(leaf: Leaf, needle: readonly string[]): boolean {
  // One token: the leaf whole (a leaf may carry spaces and still be one value)
  // or one of its tokens — exactly the forms the index files.
  if (needle.length === 1) return leaf.whole === needle[0] || leaf.tokens.includes(needle[0]);
  // A longer value must sit inside ONE leaf, contiguously — never stitched across two.
  return occursIn(needle, leaf.tokens);
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
  return (value) => {
    const needle = canonicalTokens(String(value));
    if (needle.length === 0) return 'uncheckable';
    read ??= leavesOf(content);
    if (read.leaves.some((leaf) => leafCarries(leaf, needle))) return 'found';
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
 * would see `:50` and `:true`. A one-token value is found when it equals a
 * leaf or one of a leaf's tokens; a longer value must occur contiguously
 * inside one string leaf (or in the text). Whole tokens only, never
 * substrings; one normaliser (`normalize.ts`), so `41,200` is `41200` here as
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
