import { describe, expect, it, vi } from 'vitest';
import { createRequestHandler } from './handler.js';
import { spendLedger } from '../../admission.js';
import { memorySessions } from '../../memorySessions.js';

describe('request admission order', () => {
  it('refuses admission before choosing a lane or running a turn', async () => {
    const laneFor = vi.fn();
    const answerOne = vi.fn();
    const fail = vi.fn();
    const handler = createRequestHandler({
      identityOptions: undefined,
      admission: { decide: () => ({ refuse: 'closed' }) },
      ledger: spendLedger(),
      sessions: memorySessions(),
      ingressSink: undefined,
      laneFor,
      serialize: vi.fn(),
      answerSessionOp: vi.fn(),
      answerArtifact: vi.fn(),
      answerOne,
    });
    await handler({ input: 'hello', sessionId: 'session' }, { complete: vi.fn(), fail });
    expect(fail).toHaveBeenCalledWith(expect.objectContaining({ code: 'ERR_ADMISSION_REFUSED' }));
    expect(laneFor).not.toHaveBeenCalled();
    expect(answerOne).not.toHaveBeenCalled();
  });
});
