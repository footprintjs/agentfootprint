import { describe, expect, it, vi } from 'vitest';
import { memorySessions } from '../../memorySessions.js';
import { createSessionHistory } from './history.js';

describe('session history admission', () => {
  it('requires a verified door before touching stored history', async () => {
    const sessions = memorySessions();
    const hydrate = vi.spyOn(sessions, 'hydrate');
    const history = createSessionHistory({
      sessions,
      sharedAgent: undefined,
      identityOptions: undefined,
    });
    const fail = vi.fn();
    await history.answerSessionOp(
      { op: 'transcript', sessionId: 'foreign' },
      undefined,
      {
        complete: vi.fn(),
        fail,
      },
      undefined,
    );
    expect(fail).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ERR_SESSION_OP_NEEDS_IDENTITY' }),
    );
    expect(hydrate).not.toHaveBeenCalled();
  });
});
