import { describe, expect, it } from 'vitest';
import type { RunSettlement } from '../../src/hosting/protocolAdapter.js';
import type { StreamFraming } from '../../src/hosting/httpStreaming.js';
import { failedSettlement } from '../../src/hosting/failedSettlement.js';

/** The optional evidence preserves existing framers and carries no thrown value. */
const legacy: StreamFraming = {
  chunk: () => [],
  complete: () => [],
  failure: (message, code, origin) => [{ event: origin ?? 'error', data: { message, code } }],
};
const evidence: Extract<RunSettlement, { kind: 'failed' }> = failedSettlement(new Error('private'));
const fourthArgument: Parameters<StreamFraming['failure']>[3] = evidence;

function closedEvidenceContract(framing: StreamFraming): void {
  framing.failure('fixed', undefined, 'threw');
  framing.failure('fixed', undefined, 'threw', fourthArgument);
  // @ts-expect-error A successful settlement is not failure evidence.
  framing.failure('fixed', undefined, 'threw', { kind: 'finished' });
  // @ts-expect-error Application code strings are not native refusal evidence.
  framing.failure('fixed', undefined, 'threw', { kind: 'failed', refusal: 'ERR_APPLICATION' });
  // @ts-expect-error A thrown value is never handed to a protocol framing as evidence.
  framing.failure('fixed', undefined, 'threw', new Error('private'));
}
void closedEvidenceContract;

describe('HTTP framing failure evidence contract', () => {
  it('preserves a legacy three-argument framing and its returned frames', () => {
    expect(legacy.failure('fixed', 'APP_CODE', 'threw', fourthArgument)).toEqual([
      { event: 'threw', data: { message: 'fixed', code: 'APP_CODE' } },
    ]);
  });

  it('hands off only a failed settlement with no error text', () => {
    expect(fourthArgument).toEqual({ kind: 'failed' });
  });
});
