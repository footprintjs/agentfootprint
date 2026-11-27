import { describe, expect, it, vi } from 'vitest';
import { memorySessions } from '../../memorySessions.js';
import { createSessionHistory } from './history.js';
import { Agent } from '../../../core/Agent.js';
import { mock } from '../../../llm-providers.js';
import { toEnvelope } from '../../envelope.js';

describe('session history admission', () => {
  it('rechecks the verified recipient before serving catalog-derived history', async () => {
    const sessions = memorySessions();
    const reader = { userId: 'reader' };
    const inheritedText = 'Summary from the saved catalog.';
    const envelope = toEnvelope({
      version: 1,
      runId: 'fixture',
      history: [
        { role: 'user', content: 'Keep this line.' },
        {
          role: 'user',
          content: inheritedText,
          skillListing: { kind: 'derived', ids: ['planning'] },
        },
        { role: 'tool', content: 'Tool-only text.' },
        { role: 'assistant', content: 'Done.' },
      ],
      lastCompletedIteration: 1,
      originalInput: { message: 'Keep this line.' },
      checkpointedAt: 0,
      identity: { conversationId: 'conversation', tenant: 'fixture-tenant', principal: 'reader' },
    });
    await sessions.persist('session', envelope);
    let allowed = true;
    const agent = Agent.create({
      provider: mock({ reply: 'Unused.' }),
      model: 'fixture',
      permissionChecker: {
        governs: ['skill_read'],
        check(request) {
          expect(request.identity).toEqual({
            conversationId: 'conversation',
            tenant: 'fixture-tenant',
            principal: 'reader',
          });
          return { result: allowed ? 'allow' : 'deny' };
        },
      },
    }).build();
    const identityOptions = { verify: async () => reader };
    const shared = createSessionHistory({ sessions, sharedAgent: agent, identityOptions });
    const coldPool = createSessionHistory({ sessions, sharedAgent: undefined, identityOptions });
    const reply = { complete: vi.fn(), fail: vi.fn(), sessions: vi.fn() };
    const op = { op: 'transcript' as const, sessionId: 'session' };
    const expected = (content: string) => ({
      ...op,
      messages: [
        { role: 'user', content: 'Keep this line.' },
        { role: 'user', content },
        { role: 'assistant', content: 'Done.' },
      ],
    });
    try {
      await shared.answerSessionOp(op, reader, reply, reader.userId);
      expect(reply.sessions).toHaveBeenLastCalledWith(expected(inheritedText));
      allowed = false;
      const withheld = expected('A saved skill catalog result is unavailable to this recipient.');
      await shared.answerSessionOp(op, reader, reply, reader.userId);
      expect(reply.sessions).toHaveBeenLastCalledWith(withheld);
      await coldPool.answerSessionOp(op, reader, reply, reader.userId);
      expect(reply.sessions).toHaveBeenLastCalledWith(withheld);
      expect(reply.fail).not.toHaveBeenCalled();
      expect(await sessions.hydrate('session')).toEqual(envelope);
    } finally {
      await agent.shutdown();
    }
  });

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
