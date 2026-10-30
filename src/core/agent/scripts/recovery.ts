/**
 * scripts/recovery — the one clause the evidence revision request gains under
 * `code: 'match'`: keep the script, fix the values.
 *
 * Pattern: Lens — a library sentence about a FINISHED call, composed from the
 *          match's verdict, in the past tense, naming no tool as where to go
 *          next (`core/agent/README.md`, the correction law). Request-only:
 *          it rides the internal recovery instruction (`../evidence/recovery.ts`
 *          · `buildEvidenceRecovery`), never history.
 * Role:    core/ layer. Composed by the Route decider, which holds this turn's
 *          rows, and carried to the recheck stage on `evidenceUnsupported`.
 * Emits:   N/A.
 *
 * Two clauses, chosen by what the verdict holds (design § 7):
 *
 * - a block that matched no submission, and a flagged value that sat only in
 *   such a block — its contents were checked as prose: keep a script, show it
 *   exactly as submitted, or say the code shown is not the one submitted, and
 *   fix the values in the prose;
 * - a block that matched a call, with values flagged in the prose — the
 *   script was not checked: keep it; the listed values were in the prose.
 *
 * The parenthesis carries the call's ACTUAL label in its words
 * (`label.ts` · `labelWords`) — never a fixed "executed", never an exit
 * number the record does not hold.
 *
 * WHAT IT CANNOT DO, stated: deleting an unmatched block removes its
 * candidates and the `script-unmatched` reason, so a draft without the script
 * can pass the check. No sentence makes a model keep a script; mandatory
 * display comes from `.scriptTravelsWithTheAnswer()`, which needs no
 * cooperation from the model.
 *
 * @example
 * ```ts
 * scriptRecoveryClause({ blocks: [{ block: 1, label: 'completed-with-failure', exitCode: 7,
 *   toolCallId: 'c1', tool: 'run_code' }], earlierTurnRows: 0, regionsDropped: 0 },
 *   [{ value: '1200', shape: 'number', region: 'prose' }], ['run_code']);
 * // 'The script shown is the one submitted to `run_code` on call c1 (completed with failure,
 * //  exit 7) and was not checked. Keep it. The listed values were in the prose around it.'
 * ```
 */

import { labelWords } from './label.js';
import type { ScriptsVerdict } from './types.js';

/** A flagged value as the clause reads it — its region under `code: 'match'`. */
interface FlaggedValue {
  readonly region?: 'prose' | 'code';
}

/** `run_code`, `` `a` or `b` `` — the tools named, quoted. */
function toolsNamed(tools: readonly string[]): string {
  const quoted = tools.map((t) => `\`${t}\``);
  if (quoted.length === 0) return 'a code-running tool';
  if (quoted.length === 1) return quoted[0] as string;
  return `${quoted.slice(0, -1).join(', ')} or ${quoted[quoted.length - 1]}`;
}

/**
 * The clause(s) for one rejected draft — `''` when the verdict calls for
 * none (no fenced block, or no flagged value the blocks bear on).
 * `toolsThisTurn` names the code-running tools this turn's calls submitted
 * to, in first-call order.
 */
export function scriptRecoveryClause(
  scripts: ScriptsVerdict,
  unsupported: readonly FlaggedValue[],
  toolsThisTurn: readonly string[],
): string {
  const clauses: string[] = [];
  const unmatched = scripts.blocks.some((b) => b.label === 'unmatched');
  if (unmatched && unsupported.some((v) => v.region === 'code')) {
    clauses.push(
      `The fenced code in the rejected draft matched no submission to ${toolsNamed(
        toolsThisTurn,
      )} recorded this turn, so its contents were checked as prose. Keep a script in the ` +
        'answer: show the program exactly as it was submitted on that call, byte for byte, or ' +
        'say that the code shown is not the one that was submitted. Fix the values in the prose.',
    );
  }
  const matched = scripts.blocks.flatMap((b) => (b.label === 'unmatched' ? [] : [b]));
  if (matched.length > 0 && unsupported.some((v) => v.region === 'prose')) {
    const calls = matched.map(
      (b) => `to \`${b.tool}\` on call ${b.toolCallId} (${labelWords(b.label, b.exitCode)})`,
    );
    clauses.push(
      matched.length === 1
        ? `The script shown is the one submitted ${calls[0]} and was not checked. Keep it. The ` +
            'listed values were in the prose around it.'
        : `The scripts shown are the ones submitted ${calls.join(' and ')} and were not checked. ` +
            'Keep them. The listed values were in the prose around them.',
    );
  }
  return clauses.join(' ');
}
