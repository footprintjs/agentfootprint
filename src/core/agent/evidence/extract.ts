/**
 * extract — which tokens in an answer are DATA, and therefore have to be
 * grounded in a tool result.
 *
 * Pattern: a pure classifier over normalized tokens and the small shared
 *          range/precision leaves, so it can be unit-tested on strings with no agent, no
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

import {
  answerTokenSpellings,
  countDigits,
  lookupForms,
  normalizeToken,
  tokenize,
} from '../../../tools/normalize.js';
import { splitNumericRange } from './numericRanges.js';
import { decimalsOf } from './numberPrecision.js';
import type { ResolvedEvidenceGate, UnsupportedValue } from './types.js';

/**
 * A value the answer asserts, and the rule that made it one. `token` is the
 * glued-unit spelling the value was read off (`1007us` for the value
 * `1007`), present only when there was one — the lookup meets the result
 * under that spelling too (`candidateForms`), and the index is never
 * widened to do it (9.110.0).
 */
export type Candidate = UnsupportedValue & {
  readonly token?: string;
  /** The precision the answer actually wrote, only under the decimal dial. */
  readonly decimalSpelling?: string;
  /** An intact range can ground or exempt both of the endpoints it spelled. */
  readonly rangeToken?: string;
};

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
export function classifyToken(
  token: string,
  gate: ResolvedEvidenceGate,
  /** Under the figures dial: the numbers the answer writes wearing a unit
   *  (`figures.ts` · `figureNumbersOf`). A number in it is a candidate
   *  whatever its digit count — `53.2%` and `6.3 TB` are readings. */
  figures?: ReadonlySet<string>,
): Candidate | undefined {
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
    // while `41200iops` is still a reading. The glued spelling rides along
    // so the lookup can meet a result that carried it that way.
    if (countDigits(numeric) < gate.minDigits) {
      // A FIGURE — a number wearing a unit of measure — is a reading off a
      // screen whatever its length (`figures.ts`, rule 1). Off, never reached.
      if (figures?.has(numeric) !== true) return undefined;
      return withTail !== null && token !== numeric
        ? { value: numeric, shape: 'figure', token }
        : { value: numeric, shape: 'figure' };
    }
    return withTail !== null && token !== numeric
      ? { value: numeric, shape: 'number', token }
      : { value: numeric, shape: 'number' };
  }

  // Rule 2 — an identifier: digits mixed with letters or structure, long
  // enough to be distinctive. `po1` and `a1` are under the bar on purpose.
  if (token.length < 4) return undefined;
  if (!HAS_LETTER.test(token) && !STRUCTURAL.test(token)) return undefined;
  return { value: token, shape: 'identifier' };
}

/**
 * The texts an answer states, each read on its own. Prose is one text. A
 * typed answer — the whole answer one JSON object or array, which is what
 * `.outputSchema()` accepts (`JSON.parse` of the answer) — is read value by
 * value, the way the evidence index reads a result (`evidenceIndex.ts` ·
 * `walk`): every key and every string as text, every number as its own
 * spelling. Read whole as text, compact JSON glues its punctuation onto the
 * values: `[5,100]` read as the thousands-separated `5100`, `[0.45,0.12]` as
 * one identifier no result carries, `[1200,9750]` as no value at all — a
 * correct answer accused, or an invented one never looked up.
 *
 * Walked with an explicit stack (an answer is model output: its nesting is not
 * a call depth), and no further than `MAX_ANSWER_TOKENS` texts.
 */
function answerTexts(answer: string): readonly string[] {
  const opening = answer.trimStart()[0];
  if (opening !== '{' && opening !== '[') return [answer];
  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch {
    return [answer];
  }
  const texts: string[] = [];
  // Pushed in reverse so they pop in the order the answer wrote them.
  const stack: unknown[] = [parsed];
  while (stack.length > 0 && texts.length < MAX_ANSWER_TOKENS) {
    const node = stack.pop();
    if (typeof node === 'string') texts.push(node);
    else if (typeof node === 'number') texts.push(String(node));
    else if (Array.isArray(node)) for (let i = node.length - 1; i >= 0; i--) stack.push(node[i]);
    else if (node !== null && typeof node === 'object') {
      const entries = Object.entries(node);
      for (let i = entries.length - 1; i >= 0; i--) {
        const entry = entries[i];
        if (entry !== undefined) stack.push(entry[1], entry[0]);
      }
    }
  }
  return texts;
}

/**
 * The spellings a candidate is looked up under: its value's forms
 * (`lookupForms` — the `0x` rule), plus the glued-unit token's when the
 * value was read off one. The LOOKUP side widens, the index never does: a
 * result carrying `1007us` grounds an answer's `1007us`, while a result
 * carrying `latency 2024ms` does not ground an answer's prose year `2024`
 * — that candidate came from a bare token and asks for `2024` alone. The
 * one place both the gate (`gate.ts · checkAnswer`) and the contingent
 * check (`findings/contingent.ts`) take a candidate's forms from.
 */
export function candidateForms(candidate: Candidate): readonly string[] {
  const forms = [...lookupForms(candidate.value)];
  for (const token of [candidate.token, candidate.rangeToken]) {
    if (token === undefined) continue;
    for (const form of lookupForms(token)) if (!forms.includes(form)) forms.push(form);
  }
  return forms;
}

/**
 * Every distinct value the answer asserts, in first-appearance order.
 *
 * De-duplicated by value: a port named six times is one claim to ground, and
 * a correction that lists it six times reads like noise. A typed answer is
 * read value by value (`answerTexts`).
 */
export function extractCandidates(
  answer: string,
  gate: ResolvedEvidenceGate,
  /** Under the figures dial: the numbers the answer writes wearing a unit
   *  (`figures.ts` · `figureNumbersOf`, computed by the caller that loaded
   *  it — the module stays off a plain agent's graph). */
  figures?: ReadonlySet<string>,
  /** A read-only exact-token view supplied by the caller's corpus. Whole
   *  carried values win before a numeric range is interpreted as endpoints. */
  exactTokens?: { readonly has: (value: string) => boolean },
): readonly Candidate[] {
  const seen = new Map<string, number>();
  const out: Candidate[] = [];
  let budget = MAX_ANSWER_TOKENS;
  const record = (candidate: Candidate | undefined): void => {
    if (candidate === undefined) return;
    const prior = seen.get(candidate.value);
    if (prior !== undefined) {
      // One value may be written at two precisions. Check the stricter one;
      // an earlier coarse spelling cannot launder a later overprecise claim.
      const previous = out[prior];
      if (
        candidate.decimalSpelling !== undefined &&
        decimalsOf(candidate.decimalSpelling) > decimalsOf(previous?.decimalSpelling ?? '')
      )
        out[prior] = candidate;
      return;
    }
    seen.set(candidate.value, out.length);
    out.push(candidate);
  };
  const add = (spelling: string, rangeToken?: string): void => {
    if (budget-- <= 0) return;
    const token = normalizeToken(spelling);
    let candidate = classifyToken(token, gate, figures);
    // Declared shapes and exemptions win, including over precision promotion.
    if (
      gate.decimalRounding === true &&
      /^[-+]?\d+\.\d+$/.test(spelling) &&
      !isDeclaredExempt(token, gate) &&
      !gate.shapes.some((shape) => shape.match.test(token))
    ) {
      candidate = { value: token, shape: 'number', decimalSpelling: spelling };
    }
    record(
      candidate !== undefined && rangeToken !== undefined
        ? { ...candidate, rangeToken }
        : candidate,
    );
  };
  for (const text of answerTexts(answer)) {
    if (budget <= 0) break;
    const spellings = answerTokenSpellings(text);
    for (let index = 0; index < spellings.length; index += 1) {
      if (budget <= 0) break;
      const spelling = spellings[index] ?? '';
      const token = normalizeToken(spelling);
      // Test app-owned ID declarations on the intact token before heuristics.
      if (isDeclaredExempt(token, gate) || gate.shapes.some((shape) => shape.match.test(token))) {
        add(spelling);
        continue;
      }
      const range = splitNumericRange(spelling, spellings[index + 1]);
      if (range !== undefined && exactTokens?.has(token) === true) {
        budget -= 1;
        record({ value: token, shape: 'identifier' });
        continue;
      }
      if (range !== undefined) {
        const suffix = range.unit ?? '';
        add(`${range.first}${suffix}`, token);
        add(`${range.last}${suffix}`, token);
        continue;
      }
      // An en dash outside our narrow grammar retains the tokenizer's old meaning.
      for (const piece of spelling.includes('–') ? tokenize(spelling) : [spelling]) add(piece);
    }
  }
  return out;
}
