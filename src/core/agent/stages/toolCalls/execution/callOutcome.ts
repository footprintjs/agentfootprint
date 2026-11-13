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
}

/**
 * THE ONE RULE for `LLMMessage.outcome`: how a tool call settled, read from
 * what the dispatch already knows — never from the result's words.
 *
 * Why: the check-in trail shows a person approving a call whether each earlier
 * call worked. It used to guess from the first words of the tool message, so a
 * tool that threw ("connection refused") read as ok and a tool that returned
 * "declined by human: …" read as refused. Every door that commits a tool
 * message (the batch loop and the check-in, ask and credential resumes) asks
 * this function, so one call cannot be judged two ways by which door it came
 * through.
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
