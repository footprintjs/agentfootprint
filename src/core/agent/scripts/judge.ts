/**
 * scripts/judge — the evidence gate's ONE judge, with the script match in
 * front of it.
 *
 * Pattern: Decorator over the judge closure `stages/route.ts` ·
 *          `judgeEvidence` builds (the gate bound to this run's evidence).
 * Role:    core/ layer. Built only under `.namesAndNumbersFromEvidence({
 *          code: 'match' })`, on a prose answer (a typed answer is read as
 *          today — design § 12). The same decorated closure judges the draft
 *          and, for `.answerValidation()`, the delivered candidate.
 * Emits:   N/A — the Route decider emits `evidence_checked`, now carrying
 *          `scripts` and each unsupported value's `region`.
 *
 * What it adds, and nothing else: the matched blocks are cut out of the text
 * the gate reads (`match.ts`), the verdict carries `scripts`, and each
 * unsupported value says where it sat — `'code'` when every occurrence of it
 * is inside an unmatched block, `'prose'` otherwise. The corpus and the
 * exempt corpus are untouched: a matched script grounds nothing.
 */

import type { EvidenceVerdict } from '../evidence/types.js';
import { readShownScripts } from './match.js';
import type { TurnScripts } from './rows.js';

/** The gate's judge with the script match in front of it. */
export function scriptJudge(input: {
  /** The gate's judge — `checkAnswer` bound to this run's evidence. */
  readonly judgeProse: (text: string) => EvidenceVerdict;
  /**
   * The values the gate's extractor reads in a text, spelled as a verdict
   * reports them (normalized, clipped) — asked of the answer with every block
   * cut out, to place each unsupported value.
   */
  readonly valuesIn: (text: string) => ReadonlySet<string>;
  /** This turn's script rows (`rows.ts` · `scriptRowsOfTurn`). */
  readonly turn: TurnScripts;
  /** `AgentState.scriptsDropped`, when calls past the per-turn cap were dropped. */
  readonly scriptsDropped?: number;
}): (text: string) => EvidenceVerdict {
  return (text) => {
    const shown = readShownScripts(text, input.turn, input.scriptsDropped);
    const verdict = input.judgeProse(shown.prose);
    const inProse =
      verdict.unsupported.length > 0 ? input.valuesIn(shown.outsideCode) : new Set<string>();
    return {
      ...verdict,
      unsupported: verdict.unsupported.map((value) => ({
        ...value,
        region: inProse.has(value.value) ? ('prose' as const) : ('code' as const),
      })),
      scripts: shown.verdict,
    };
  };
}
