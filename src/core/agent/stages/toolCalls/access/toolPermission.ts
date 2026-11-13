import type { buildCallStart } from '../execution/callStart.js';
import type { buildDispatchContext } from '../batch/dispatchContext.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import type { ToolCallEntry } from '../../../../../provider-contract/types.js';
import type { CallExecution, CallResultCell } from '../contracts/callCells.js';
import { extractSequence } from '../../../../../security/extractSequence.js';
import { checkerContextOf } from './bindings.js';
import { warnFrozenWrite } from '../../../../../lib/frozenCopy.js';
import type { DispatchCall } from '../contracts/batchCall.js';

type CallStartFacts = ReturnType<ReturnType<typeof buildCallStart>['beginDispatchCall']>;
type DispatchContext = ReturnType<
  ReturnType<typeof buildDispatchContext>['prepareDispatchContext']
>;

interface CheckToolPermissionFrame {
  readonly historyForCallbacks: CallStartFacts['historyForCallbacks'];
  readonly iteration: number;
  readonly permissionChecker: NonNullable<ToolCallsHandlerDeps['permissionChecker']>;
  readonly tc: DispatchCall;
  readonly viewOf: CallStartFacts['viewOf'];
  readonly runArgs: ToolArgs;
  readonly runIdentity: DispatchContext['runIdentity'];
  readonly env: DispatchContext['env'];
  readonly emitSecurity: CallStartFacts['emitSecurity'];
  readonly execution: CallExecution;
  readonly outcome: CallResultCell;
  /**
   * For an inner call (`ctx.tools.call`) only: the inner calls of the same
   * outer call that already ran, after the history's sequence. They reach
   * history with the outer call's result; until then, this is where they are.
   */
  readonly innerCallsSoFar?: () => readonly ToolCallEntry[];
}

/** Existing toolPermission body; the owning handler retains its admission guard and native pause return. */
export async function checkToolPermission(frame: CheckToolPermissionFrame) {
  try {
    // Sequence is derived from history at check time (not parallel
    // state) — single source of truth, survives resumeOnError. An inner
    // call adds its outer call's inner calls that already ran: they are
    // written to history with the outer call's result, not before.
    const sequence = [
      ...extractSequence(frame.historyForCallbacks(), frame.iteration),
      ...(frame.innerCallsSoFar?.() ?? []),
    ];
    const decision = await frame.permissionChecker.check({
      capability: 'tool_call',
      actor: 'agent',
      target: frame.tc.name,
      // The call's shared frozen copy, never the arguments it runs with.
      context: checkerContextOf(frame.viewOf(frame.runArgs)),
      sequence,
      history: frame.historyForCallbacks(),
      iteration: frame.iteration,
      ...(frame.runIdentity && { identity: frame.runIdentity }),
      ...(frame.env.signal && { signal: frame.env.signal }),
    });
    frame.emitSecurity('agentfootprint.permission.check', {
      capability: 'tool_call',
      actor: 'agent',
      target: frame.tc.name,
      result: decision.result,
      ...(decision.policyRuleId !== undefined && { policyRuleId: decision.policyRuleId }),
      ...(decision.rationale !== undefined && { rationale: decision.rationale }),
      ...(decision.reason !== undefined && { reason: decision.reason }),
    });
    // LENS · tool-result · persistent-history
    // reads: the checker's own words ← decision.tellLLM ?? decision.rationale (an AUTHORITY omission: the rule space is never named)
    // known gap: the generic fallback anchors a per-call refusal to the whole run and is on the record as
    // unrepaired in test/modelFacingScan.test.ts · `LEDGER`, under this file's own key.
    // Do not widen it here without that test.
    // law: may omit, never deny; every clause anchored to the call it was composed on.
    if (decision.result === 'deny') {
      frame.execution.denied = true;
      // Deny default keeps the existing v2.4 shape (carries
      // rationale text — historically intentional, since deny
      // lets the LLM recover and rationale is consumer-supplied).
      const tellLLM = decision.tellLLM ?? `[permission denied: ${decision.rationale ?? 'policy'}]`;
      frame.outcome.result = tellLLM;
    } else if (decision.result === 'halt') {
      frame.execution.denied = true;
      // Halt default is DELIBERATELY GENERIC — never falls back
      // to `reason` (which is telemetry, e.g. 'security:exfiltration'
      // — leaking that to the LLM teaches it the rule space).
      // Consumers who want a richer message provide `tellLLM` explicitly.
      const tellLLM =
        decision.tellLLM ?? `Tool '${frame.tc.name}' is not available in this context.`;
      frame.outcome.result = tellLLM;
      frame.execution.haltContext = {
        reason: decision.reason ?? decision.rationale ?? 'policy-halt',
        tellLLM,
        ...(frame.permissionChecker.name && { checkerId: frame.permissionChecker.name }),
      };
    }
  } catch (permErr) {
    // A checker that wrote into its frozen `context` lands here too —
    // said once, in dev mode, so a checker that normalised in place
    // does not deny every call in silence.
    warnFrozenWrite('permission checker', permErr, 'the call was denied');
    // A checker that threw is treated as deny-by-default — fail closed:
    // something that did not answer did not say yes.
    //
    // ── What the MODEL is told, and why it changed in 9.4.0 ────────
    // It used to be told the checker's own error text. Those messages
    // are written for operators and read as WEATHER — "not available
    // right now", "ECONNREFUSED", "timed out" — so a model does the
    // reasonable thing and tries again. In a real deployment one did
    // exactly that, burned every iteration to `maxIterations`, and
    // returned the empty string; nobody could see why, because the
    // reason never left the tool result.
    //
    // The refusal is now TERMINAL and says so, in the bracketed form
    // the local policy has always used (`[permission denied: …]`) —
    // the one a model adapts to cleanly. The thrown message is an
    // operator's fact and stays on the typed event's `rationale`,
    // where it was already going: an outage is not something a model
    // should be invited to argue with, and infrastructure text does
    // not belong in a transcript.
    frame.execution.denied = true;
    const msg = permErr instanceof Error ? permErr.message : String(permErr);
    frame.emitSecurity('agentfootprint.permission.check', {
      capability: 'tool_call',
      actor: 'agent',
      target: frame.tc.name,
      result: 'deny',
      rationale: `permission-checker threw: ${msg}`,
    });
    frame.outcome.result =
      `[permission denied: Tool '${frame.tc.name}' could not be authorized. This will not ` +
      `change during this run — do not call it again. Continue without it, or say ` +
      `what you are unable to do.]`;
  }
}
