/**
 * types — the public vocabulary of `.namesAndNumbersFromEvidence()`.
 *
 * Pattern: one options interface the builder validates once into a resolved
 *          config the chart carries (the `ResolvedOutputEnforcement` shape).
 * Role:    core/ layer. Nothing here runs; it is the contract.
 * Emits:   N/A.
 */

import type { AnswerGroundingReading } from '../../../integrity/prior-turn-evidence/check.js';

/**
 * How hard the check pushes back. **Same three words as the skill-graph
 * routing dial, deliberately** — one posture vocabulary across the library —
 * but a SEPARATE option, because routing authority and evidence discipline are
 * different decisions and an app may legitimately want strict routing with
 * loose evidence (or the reverse).
 *
 *   • `'assist'` — **the default.** Record and flag. The answer goes out
 *     exactly as the model wrote it; nothing loops, nothing is withheld. Pure
 *     observability: you learn how often it happens before you decide to act.
 *   • `'guard'` — in-loop correction. The unsupported values are named back to
 *     the model, it gets ONE more turn, and if they survive that turn the
 *     answer ships flagged. This is the posture that makes a small model
 *     behave like a bigger one, and it is the recommended setting for weaker
 *     models.
 *   • `'rails'` — `'guard'` plus a refusal: if the values survive the one
 *     revision, `run()` raises instead of returning the answer.
 */
export type EvidencePosture = 'assist' | 'guard' | 'rails';

/**
 * A domain's own identifier shape.
 *
 * The default extractor guesses conservatively from punctuation and digits (see
 * `extract.ts`). It cannot know that `SHPMAXDLVAP001-FA0` is an array alias or
 * that `ORD-4471` is an order number, and it deliberately does NOT flag things
 * that look like prose. Declaring a shape says "in MY domain, a token that
 * looks like this is data" — the declared set composes WITH the default rules
 * rather than replacing them.
 *
 * The pattern is matched against a whole token, so `^` / `$` are unnecessary
 * (harmless if present). `g` / `y` flags are stripped at resolve time — a
 * stateful regex reused across tokens skips matches.
 */
export interface EvidenceShape {
  /** Short name. Appears on the flagged value so a reader knows which rule
   *  caught it. Must be unique within one agent. */
  readonly name: string;
  /** The pattern. Matched against a whole normalized token. */
  readonly match: RegExp;
}

/** Options for `.namesAndNumbersFromEvidence()`. */
export interface NamesAndNumbersOptions {
  /** Default `'assist'` — record and flag, change nothing. */
  readonly posture?: EvidencePosture;
  /** Extra identifier shapes for this domain. Composes with the defaults. */
  readonly shapes?: readonly EvidenceShape[];
  /**
   * Values (or patterns) that are never flagged, whatever the extractor
   * thinks. A literal string is compared after normalisation; a RegExp is
   * matched against a whole token.
   *
   * Values the USER supplied are already exempt without declaring anything —
   * this is for the rest: a build number your prompt does not carry, a
   * constant your app knows is safe.
   */
  readonly exempt?: readonly (string | RegExp)[];
  /**
   * How many digits a BARE number needs before it is treated as data rather
   * than prose. Default `4`.
   *
   * `3 issues`, `24 hours`, `47 flaps` and `892 CRC errors` are ordinary
   * English and must never trip the gate; `41,200` is a reading off a screen.
   * Four digits is where that line sits in the material we measured. Lower it
   * only if your domain's numbers are genuinely small and you accept the false
   * positives that follow.
   */
  readonly minDigits?: number;
  /**
   * The staged-refs nudge. Default `false` — off, byte-identical.
   *
   * When an iteration's context carries tool results staged by reference
   * (`artifacts.placement` tickets) AND a tool the model can currently call
   * declares `wants` over one of their kinds, the library appends ONE short
   * line at the END of that request naming the refs and the spender tool:
   * derived numbers come from the tool, not from mental arithmetic. Composed
   * entirely from declarations (`Tool.resultKind` / `Tool.wants`) — no app
   * prose — and placed late because the measured failure was recency: the
   * app's own "use the compute tool" instruction sat at the top of the
   * context while the numbers sat at the bottom, and the model summed them
   * in its head. The line is request-only (never history) and recomposed per
   * iteration, so it exists exactly while both conditions hold. Each firing
   * lands as `agentfootprint.agent.grounding_nudged`.
   *
   * Advisory — the postures above stay the guarantee. An agent with no
   * artifact placement or no `wants`-declaring tool arms nothing and keeps
   * byte-identical requests.
   */
  readonly nudge?: boolean;
}

/** One value in the answer that no tool result carried. */
export interface UnsupportedValue {
  /** The value as it appeared in the answer, normalized and truncated. */
  readonly value: string;
  /** Which rule made it a candidate: `'identifier'`, `'number'`, or the name
   *  of a declared {@link EvidenceShape}. */
  readonly shape: string;
}

/**
 * What the builder resolved once and the chart carries for the whole run.
 *
 * Regexes live here rather than in scope for the reason a parser does: scope
 * values must survive `structuredClone`, and a RegExp does not survive it
 * usefully.
 *
 * @internal
 */
export interface ResolvedEvidenceGate {
  readonly posture: EvidencePosture;
  /** Declared shapes, with `g`/`y` stripped and anchored to a whole token. */
  readonly shapes: readonly EvidenceShape[];
  /** Declared exemptions, normalized (strings) / anchored (patterns). */
  readonly exemptValues: ReadonlySet<string>;
  readonly exemptPatterns: readonly RegExp[];
  readonly minDigits: number;
  /** The staged-refs nudge dial. `false` is today's bytes. */
  readonly nudge: boolean;
}

/** The gate's verdict on one answer. */
export interface EvidenceVerdict {
  /** Values that no tool result carried. Empty means the answer is clean. */
  readonly unsupported: readonly UnsupportedValue[];
  /** How many distinct values the extractor had to ground. */
  readonly candidates: number;
  /**
   * True when the evidence index hit its ceiling and is INCOMPLETE.
   *
   * A partial index can call a grounded value fabricated, so the gate refuses
   * to act on one: it records the verdict and behaves as `'assist'` whatever
   * the posture says. An accusation from a half-read corpus is worse than no
   * accusation.
   */
  readonly evidenceTruncated: boolean;
  /**
   * WHEN the answer's grounded values were read (9.83.0) — the same pass,
   * one time axis.
   *
   * Always computed, because it is three counters over a loop that was
   * already running. It is only READ when the operator armed
   * `AgentOptions.noticePriorTurnEvidence`, which is what turns it into a
   * `prior-turn-evidence` finding; nothing else in the gate consults it and
   * no posture changes because of it.
   */
  readonly grounding: AnswerGroundingReading;
}
