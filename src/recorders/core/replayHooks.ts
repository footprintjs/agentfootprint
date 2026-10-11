/** Runtime replay reporting. State retirement is not fallible telemetry. */
import type { LLMCallHooks, LLMMessage } from '../../adapters/types.js';
import { retireReplayHistory } from '../../thinking/replayHistory.js';
import { RECEIPT_KEY, type Receipt } from '../../lib/time-travel/receipt.js';
import { typedEmit, type EmitableScope } from './typedEmit.js';

/** Only live scopes offer persistence; emit-only standalone callers do not. */
export interface ReplayReportScope extends EmitableScope {
  $getValue?(key: string): unknown;
  $setValue?(key: string, value: unknown): void;
}

function isHistory(value: unknown): value is readonly LLMMessage[] {
  return (
    Array.isArray(value) &&
    value.every(
      (m: unknown) =>
        typeof m === 'object' &&
        m !== null &&
        'role' in m &&
        'content' in m &&
        typeof m.content === 'string',
    )
  );
}

/** Create once per call. Retry/fallback reports append, never overwrite. */
export function replayPreparedHook(
  scope: ReplayReportScope,
  receiptMinted: boolean,
  onPersisted?: LLMCallHooks['onReplayPrepared'],
): NonNullable<LLMCallHooks['onReplayPrepared']> {
  return (preparation) => {
    if (preparation.omissions.length === 0) return;
    const history = scope.$getValue?.('history');
    if (isHistory(history)) {
      const retired = retireReplayHistory(history, preparation);
      if (retired !== history) {
        if (scope.$setValue === undefined)
          throw new Error('Replay retirement requires writable history.');
        scope.$setValue('history', retired);
      }
    }
    // The checkpoint owner sees a successfully persisted history edit before
    // optional receipt/observation work. A failed grouped stage cannot map
    // this write outward, including if receipt annotation itself fails.
    onPersisted?.(preparation);
    // This flag is set by the mint's call site, never inferred from an old
    // receipt inherited by a resumed or receipt-disabled run.
    if (receiptMinted && scope.$getValue !== undefined && scope.$setValue !== undefined) {
      const held = scope.$getValue(RECEIPT_KEY) as Receipt | undefined;
      if (held !== undefined)
        scope.$setValue(RECEIPT_KEY, {
          ...held,
          replayPreparations: [
            ...(held.replayPreparations ?? []),
            {
              boundary: 'provider-adapter',
              phase: 'prepared',
              omittedBlocks: preparation.omissions.length,
            },
          ],
        });
    }
    for (const omission of preparation.omissions) {
      try {
        typedEmit(scope, 'agentfootprint.agent.thinking_omitted', {
          providerName: preparation.provider,
          model: preparation.model,
          messageIndex: omission.messageIndex,
          blockIndex: omission.blockIndex,
          reason: omission.reason,
          phase: 'prepared',
        });
      } catch {
        // A broken telemetry sink cannot turn already-preserved state into
        // a failed model call. The retirement above is outside this catch.
      }
    }
  };
}
