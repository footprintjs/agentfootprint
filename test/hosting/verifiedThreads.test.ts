/**
 * verifiedThreads — a thread is bound to a VERIFIED caller (`src/hosting/verifiedThreads.ts`).
 *
 * The caller's credential is checked with the door's own identity verification
 * — never a header read as a name — and the conversation is keyed by WHO plus
 * WHICH, injectively. A caller with no credential is refused, even at a door
 * that lets anonymous requests through elsewhere: an ownerless thread would be
 * anybody's who guessed its id.
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { IdentityNotVerifiedError } from '../../src/hosting/errors.js';
import { memorySessions } from '../../src/hosting/memorySessions.js';
import { streamHandler } from '../../src/hosting/streamHandler.js';
import { verifiedThreads } from '../../src/hosting/verifiedThreads.js';
import { agUi } from '../../src/ag-ui/adapter.js';

const TOKENS: Record<string, string> = {
  'tok-ada': 'ada',
  'tok-bo': 'bo',
  'tok-a': 'a',
  'tok-slash': 'a/b',
  'tok-jose': 'José Ruiz',
};
const verify = async (token: string) => {
  const userId = TOKENS[token];
  if (userId === undefined) throw new Error('unknown token');
  return { userId };
};

const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

describe('verifiedThreads — the thread is bound to the caller the door verified', () => {
  const threads = verifiedThreads({ verify });

  it('keys the conversation by the verified person and the thread, and names them on the run', async () => {
    expect(await threads.bind({ conversation: 't1', headers: bearer('tok-ada') })).toEqual({
      sessionId: 'ada/t1',
      identity: { principal: 'ada', conversationId: 't1' },
    });
    const bo = await threads.bind({ conversation: 't1', headers: bearer('tok-bo') });
    expect(bo.sessionId).toBe('bo/t1'); // the same thread id from another person: another conversation
  });

  it('is injective: no (person, thread) pair spells another’s key', async () => {
    // Unescaped, both would be 'a/b/c'.
    const slash = await threads.bind({ conversation: 'c', headers: bearer('tok-slash') });
    const plain = await threads.bind({ conversation: 'b/c', headers: bearer('tok-a') });
    expect(slash.sessionId).not.toBe(plain.sessionId);
  });

  it('any verified name makes a key every door accepts (visible ASCII)', async () => {
    const { sessionId } = await threads.bind({ conversation: 't1', headers: bearer('tok-jose') });
    expect(sessionId).toMatch(/^[\x21-\x7e]+$/);
  });

  it('refuses a caller with no credential, a forged one, and a name read off a header', async () => {
    for (const headers of [{}, bearer('tok-forged'), { 'x-user': 'ada' }]) {
      await expect(threads.bind({ conversation: 't1', headers })).rejects.toBeInstanceOf(
        IdentityNotVerifiedError,
      );
    }
    // Even where the door lets anonymous requests through elsewhere.
    const open = verifiedThreads({ verify, allowAnonymous: true });
    await expect(open.bind({ conversation: 't1', headers: {} })).rejects.toBeInstanceOf(
      IdentityNotVerifiedError,
    );
  });

  it('end to end: an unverified caller is a 401; another person cannot open the conversation', async () => {
    const handle = streamHandler({
      agent: () =>
        Agent.create({ provider: mock({ chunkDelayMs: 0, reply: 'hi' }), model: 'm' })
          .system('s')
          .build(),
      adapter: agUi(),
      threads,
      sessions: memorySessions(),
      heartbeatMs: 0,
    });
    const post = (headers: Record<string, string>) =>
      handle(
        new Request('http://localhost/agent', {
          method: 'POST',
          headers: { 'content-type': 'application/json', ...headers },
          body: JSON.stringify({
            threadId: 't1',
            runId: 'r1',
            messages: [{ id: 'u1', role: 'user', content: 'hello' }],
          }),
        }),
      );
    const anonymous = await post({ 'x-user': 'ada' });
    expect(anonymous.status).toBe(401);
    expect(await anonymous.json()).toMatchObject({ code: 'ERR_IDENTITY_NOT_VERIFIED' });
    expect((await post(bearer('tok-ada'))).status).toBe(200);
    const jose = await post(bearer('tok-jose'));
    expect(jose.status).toBe(200);
    await jose.text();
    // Bo naming Ada's thread gets his own conversation, never hers.
    const bo = await post(bearer('tok-bo'));
    expect(bo.status).toBe(200);
    expect(await bo.text()).toContain('RUN_FINISHED');
  });
});
