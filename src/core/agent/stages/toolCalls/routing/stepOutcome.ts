import type { SettledCall } from '../execution/callOutcome.js';

/**
 * How a finished call bears on the procedure step it ran.
 *
 * - `'succeeded'` — the tool declared `success`, or `absent` (it looked and
 *   found nothing: the look is finished, so the step is done). The step
 *   advances, and the declared word rides along (`status`), so the record
 *   tells a nothing-found from a plain success.
 * - `'failed'` — the tool declared `failure`, `denied` or `invalid`. The step holds.
 * - `'not-finished'` — the tool declared `pending` or `partial`. The step holds.
 * - `'not-reported'` — the tool declared no status. The step advances, and
 *   the model and the record are told that its tool declared no status. When
 *   the tool wrote a status word the library does not know, in a value that
 *   is an envelope but for that word, the word rides along (`unknownStatus`,
 *   cleaned) and is told instead: a tool with its own vocabulary must not
 *   lock a procedure, and must not be described as having said nothing.
 * - `'stopped'` — the library already stopped the call: it did not run (a
 *   permission denial, a declined check-in, a blocked credential), it threw,
 *   or the library withheld its result (a result ceiling). The step holds
 *   silently, exactly as it did before steps read declared statuses: each of
 *   those already tells the model its own reason.
 *
 * A held outcome carries the status the tool declared, so the event and the
 * sentence name it without a second reading.
 */
export type StepOutcome =
  | { readonly outcome: 'succeeded'; readonly status: 'success' | 'absent' }
  | { readonly outcome: 'not-reported'; readonly unknownStatus?: string }
  | { readonly outcome: 'failed'; readonly status: 'failure' | 'denied' | 'invalid' }
  | { readonly outcome: 'not-finished'; readonly status: 'pending' | 'partial' }
  | { readonly outcome: 'stopped' };

/**
 * THE ONE RULE for a procedure step: did the call that just finished complete
 * it? Every door a step can advance through asks this — the batch loop
 * (`execution/deliveredResult.ts` · `landCallResult`) and the plain,
 * check-in, ask and credential resumes (`resume/*.ts`) — through
 * `stepsOperations.ts` · `applyStepReturn`, so a step cannot count as done
 * through one door and held through another.
 *
 * Why: a step used to advance whenever its tool returned without throwing,
 * so a tool that returned `{ content, effects: [], status: 'failure' }` moved
 * the procedure on, offered the next step's tool, and the model read
 * "Step 1 of 2 done." The step is done only when its tool says so.
 *
 * It reads the facts every door already hands `execution/callOutcome.ts` ·
 * `callOutcomeOf` (the reading behind `LLMMessage.outcome`) and agrees with
 * it: a call that function records as failed or refused never completes a
 * step (pinned by `stepOutcome.test.ts`). It answers a different question,
 * so it adds what only a step needs: `pending` / `partial` are not
 * finished, a call with no declared status is told apart from a declared
 * success, and an unknown status word is carried to be told.
 *
 * A status word reaches here already read (`semantics/toolOutcome.ts` ·
 * `readToolResultStatus`: `'FAILURE'` is `'failure'`), so a second spelling
 * of a known word is decided as that word.
 *
 * @example stepOutcomeOf({ ran: true, clean: true, status: 'failure' }) // { outcome: 'failed', status: 'failure' }
 * @example stepOutcomeOf({ ran: true, clean: true })                    // { outcome: 'not-reported' }
 * @example stepOutcomeOf({ ran: true, clean: true, unknownStatus: 'oops' }) // { outcome: 'not-reported', unknownStatus: 'oops' }
 * @example stepOutcomeOf({ ran: true, clean: false })                   // { outcome: 'stopped' }
 */
export function stepOutcomeOf(call: SettledCall): StepOutcome {
  if (!call.ran || !call.clean) return { outcome: 'stopped' };
  const status = call.status;
  switch (status) {
    case undefined:
      return call.unknownStatus === undefined
        ? { outcome: 'not-reported' }
        : { outcome: 'not-reported', unknownStatus: call.unknownStatus };
    case 'success':
    case 'absent':
      return { outcome: 'succeeded', status };
    case 'pending':
    case 'partial':
      return { outcome: 'not-finished', status };
    case 'failure':
    case 'denied':
    case 'invalid':
      return { outcome: 'failed', status };
    default: {
      // Stops compiling the day the status vocabulary grows, so a new word
      // gets a decision here instead of slipping through as done.
      const unmapped: never = status;
      void unmapped;
      return { outcome: 'stopped' };
    }
  }
}
