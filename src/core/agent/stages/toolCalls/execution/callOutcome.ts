import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ToolResultStatus } from '../../../../../semantics/toolOutcome.js';

/** What every door knows about a call when it commits the call's message. */
export interface SettledCall {
  /** `execute` was entered and no gate refused the call. */
  readonly ran: boolean;
  /** It ran without throwing and its result was not withheld. */
  readonly clean: boolean;
  /** The tool's DECLARED status (an effects envelope), when it gave one. */
  readonly status?: ToolResultStatus;
  /**
   * The word a tool wrote as `status` in a value that is an envelope but for
   * that word, which names none of the library's seven
   * (`semantics/toolEffects.ts` · `unknownStatusOf`, cleaned). The call
   * declared no status; only the procedure step reads this, to name the word
   * instead of saying the tool declared nothing. `callOutcomeOf` ignores it.
   */
  readonly unknownStatus?: string;
}

/**
 * THE ONE RULE for `LLMMessage.outcome`: how a tool call settled, read from
 * what the dispatch already knows — never from the result's words.
 *
 * Why: the check-in trail shows a person approving a call whether each earlier
 * call worked. It used to guess from the first words of the tool message, so a
 * tool that threw ("connection refused") read as ok and a tool that returned
 * "declined by human: …" read as refused. The dispatch doors that commit a
 * call's result (the batch loop, `deliveredResult.ts`, and the check-in, ask
 * and credential resumes) ask this function, so one call cannot be judged two
 * ways by which of them it came through. Doors that commit a tool message
 * without asking it: a plain resume (`resume/plain.ts` — the person's answer
 * IS the result, so absent is right); a call a paused batch never dispatched
 * (`batch/settlementOperations.ts`, marked `notDispatched`, which the trail
 * skips); and the host's notices (`hosting/answeredPause.ts`,
 * `hosting/standingAgent/turn/run.ts`), which read as not completed when
 * they carry `toolResultOrigin` (always in `answeredPause.ts`; the standing
 * agent's cancel notice only when findings admission is on).
 *
 * It answers "did the call complete?", not "was `execute` entered?":
 * `'refused'` also covers a tool that ran and declared `'denied'`.
 *
 * - did not run (a gate, a person or a credential stopped it) → `'refused'`
 * - ran but threw, or its result was withheld (`clean: false`) → `'failed'`
 * - ran clean, and the tool DECLARED a status (an effects envelope):
 *   `'denied'` → `'refused'`; `'failure'` / `'invalid'` → `'failed'`
 * - otherwise → absent: the call completed. A plain `{ status: 'failed' }`
 *   result is the tool's own words; it is not parsed.
 *
 * @example callOutcomeOf({ ran: true, clean: false })                    // 'failed'
 * @example callOutcomeOf({ ran: true, clean: true, status: 'partial' }) // undefined
 */
export function callOutcomeOf(call: SettledCall): LLMMessage['outcome'] {
  if (!call.ran) return 'refused';
  if (!call.clean) return 'failed';
  if (call.status === 'denied') return 'refused';
  if (call.status === 'failure' || call.status === 'invalid') return 'failed';
  return undefined;
}

/** The field to spread onto a committed tool message: `{ outcome }`, or nothing for a completed call. */
export function outcomeField(call: SettledCall): Pick<LLMMessage, 'outcome'> {
  const outcome = callOutcomeOf(call);
  return outcome === undefined ? {} : { outcome };
}
