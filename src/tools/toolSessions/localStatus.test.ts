import { expect, it } from 'vitest';
import { ToolSessionTier } from '../toolSessions.js';
import { newToolOwner, nextToolDispatch } from '../toolResourceOwner.js';

const owner = (runId: string) => nextToolDispatch(newToolOwner({ runId, ordinal: 0 }));
const facts = (tenant: string, sessionId = 's') => ({
  identity: { conversationId: sessionId, tenant, principal: 'person' },
  sessionId,
});

it('a tier-wide shutdown row proves no association with a restored owner', async () => {
  const tier = new ToolSessionTier();
  const a = owner('a');
  const view = tier.borrow(a, facts('A'));
  view.register(a.pending!, { tool: 'shared', toolCallId: 'a' }, () => undefined, {
    scope: 'shutdown',
    key: 'global',
  });
  await view.finish(true);
  expect(tier.localStatus(owner('b'), facts('B'))).toBe('none-known-locally');
  expect(tier.localStatus(a, facts('A'))).toBe('none-known-locally');
  expect(tier.liveCount()).toBe(1);
  await tier.fireShutdown();
});

it.each(['call', 'run', 'session'] as const)(
  'local status retains only a matching %s boundary',
  async (scope) => {
    const tier = new ToolSessionTier();
    const a = owner('a');
    const view = tier.borrow(a, facts('A'));
    view.register(a.pending!, { tool: 'owned', toolCallId: 'a' }, () => undefined, { scope });
    await view.finish(true);
    expect(tier.localStatus(a, facts('A'))).toBe('retained');
    expect(tier.localStatus(a, facts('B'))).toBe('none-known-locally');
    expect(tier.localStatus(a, facts('A', 'other'))).toBe('none-known-locally');
    expect(tier.localStatus(owner('next'), facts('A'))).toBe(
      scope === 'session' ? 'retained' : 'none-known-locally',
    );
    await tier.fireShutdown();
  },
);

it('conservative restoration reporting does not change global shutdown dedup or lifetime', async () => {
  const tier = new ToolSessionTier();
  const closed: string[] = [];
  for (const id of ['A', 'B']) {
    const call = owner(id),
      view = tier.borrow(call, facts(id));
    const result = view.register(
      call.pending!,
      { tool: 'shared', toolCallId: id },
      () => {
        closed.push(id);
      },
      { scope: 'shutdown', key: 'global' },
    );
    expect(result.outcome).toBe(id === 'A' ? 'started' : 'reused');
    await view.finish(false);
  }
  expect(closed).toEqual([]);
  expect(tier.liveCount()).toBe(1);
  await tier.fireShutdown();
  expect(closed).toEqual(['A']);
});
