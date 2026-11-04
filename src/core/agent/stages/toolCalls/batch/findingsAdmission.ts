import type { ToolCallsHandlerDeps } from '../contracts/handlerDeps.js';
import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../../../types.js';
import type { LLMMessage } from '../../../../../provider-contract/types.js';
import { findingsReferenceRefusal } from '../../../findings/admission.js';
import { knownResults } from '../../../findings/offer.js';
import { type PreviousResult, recordFindings, standingRowsFrom } from '../../../findings/ledger.js';
import { referenceRefusalRow } from '../../../findings/refusal.js';
import { withUnsettledRows } from '../../../findings/unsettled.js';
import type { DeclaredCoverage } from '../../../../../semantics/coverage/index.js';
import type { ToolCatalogOperations } from '../contracts/operations/catalog.js';

/** Compose the existing synchronous findingsAdmission phase; no additional await or checkpoint state. */
export function buildFindingsAdmission(
  deps: Pick<ToolCallsHandlerDeps, 'findings'>,
  links: Pick<ToolCatalogOperations, 'peelCall' | 'turnStampOf'>,
) {
  const admitFindingsBatch = (scope: TypedScope<AgentState>) => {
    const { peelCall, turnStampOf } = links;
    // Materialize ONCE — `scope.llmLatestToolCalls` is a live TypedScope
    // deep-Proxy view; spreading yields the raw (plain, structured-clone-
    // safe) elements. This array is embedded into the assistant history
    // message and into typed event payloads (tool_start args,
    // iteration_end history), which must be detached plain data
    // (RFC-001 'clone' capture under observerDelivery: 'deferred').
    const toolCalls = [
      ...(scope.llmLatestToolCalls as readonly {
        readonly id: string;
        readonly name: string;
        readonly args: Readonly<Record<string, unknown>>;
        readonly argumentsFailure?: LLMMessage['toolArgumentsFailure'];
      }[]),
    ];
    const iteration = scope.iteration as number;
    // ── STANDINGS OF EARLIER RESULTS AND REFERENCE ADMISSION ───────
    // Freeze admission before batch asks, kept-answer consumption or any
    // policy/credential callback. A sibling result never enlarges it.
    const findingsPeels = deps.findings === true ? toolCalls.map(peelCall) : [];
    const findingsRefusals = findingsPeels.map((peeled) =>
      findingsReferenceRefusal(
        peeled.findings,
        scope.findingsRequest?.[0],
        iteration,
        peeled.malformed,
      ),
    );
    if (
      deps.findings === true &&
      findingsPeels.some((p) => p.findings !== undefined || p.malformed) &&
      scope.findingsBatchRecordedAt !== iteration
    ) {
      const known = knownResults(
        [...((scope.history as readonly LLMMessage[] | undefined) ?? [])],
        [...((scope.toolResults ?? []) as readonly PreviousResult[])],
      );
      scope.findingsBatchRecordedAt = iteration;
      recordFindings(
        scope,
        toolCalls.flatMap((tc, index) =>
          findingsRefusals[index] === undefined
            ? []
            : [
                referenceRefusalRow(
                  { toolCallId: tc.id },
                  iteration,
                  (findingsPeels[index]?.malformed ?? 0) > 0,
                  findingsPeels[index]?.malformed ? tc.args._findings : undefined,
                ),
              ],
        ),
        turnStampOf(scope),
      );
      recordFindings(
        scope,
        withUnsettledRows(
          toolCalls.flatMap((tc, index) => {
            const declared = findingsPeels[index]?.findings;
            return declared?.previous !== undefined
              ? standingRowsFrom(known, declared, { toolCallId: tc.id }, iteration, {
                  witness: scope.findingsRequest?.[0],
                })
              : [];
          }),
          known,
          () => [...((scope.coverageDeclared ?? []) as readonly DeclaredCoverage[])],
        ),
        turnStampOf(scope),
      );
    }
    return { toolCalls, iteration, findingsRefusals };
  };
  return { admitFindingsBatch };
}
