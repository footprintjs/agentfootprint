import { buildToolResolver } from '../../toolResolver.js';
import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { towersFor } from '../evidence/towers.js';
import { findingsReferenceRefusal } from '../../../findings/admission.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import type { ToolArgs } from '../../../../../tools/runChain.js';
import { bindToolSecurityEvents } from '../../../toolSecurityEvents.js';
import type { SplitFindings } from '../../../findings/reserved.js';
import { recordFindings, basisRowFrom } from '../../../findings/ledger.js';
import { contingentRowsOf, groundedArgumentValues } from '../../../findings/contingent.js';
import { frozenView, isSealed } from '../../../../../lib/frozenCopy.js';
import type { DispatchCall } from '../contracts/batchCall.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';
import type { ToolScriptsOperations } from '../contracts/operations/scripts.js';
import type { ToolObservationsOperations } from '../contracts/operations/observations.js';

interface CallStartLinks {
  readonly resolveTool: ReturnType<typeof buildToolResolver>;
  readonly peelCall: ToolCatalogOperations['peelCall'];
  readonly programOfCall: ToolScriptsOperations['programOfCall'];
  readonly turnStampOf: ToolCatalogOperations['turnStampOf'];
  readonly emitToolStart: ToolObservationsOperations['emitToolStart'];
}

/** Start one call with its original proposal, frozen views, records and clock. */
export function buildCallStart(
  deps: Pick<ToolCallsHandlerDeps, 'findings'>,
  links: CallStartLinks,
) {
  const beginDispatchCall = (
    scope: TypedScope<AgentState>,
    tc: DispatchCall,
    iteration: number,
    towers: ReturnType<typeof towersFor>,
    callIndex: number,
    toolCalls: readonly DispatchCall[],
    findingsRefusals: readonly ReturnType<typeof findingsReferenceRefusal>[],
    frozenTurn: LLMMessage | undefined,
    callbackHistory: () => LLMMessage[],
    frozenArgsAt: (at: number) => ToolArgs | undefined,
  ) => {
    const { resolveTool, peelCall, programOfCall, turnStampOf, emitToolStart } = links;
    const emitSecurity = bindToolSecurityEvents(scope, { toolCallId: tc.id, iteration });
    const resolved = resolveTool(tc.name);
    const tool = resolved.tool;
    // ── THE PEEL (9.101.0, `.findings()`) — the FIRST read of `tc.args`
    // in this loop. `args` is what the call runs with: `tool_start`, the
    // permission context and `callArgs` all read it, so `_findings`
    // never reaches middleware, `validateToolArgs` (a tool with
    // `additionalProperties: false` would refuse it under 'enforce'),
    // check-in evidence, wants, credentials, execute or a pause carrier.
    // A tool that OWNS the name keeps the value (`peelCall`). Unarmed the
    // same reference — `tc.args` — and not one byte moves.
    const peeled: SplitFindings = peelCall(tc);
    const args: ToolArgs = peeled.args;
    // The script record's proposal (`deps.scriptRecord`): the declared
    // argument's value, read as the call arrives — before any rule or tool
    // code runs. `undefined` unarmed.
    const proposedProgram = programOfCall(tool, args);
    // ── THE BASIS ROW — immediately, so it precedes `tool_start` in the
    // event log and every pause `return` in program order (a paused
    // call's row is on the pre-pause partial commit; a denied call keeps
    // its row — the declaration is a fact about the emission). Filed only
    // when the model DECLARED a basis; never inferred.
    if (deps.findings === true && peeled.findings?.basis !== undefined) {
      recordFindings(
        scope,
        [basisRowFrom(tc, peeled.findings, iteration, peeled.malformed)],
        turnStampOf(scope),
      );
    }
    // ── THE CONTINGENT ROWS FOR THIS CALL (9.110.0) — after the basis
    // row, before `tool_start`: the DATA values of the peeled arguments
    // that a set-aside result was the only source of. A fact about the
    // emission, filed whether or not the call then runs.
    if (towers !== undefined) {
      recordFindings(
        scope,
        contingentRowsOf(
          groundedArgumentValues(args, towers.gate, towers.corpus, towers.exempt),
          towers.corpus,
          towers.standingOf,
          { toolCallId: tc.id },
          iteration,
        ),
        turnStampOf(scope),
      );
    }
    // ── THIS CALL'S SHARED FROZEN COPY — `tool_start`, the permission
    // checker, a capability check and the check-in predicate (and, on a
    // pause, the request shown and its evidence assembler) all read ONE
    // frozen copy of the arguments, never the arguments the tool runs
    // with. The batch's copy when `args` is the call's own object;
    // remade only when the arguments are replaced, and after the
    // middleware chain (its links are handed the live arguments, by
    // contract, and may have edited them in place). Shared only while
    // freezing SEALED it (`isSealed` — every JSON value): arguments that
    // hold a `Map`, a `Set`, a `Date` or a typed array get a new copy for
    // each callback, so one cannot change what the next one judges.
    let viewed: ToolArgs | undefined;
    let view: ToolArgs | undefined;
    /** The batch's copy still shows these arguments — until a link could have edited them. */
    let batchCopyCurrent = true;
    const viewOf = (source: ToolArgs): ToolArgs | undefined => {
      if (source === viewed && view !== undefined) return view;
      const batchCopy =
        batchCopyCurrent && source === tc.args ? frozenArgsAt(callIndex) : undefined;
      const copy = batchCopy ?? frozenView(source);
      const shareable = copy !== undefined && isSealed(copy);
      viewed = shareable ? source : undefined;
      view = shareable ? copy : undefined;
      return copy;
    };
    /** The history this call's callbacks are handed — made once per call when sealed. */
    let callHistory: LLMMessage[] | undefined;
    const historyForCallbacks = (): LLMMessage[] => {
      if (callHistory !== undefined) return callHistory;
      const made = callbackHistory();
      if (frozenTurn === undefined || isSealed(frozenTurn)) callHistory = made;
      return made;
    };
    emitToolStart(
      scope,
      {
        toolName: tc.name,
        toolCallId: tc.id,
        args: viewOf(args) ?? args,
        ...(toolCalls.length > 1 && { parallelCount: toolCalls.length }),
      },
      tool,
    );
    const startMs = Date.now();
    const findingsRefusal = findingsRefusals[callIndex];
    const invalidateViews = (): void => {
      viewed = undefined;
      batchCopyCurrent = false;
    };
    return {
      emitSecurity,
      resolved,
      tool,
      args,
      proposedProgram,
      viewOf,
      historyForCallbacks,
      startMs,
      findingsRefusal,
      invalidateViews,
    };
  };
  return { beginDispatchCall };
}
