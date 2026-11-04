import { describe, expect, it } from 'vitest';
import {
  Agent,
  checkInApproved,
  defineTool,
  inMemoryDecisionLedger,
  isPaused,
  type DecisionLedger,
} from '../../index.js';
import { memorySessions, standingAgent } from '../../hosting/index.js';
import { inProcessHost } from '../../../test/hosting/testHost.js';
import type { LLMRequest } from '../../provider-contract/types.js';

function world(ledger: DecisionLedger) {
  const ran: string[] = [];
  const agent = Agent.create({
    provider: {
      name: 'scripted',
      complete: async (request: LLMRequest) =>
        request.messages.some((m) => m.role === 'tool') ||
        request.messages.at(-1)?.content !== 'ask'
          ? { content: 'done', toolCalls: [], usage: { input: 1, output: 1 } }
          : {
              content: '',
              toolCalls: [{ id: 'held', name: 'act', args: {} }],
              usage: { input: 1, output: 1 },
            },
    },
    model: 'mock',
    decisionLedger: ledger,
  })
    .tool(
      defineTool({
        name: 'act',
        description: 'Act after approval',
        inputSchema: { type: 'object' },
        checkIn: 'always',
        execute: () => {
          ran.push('ran');
          return 'acted';
        },
      }),
    )
    .build();
  return { agent, ran };
}
const variants = [
  'throw',
  'reject',
  'true',
  'request-true',
  'truthy',
  'false',
  'store-true',
  'closed-throw',
  'hang',
] as const;
function uncertain(kind: (typeof variants)[number]) {
  const atomic = inMemoryDecisionLedger();
  let reads = 0,
    spends = 0;
  const ledger: DecisionLedger = {
    ...(kind.startsWith('store') || kind === 'closed-throw' ? { storeId: 'advisory-test' } : {}),
    spend(id) {
      spends++;
      return atomic.spend(id);
    },
    isSpent(id) {
      reads++;
      if (kind === 'throw') throw new Error('private read failure');
      if (kind === 'reject') return Promise.reject(new Error('private read failure'));
      if (kind === 'true' || kind === 'store-true') return true;
      if (kind === 'request-true') return !id.startsWith('closed-proven:');
      if (kind === 'truthy') return 1 as never;
      if (kind === 'closed-throw' && id.startsWith('closed-proven:'))
        throw new Error('private marker failure');
      if (kind === 'hang') return new Promise<boolean>(() => undefined);
      return false;
    },
  };
  return { ledger, counts: () => ({ reads, spends }) };
}
async function bounded<T>(value: Promise<T>): Promise<T | 'HUNG'> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      value,
      new Promise<'HUNG'>((resolve) => {
        timer = setTimeout(() => resolve('HUNG'), 100);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}
describe.each(variants)('optional ledger read %s', (kind) => {
  it('never replaces the sole atomic spend with an observation', async () => {
    const source = uncertain(kind),
      { agent, ran } = world(source.ledger);
    const paused = await agent.run('ask');
    if (!isPaused(paused) || paused.checkIn === undefined) throw new Error('Expected approval');
    const pending = agent.resume(
      paused.checkpoint,
      checkInApproved({ request: paused.checkIn, by: 'person' }),
    );
    // The hang is held only by a promise and does not retain a platform handle.
    const result = await bounded(pending.catch((e) => ({ error: e })));
    expect(result).toBe('done');
    expect(ran).toEqual(['ran']);
    expect(source.counts()).toEqual({ reads: 0, spends: 1 });
    await agent.shutdown();
  });
});
it('an actual library-ledger replay refuses before replacing another selected conversation', async () => {
  const ledger = inMemoryDecisionLedger(),
    { agent } = world(ledger);
  const paused = await agent.run('ask');
  if (!isPaused(paused) || paused.checkIn === undefined) throw new Error('Expected approval');
  const decision = checkInApproved({ request: paused.checkIn, by: 'person' });
  await agent.resume(paused.checkpoint, decision);
  await agent.run('other');
  const prior = agent.checkpoint();
  await expect(agent.resume(paused.checkpoint, decision)).rejects.toMatchObject({
    code: 'ERR_RESUME_DECISION',
  });
  expect(agent.checkpoint()?.history).toEqual(prior?.history);
  expect(agent.checkpoint()?.identity).toEqual(prior?.identity);
  await agent.shutdown();
});
it('wrong-request failure with opaque hanging marker reads keeps the question and releases the lane', async () => {
  const source = uncertain('hang');
  Object.defineProperty(source.ledger, 'storeId', { value: 'opaque-store' });
  const { agent } = world(source.ledger),
    sessions = memorySessions(),
    host = inProcessHost();
  const handle = await standingAgent({ agent, sessions, host, onConcurrentInvoke: 'enqueue' });
  const first = await host.deliver({ input: 'ask', sessionId: 'a' });
  if (first.awaiting?.checkIn === undefined) throw new Error('Expected approval');
  const decision = {
    ...checkInApproved({ request: first.awaiting.checkIn, by: 'person' }),
    requestId: 'f'.repeat(64),
  };
  const result = await bounded(host.deliver({ input: '', sessionId: 'a', decision }));
  expect(result).not.toBe('HUNG');
  expect(source.counts()).toEqual({ reads: 0, spends: 0 });
  const bob = await bounded(host.deliver({ input: 'bob', sessionId: 'b' }));
  expect(bob).not.toBe('HUNG');
  expect((await sessions.hydrate('a'))?.format).toBe('flowchart-v1');
  await handle.close();
});
