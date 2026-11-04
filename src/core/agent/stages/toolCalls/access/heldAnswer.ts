import type { ToolMiddleware } from '../../../middleware/types.js';
import { type DecisionLedger, heldDecision, gatedCallOf } from '../../../../consentRequest.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { ConsentGateKind } from '../../../../pause.js';
import type { CheckInDecision } from '../../../../checkin.js';

/** Bind a resumed consent decision using the current middleware view. */
export function buildHeldAnswer(
  readMiddleware: () => readonly ToolMiddleware[] | undefined,
  decisionLedger: DecisionLedger,
) {
  /**
   * The decision a consent-gate resume carries, held to the request this run
   * paused on and to the exact call it was bound to (`core/consentRequest.ts`)
   * — or a `ResumeDecisionError` / `DecisionRequiredError`, thrown before
   * anything about the call runs. Pure: the decision is spent by the branch
   * that USES it (`spendDecision`), so a resume stopped before that (a refused
   * findings reference) leaves it unspent.
   *
   * THE door every resume of a consent gate passes through: an agent's own
   * `resume()` asks the same pure question first, but a composition resumes a
   * nested agent's chart directly, and only this handler sees every decision
   * that is used. So this is where a request is held and spent, once.
   */
  const heldAnswer = (
    scope: TypedScope<AgentState>,
    input: unknown,
    gate: ConsentGateKind,
  ): CheckInDecision => {
    const read = (key: string): unknown => scope.$getValue(key);
    const toolName = read('pausedToolName');
    const middleware = gate === 'ask' ? read('pausedAskMiddleware') : undefined;
    return heldDecision(
      input,
      {
        kind: gate,
        ...(typeof toolName === 'string' && { toolName }),
        ...(typeof middleware === 'string' && { middleware }),
      },
      read('pausedRequest'),
      gatedCallOf(read, gate),
      // An ask's approval holds only for the rules it was asked under — this
      // agent's chain, by link name.
      (readMiddleware() ?? []).map((link) => link.name),
      // …and a request minted under a ledger that can prove is spent only
      // there: never silently in this agent's ledger if it is another one.
      decisionLedger,
    );
  };
  return heldAnswer;
}
