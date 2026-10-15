/**
 * A composition member never reads what its INSTANCE holds for its own next
 * run: the conversation a `continueFrom` / `resumeOnError` handed over, and
 * the self-explain evidence of the instance's last direct run. Both belong to
 * another caller.
 */

import { describe, expect, it } from 'vitest';

import { Agent, Sequence, allow, type MessageMiddleware } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import type { MemoryIdentity } from '../../../src/memory/identity/index.js';

const ALICE: MemoryIdentity = { tenant: 'acme', principal: 'alice', conversationId: 'c-alice' };
const BOB: MemoryIdentity = { tenant: 'acme', principal: 'bob', conversationId: 'c-bob' };

describe('composition members — never the instance’s hand-offs or evidence', () => {
  it('a continued direct turn’s conversation is never consumed by a concurrent member', async () => {
    const seen: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    // Alice's continued turn waits in an async input middleware (a moderation
    // service) while Bob's composition runs the same instance.
    const slowForAlice: MessageMiddleware = {
      name: 'remote-moderation',
      onMessage: async (msg) => {
        if (msg.phase === 'input' && msg.content.includes('alice-turn-2')) await gate;
        return allow();
      },
    };
    const shared = Agent.create({
      id: 'shared',
      provider: mock({
        respond: (req) => {
          seen.push(JSON.stringify(req.messages));
          return 'ok';
        },
      }),
      model: 'mock',
      maxIterations: 2,
    })
      .system('assistant')
      .messageMiddleware(slowForAlice)
      .build();

    await shared.run({ message: 'ALICE-SECRET is 1234', identity: ALICE });
    const checkpoint = shared.checkpoint();
    const alice = shared.run({
      message: 'alice-turn-2',
      continueFrom: checkpoint!,
      identity: ALICE,
    });
    await new Promise((r) => setTimeout(r, 20));

    const flow = Sequence.create({ id: 'wrap' }).step('shared', shared).build();
    seen.length = 0;
    await flow.run({ message: 'bob asks: what do you know?', identity: BOB });
    release();
    await alice;

    const bob = seen.filter((r) => r.includes('bob asks')).join('\n');
    const aliceTurn = seen.filter((r) => r.includes('alice-turn-2')).join('\n');
    expect(bob).not.toContain('ALICE-SECRET');
    // …and Alice kept her own history: the hand-off reached the run it was for.
    expect(aliceTurn).toContain('ALICE-SECRET');
  });

  it('self-explain: a member is never handed the instance’s last direct run as evidence', async () => {
    const seen: string[] = [];
    let call = 0;
    const shared = Agent.create({
      id: 'explainer',
      provider: mock({
        respond: (req) => {
          seen.push(JSON.stringify(req.messages));
          const all = JSON.stringify(req.messages);
          const last = JSON.stringify(req.messages[req.messages.length - 1]);
          if (!all.includes('bob asks')) return 'noted';
          call++;
          if (last.includes('bob asks')) {
            return {
              toolCalls: [{ id: `s${call}`, name: 'read_skill', args: { id: 'self-explain' } }],
            };
          }
          if (!all.includes('read_narrative')) {
            return { toolCalls: [{ id: `n${call}`, name: 'read_narrative', args: {} }] };
          }
          return 'done';
        },
      }),
      model: 'mock',
      maxIterations: 5,
    })
      .system('assistant')
      .selfExplain()
      .build();

    await shared.run({ message: 'ALICE-DIRECT-SECRET is 4242', identity: ALICE });
    const flow = Sequence.create({ id: 'wrap' }).step('explainer', shared).build();
    seen.length = 0;
    await flow.run({ message: 'bob asks: what happened last time?', identity: BOB });
    const bob = seen.filter((r) => r.includes('bob asks')).join('\n');
    // The control: the trace tool really was called in Bob's run.
    expect(bob).toContain('read_narrative');
    expect(bob).not.toContain('ALICE-DIRECT-SECRET');
  });
});
