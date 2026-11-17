import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { ToolExecutionContext } from '../../../tools/tools.js';
import type { ToolResultRowset } from '../../../tools/resultRowsets.js';
import type {
  ToolRowsetCheckedPayload,
  ToolRowsetCheckReason,
} from '../../../events/payloads/toolRowsets.js';
import { columnTypesOf, type ColumnCheckMode } from '../../../integrity/column-types/check.js';
import { typedEmit } from '../../../recorders/core/typedEmit.js';
import { fileIntegrityFindings } from '../integrityFindings.js';
import type { ToolCallsHandlerDeps } from '../stages/toolCalls/contracts/handlerDeps.js';
import type { SourcePublicationReceipt } from '../sourceEvidence/publications.js';
import { readGovernedRowset } from './read.js';
import { armDeadline, awaitUnder, linkedController } from '../../../lib/abort.js';
import type { GovernedRowset } from './read.js';

export const UNAVAILABLE_ROWSET_REFUSAL =
  'Result rejected: a declared rowset was unavailable for its column check. No data was returned.';
/** One native wait budget for all published bindings in this final tool call. */
const ROWSET_READ_BUDGET_MS = 5000;

export interface RowsetCall {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
}

/** The existing two check kinds account honestly for an undispatched result. */
export function noteUnansweredRowsets(
  ledger: ToolCallsHandlerDeps['integrityLedger'],
  declarations: readonly ToolResultRowset[] | undefined,
): void {
  for (let index = 0; index < (declarations?.length ?? 0); index++)
    for (const kind of ['column-type-mismatch', 'missing-column'] as const)
      ledger?.current?.note(kind, 'write', 'not-applicable');
}

/** One deterministic final-surface judgment, before retention or delivery. */
export async function judgeGovernedRowsets(
  scope: TypedScope<AgentState>,
  call: RowsetCall,
  declarations: readonly ToolResultRowset[],
  mode: ColumnCheckMode,
  served: unknown,
  context: ToolExecutionContext | undefined,
  publications: SourcePublicationReceipt | undefined,
  active: () => boolean,
  ledger: ToolCallsHandlerDeps['integrityLedger'],
  unavailableReason?: ToolRowsetCheckReason,
): Promise<string | undefined> {
  const encounters = [];
  let refusal: string | undefined;
  const budget =
    unavailableReason === undefined &&
    declarations.some((entry) => entry.source.kind === 'published-dataset')
      ? linkedController(context?.signal)
      : undefined;
  const disarm =
    budget === undefined
      ? undefined
      : armDeadline(
          budget.controller,
          ROWSET_READ_BUDGET_MS,
          () => new Error('Rowset publication read timed out.'),
        );
  const readContext =
    context === undefined || budget === undefined
      ? context
      : { ...context, signal: budget.controller.signal };
  try {
    for (const declaration of declarations) {
      let resolved: GovernedRowset;
      if (unavailableReason !== undefined)
        resolved = { available: false, reason: unavailableReason };
      else if (budget?.controller.signal.aborted)
        resolved = {
          available: false,
          reason: context?.signal?.aborted || !active() ? 'source-aborted' : 'store-unavailable',
        };
      else {
        try {
          resolved = await awaitUnder(budget?.controller.signal, () =>
            readGovernedRowset(declaration, served, readContext, publications, active),
          );
        } catch {
          resolved = {
            available: false,
            reason: context?.signal?.aborted || !active() ? 'source-aborted' : 'store-unavailable',
          };
        }
      }
      const encounter = columnTypesOf(
        {
          toolName: call.toolName,
          toolCallId: call.toolCallId,
          rowset: declaration.key,
          columns: {},
          mode,
          reading: resolved.reading,
        },
        call.iteration,
      );
      if (!resolved.available && mode === 'enforce') refusal ??= UNAVAILABLE_ROWSET_REFUSAL;
      refusal ??= encounter.refusal;
      if (encounter.disposition === 'unreachable')
        throw new Error('A reached column judge returned an unreachable disposition.');
      const disposition: ToolRowsetCheckedPayload['disposition'] = resolved.available
        ? encounter.disposition
        : 'unavailable';
      encounters.push({ declaration, resolved, encounter, disposition });
    }
  } finally {
    disarm?.();
    budget?.unlink();
  }
  // Cancellation or a retired execution never files into a later run.
  if (!active() || context?.signal?.aborted) return undefined;
  for (const { declaration, resolved, encounter, disposition } of encounters) {
    for (const kind of ['column-type-mismatch', 'missing-column'] as const) {
      const fired = encounter.findings.some((finding) => finding.kind === kind);
      const checkDisposition =
        encounter.disposition === 'not-applicable'
          ? 'not-applicable'
          : fired
          ? 'checked-fail'
          : 'checked-pass';
      ledger?.current?.note(kind, 'write', checkDisposition, fired ? Date.now() : undefined);
    }
    fileIntegrityFindings(scope, encounter.findings, call.iteration, ledger);
    const payload: ToolRowsetCheckedPayload = {
      ...call,
      rowset: declaration.key,
      source: declaration.source.kind,
      disposition,
      reason: resolved.reason,
      delivery: refusal === undefined ? 'unchanged' : 'refused',
    };
    typedEmit(scope, 'agentfootprint.tools.rowset_checked', payload);
  }
  return refusal;
}
