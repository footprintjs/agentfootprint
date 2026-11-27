import type { RunSettlement, RunRefusal } from '../../hosting/protocolAdapter.js';
import type { AgentfootprintEvent } from '../../events/registry.js';
import type { Scope } from '../translationScope.js';
import type { AgUiEvent, AgUiInterrupt, AgUiSuspension } from '../types.js';
import type { AgUiIdMinter } from '../ids.js';
import { AG_UI_RUN_FAILED, AG_UI_ANSWER_WITHHELD, AG_UI_SUBAGENT_CANCELLED } from './values.js';

const REFUSAL_WORDS: Readonly<Record<string, string>> = Object.freeze({
  ERR_STREAM_LIMIT: 'The stream exceeded its configured delivery limit.',
  ERR_FRONTEND_TOOLS_UNSUPPORTED:
    'This hosting strategy does not support per-request frontend tools.',
  ERR_IDENTITY_NOT_VERIFIED: 'The caller could not be verified.',
  ERR_IDENTITY_VERIFIER_UNAVAILABLE:
    'Identity verification is unavailable. Try again when the service is reachable.',
  ERR_PROVIDER_BLOCKED: 'The provider blocked this response.',
  ERR_PROVIDER_INTERVENTION_UNKNOWN: 'The provider intervention outcome is unknown.',
  ERR_PROVIDER_GUARDRAIL_LIMIT:
    'The guarded response exceeded its configured private buffer limit.',
});
function refusalWords(code: RunRefusal): string {
  return Object.hasOwn(REFUSAL_WORDS, code)
    ? (REFUSAL_WORDS[code] as string)
    : 'The host refused this request.';
}

export interface SettlementContext {
  readonly root: Scope;
  readonly threadId: string;
  readonly runId: string;
  readonly ids: AgUiIdMinter;
  readonly hostDelivery: boolean;
  readonly pausedRecord: (awaiting: 'person' | 'caller' | undefined) => {
    readonly record: AgUiSuspension;
    readonly clientCall?: string;
  };
  readonly endAllNested: (
    out: AgUiEvent[],
    end: (scope: Scope) => (id: string) => AgUiEvent,
  ) => void;
  readonly closeContents: (scope: Scope, out: AgUiEvent[]) => void;
  readonly interruptOf: () => AgUiInterrupt;
  readonly unfinished: (id: string) => AgUiEvent;
  readonly pause: { readonly event: AgentfootprintEvent; readonly scope: Scope } | undefined;
  rootResult: string | undefined;
  suspended: AgUiSuspension | undefined;
  readonly fatal: string | undefined;
}

export function settleTranslation(
  settlement: RunSettlement,
  out: AgUiEvent[],
  context: SettlementContext,
): AgUiEvent[] {
  const {
    root,
    threadId,
    runId,
    ids,
    hostDelivery,
    pausedRecord,
    endAllNested,
    closeContents,
    interruptOf,
    unfinished,
  } = context;
  switch (settlement.kind) {
    case 'failed':
      if (settlement.refusal !== undefined && settlement.refusal !== 'ERR_ANSWER_VALIDATION') {
        out.push({
          type: 'RUN_ERROR',
          code: settlement.refusal,
          message: refusalWords(settlement.refusal),
        });
        return out;
      }
      // A refusal by its code, in fixed words; otherwise the record's own
      // words for the failure — never the thrown value.
      out.push(
        settlement.refusal === 'ERR_ANSWER_VALIDATION'
          ? { type: 'RUN_ERROR', message: AG_UI_ANSWER_WITHHELD, code: settlement.refusal }
          : { type: 'RUN_ERROR', message: context.fatal ?? AG_UI_RUN_FAILED },
      );
      return out;
    case 'paused': {
      const { record, clientCall } = pausedRecord(settlement.awaiting);
      context.suspended = record;
      if (clientCall !== undefined) {
        // A tool the client runs: the run COMPLETED this segment and left
        // the call for the application to answer in its next input.
        endAllNested(out, () => (subagentRunId) => ({
          type: 'SUBAGENT_FINISHED',
          subagentRunId,
          outcome: { type: 'suspended' },
        }));
        closeContents(root, out);
        out.push({
          type: 'RUN_FINISHED',
          threadId,
          runId,
          outcome: { type: 'success', pendingToolCallIds: [clientCall] },
        });
        return out;
      }
      const interrupt = interruptOf();
      endAllNested(out, (scope) => (subagentRunId) => ({
        type: 'SUBAGENT_FINISHED',
        subagentRunId,
        outcome: {
          type: 'suspended',
          ...(context.pause?.scope === scope && { interruptIds: [interrupt.id] }),
        },
      }));
      closeContents(root, out);
      out.push({
        type: 'RUN_FINISHED',
        threadId,
        runId,
        outcome: { type: 'interrupt', interrupts: [interrupt] },
      });
      return out;
    }
    case 'cancelled':
      endAllNested(out, () => (subagentRunId) => ({
        type: 'SUBAGENT_ERROR',
        subagentRunId,
        message: AG_UI_SUBAGENT_CANCELLED,
        code: 'cancelled',
      }));
      closeContents(root, out);
      out.push({
        type: 'RUN_FINISHED',
        threadId,
        runId,
        outcome: { type: 'cancelled' },
      });
      return out;
    case 'finished':
      if (hostDelivery) {
        context.rootResult = settlement.output;
        if (settlement.output) {
          const id = ids.next('text', 'host-delivery').id;
          out.push(
            { type: 'TEXT_MESSAGE_START', messageId: id, role: 'assistant' },
            { type: 'TEXT_MESSAGE_CONTENT', messageId: id, delta: settlement.output },
            { type: 'TEXT_MESSAGE_END', messageId: id },
          );
        }
      }
      endAllNested(out, () => unfinished);
      closeContents(root, out);
      out.push({
        type: 'RUN_FINISHED',
        threadId,
        runId,
        ...(context.rootResult !== undefined && { result: context.rootResult }),
      });
      return out;
  }
}
