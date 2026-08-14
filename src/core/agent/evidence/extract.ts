/**
 * extract — which tokens in an answer are DATA, and therefore have to be
 * grounded in a tool result.
 *
 * Pattern: a pure classifier over normalized tokens (normalize.ts is the only
 *          import), so it can be unit-tested on strings with no agent, no
 *          chart and no model.
 * Role:    core/ layer. The hard half of `namesAndNumbersFromEvidence`.
 * Emits:   N/A.
 *
 * ## The rule, and why every part of it is there
 *
 * A naive "flag every number" extractor makes the feature worse than useless.
 * It flags `24 hours`, `3 issues` and `first`, and under `guard` it then spends
 * a real turn asking the model to justify the word "three" — which is the
 * retry loop this library exists to remove. So the default is CONSERVATIVE: it
 * would rather miss a fabricated value than accuse a correct answer.
 *
 * A token is a candidate only if:
 *
 *   1. **It contains a digit.** English prose is alphabetic. Requiring a digit
 *      is the single cheapest separator between "data someone read off a
 *      screen" and "a word". It is also the rule's biggest blind spot, stated
 *      plainly: a fabricated all-letters name (`esxi-host-alpha`) is invisible
 *      to the default and needs a declared shape.
 *   2. **It is distinctive.** Either
 *        • an IDENTIFIER — digits mixed with letters or with structural
 *          punctuation (`:` `_` `-` `/` `.`), at least 4 characters:
 *          `0xef0101`, `fc1/3`, `21:00:00:24:ff:4a:12:03`, `UCSB-B200-M5`; or
 *        • a NUMBER with at least `minDigits` (default 4) digits: `41,200`,
 *          `18450`, `786432`.
 *   3. **It is not prose wearing a number.** Three exclusions, each from a
 *      real sentence in the material:
 *        • a number with a short unit or word glued to it — `32G`, `100MB`,
 *          `47th`, `2h`, `48-port`, `$20/month` — is judged on its NUMBER
 *          alone, so `48-port switch` never trips while `41200iops` still
 *          does;
 *        • a bare `N/M` of one or two digits each — `24/7`, `1/2` — is a ratio
 *          in prose. A two-number port id is spelled the same way, so the
 *          conservative reading wins and a domain that needs it declares a
 *          shape;
 *        • anything the caller declared exempt.
 *
 * Declared shapes are tested FIRST and win: an app that says "this is what my
 * identifiers look like" has better information than these heuristics.
 */

import { countDigits, normalizeToken, tokenize } from './normalize.js';
import type { ResolvedEvidenceGate, UnsupportedValue } from './types.js';

/** A value the answer asserts, and the rule that made it one. */
export type Candidate = UnsupportedValue;

/** Structural punctuation an identifier is allowed to be built from. */
const STRUCTURAL = /[:_\-/.]/;

/** At least one ASCII letter. */
const HAS_LETTER = /[a-z]/;

/**
 * `<number><short tail>` — a quantity with its unit or its adjective stuck to
 * it. The tail is capped at 5 letters because real units are short (`mbps`,
 * `gbps`, `hours`) while an identifier's alphabetic run is usually not, and an
 * optional `/word` covers `20/month` and `100mb/s`.
 */
const NUMBER_WITH_TAIL = /^([-+]?\d+(?:\.\d+)?)[-/]?[a-z]{1,5}(?:\/[a-z]{1,5})?$/;

/** A plain number, already canonicalised by `normalizeToken`. */
const BARE_NUMBER = /^[-+]?\d+(?:\.\d+)?$/;

/** `24/7`, `1/2` — a ratio in prose, not an identifier. */
const PROSE_RATIO = /^\d{1,2}\/\d{1,2}$/;

/** Ceiling on how many tokens one answer contributes. A model that pastes a
 *  10 MB table into its answer must not turn the gate into the run's cost. */
const MAX_ANSWER_TOKENS = 20_000;

/** True when the caller declared this token exempt. */
export function isDeclaredExempt(token: string, gate: ResolvedEvidenceGate): boolean {
  if (gate.exemptValues.has(token)) return true;
  for (const p of gate.exemptPatterns) if (p.test(token)) return true;
  return false;
}

/**
 * Classify ONE normalized token. Returns the candidate it produces, or
 * `undefined` when the token is prose.
 *
 * Exported for the unit tests, which is the whole reason the classifier is a
 * function over a string rather than a loop body.
 */
export function classifyToken(token: string, gate: ResolvedEvidenceGate): Candidate | undefined {
  if (token === '') return undefined;
  if (isDeclaredExempt(token, gate)) return undefined;

  // Declared shapes first — the app knows its own domain better than the
  // heuristics below, including when a shape has no digits at all.
  for (const shape of gate.shapes) {
    if (shape.match.test(token)) return { value: token, shape: shape.name };
  }

  // Rule 1 — no digit, no candidate. Prose is alphabetic.
  if (countDigits(token) === 0) return undefined;

  // Rule 3 — prose wearing a number.
  if (PROSE_RATIO.test(token)) return undefined;
  const withTail = NUMBER_WITH_TAIL.exec(token);
  const numeric = withTail
    ? normalizeToken(withTail[1]!)
    : BARE_NUMBER.test(token)
    ? token
    : undefined;
  if (numeric !== undefined) {
    // A quantity — judged on its digits only, so `32G` and `47th` are prose
    // while `41200iops` is still a reading.
    return countDigits(numeric) >= gate.minDigits ? { value: numeric, shape: 'number' } : undefined;
  }

  // Rule 2 — an identifier: digits mixed with letters or structure, long
  // enough to be distinctive. `po1` and `a1` are under the bar on purpose.
  if (token.length < 4) return undefined;
  if (!HAS_LETTER.test(token) && !STRUCTURAL.test(token)) return undefined;
  return { value: token, shape: 'identifier' };
}

/**
 * Every distinct value the answer asserts, in first-appearance order.
 *
 * De-duplicated by value: a port named six times is one claim to ground, and
 * a correction that lists it six times reads like noise.
 */
export function extractCandidates(
  answer: string,
  gate: ResolvedEvidenceGate,
): readonly Candidate[] {
  const seen = new Set<string>();
  const out: Candidate[] = [];
  let budget = MAX_ANSWER_TOKENS;
  for (const token of tokenize(answer)) {
    if (budget-- <= 0) break;
    const candidate = classifyToken(token, gate);
    if (candidate === undefined || seen.has(candidate.value)) continue;
    seen.add(candidate.value);
    out.push(candidate);
  }
  return out;
}
