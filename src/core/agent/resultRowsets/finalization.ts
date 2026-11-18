import type { TypedScope } from 'footprintjs';
import type { AgentState } from '../types.js';
import type { ToolParty } from '../../slots/buildToolsSlot.js';
import type { Tool, ToolExecutionContext } from '../../../tools/tools.js';
import { resultRowsetsOf } from '../../../tools/resultRowsets.js';
import { sourceEvidenceDescriptor } from '../../../tools/sourceEvidence.js';
import type { ToolRowsetCheckReason } from '../../../events/payloads/toolRowsets.js';
import type { ToolCallsHandlerDeps } from '../stages/toolCalls/contracts/handlerDeps.js';
import {
  nativeSourceCapture,
  type NativeSourceCapture,
  type SourceCaptureLanding,
} from '../sourceEvidence/capture.js';
import {
  closeSourcePublications,
  finalizeSourcePublications,
  type SourcePublicationReceipt,
} from '../sourceEvidence/publications.js';
import { judgeGovernedRowsets, noteUnansweredRowsets, type RowsetCall } from './judge.js';

export interface ResultFinalizationLanding extends SourceCaptureLanding {
  readonly unavailableReason?: ToolRowsetCheckReason;
}
export interface NativeResultFinalizer {
  (served: unknown, landing: ResultFinalizationLanding): Promise<string | undefined>;
  readonly needsPublications: boolean;
  entered(context: ToolExecutionContext): void;
  returned(): void;
  withheld(): void;
  assertFinalized(): void;
  close(): void;
}

/**
 * One invocation owns publication membership, final column checks and source
 * retention. No capability, payload or callback crosses a native checkpoint.
 */
export function nativeResultFinalizer(
  scope: TypedScope<AgentState>,
  tool: Tool | undefined,
  call: RowsetCall,
  deps: Pick<
    ToolCallsHandlerDeps,
    | 'columnCheckMode'
    | 'resultRowsetsFor'
    | 'integrityLedger'
    | 'sourceEvidenceConfig'
    | 'currentRun'
    | 'isRunRetired'
  >,
  runId: string | undefined,
  party?: ToolParty,
): NativeResultFinalizer | undefined {
  if (!tool || (deps.columnCheckMode === undefined && deps.sourceEvidenceConfig === undefined))
    return undefined;
  const declarations =
    deps.columnCheckMode === undefined
      ? undefined
      : deps.resultRowsetsFor === undefined
      ? resultRowsetsOf(call.toolName, tool, tool.resultColumns)
      : deps.resultRowsetsFor(call.toolName, tool, party);
  const sourceWanted =
    deps.sourceEvidenceConfig !== undefined && sourceEvidenceDescriptor(tool) !== undefined;
  if (declarations === undefined && !sourceWanted) return undefined;
  const active = () => !deps.isRunRetired() && deps.currentRun?.().runId === runId;
  let context: ToolExecutionContext | undefined;
  let receipt: SourcePublicationReceipt | undefined;
  let capture: NativeSourceCapture | undefined;
  let closed = false;
  let withheld = false;
  let returned = false;
  let accounted = false;
  const close = (): void => {
    if (closed) return;
    const missingJudgment =
      declarations !== undefined &&
      !accounted &&
      returned &&
      !withheld &&
      !context?.signal?.aborted &&
      active();
    if (!accounted && active() && (!returned || withheld || context?.signal?.aborted))
      noteUnansweredRowsets(deps.integrityLedger, declarations);
    closed = true;
    capture?.withheld();
    if (context?.hasArtifacts) closeSourcePublications(context.artifacts);
    if (missingJudgment)
      throw new Error('Declared rowset finalization was not reached; no result may be delivered.');
  };
  const finish = async (
    served: unknown,
    landing: ResultFinalizationLanding,
  ): Promise<string | undefined> => {
    if (closed) return undefined;
    try {
      // A refusal before execute is already the native admission's teaching.
      // This owner accounts NA on close without replacing it or pretending a result landed.
      if (context === undefined) return undefined;
      const unavailableReason =
        !returned ||
        withheld ||
        !landing.eligible ||
        ['failure', 'denied', 'invalid', 'pending'].includes(landing.status ?? '')
          ? landing.unavailableReason ?? 'result-withheld'
          : undefined;
      const refusal =
        declarations === undefined
          ? undefined
          : await judgeGovernedRowsets(
              scope,
              call,
              declarations,
              deps.columnCheckMode!,
              served,
              context,
              receipt,
              active,
              deps.integrityLedger,
              unavailableReason,
            );
      accounted = true;
      if (refusal === undefined && capture !== undefined)
        await capture(served, { ...landing, eligible: landing.eligible && !withheld && returned });
      return refusal;
    } catch (error) {
      withheld = true;
      throw error;
    } finally {
      close();
    }
  };
  return Object.assign(finish, {
    needsPublications:
      sourceWanted ||
      declarations?.some((entry) => entry.source.kind === 'published-dataset') === true,
    entered(actual: ToolExecutionContext) {
      if (closed || context !== undefined) throw new Error('Result finalization already entered.');
      context = actual;
      capture = nativeSourceCapture(
        scope,
        tool,
        actual,
        deps.sourceEvidenceConfig,
        active,
        () => receipt,
      );
    },
    returned() {
      if (closed || !context || returned) return;
      returned = true;
      if (context.hasArtifacts) receipt = finalizeSourcePublications(context.artifacts);
      capture?.returned();
    },
    withheld() {
      withheld = true;
      capture?.withheld();
      if (context?.hasArtifacts) closeSourcePublications(context.artifacts);
    },
    assertFinalized() {
      if (
        declarations !== undefined &&
        returned &&
        !accounted &&
        !withheld &&
        !context?.signal?.aborted &&
        active()
      )
        throw new Error(
          'Declared rowset finalization was not reached; no result may be delivered.',
        );
    },
    close,
  });
}
