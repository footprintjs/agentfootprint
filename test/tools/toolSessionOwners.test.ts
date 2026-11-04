import { expect, it } from 'vitest';
import { ToolSessionTier, toolSessionKey } from '../../src/tools/toolSessions.js';
import { newToolOwner, nextToolDispatch } from '../../src/tools/toolResourceOwner.js';

const origin = { tool: 'resource', toolCallId: 'same-provider-id', runId: 'opening-leg' };
const owner = (ordinal: number) => nextToolDispatch(newToolOwner({ runId: 'native-leg', ordinal }));

it('partitions custom/default keys and call cleanup even when provider IDs match', async () => {
  const closed: string[] = [],
    tier = new ToolSessionTier();
  const a = owner(0),
    b = owner(1);
  const va = tier.borrow(a, {}),
    vb = tier.borrow(b, {});
  const first = va.register(
    a.pending!,
    origin,
    () => {
      closed.push('a');
    },
    { scope: 'call', key: 'custom' },
  );
  const second = vb.register(
    b.pending!,
    origin,
    () => {
      closed.push('b');
    },
    { scope: 'call', key: 'custom' },
  );
  expect(first.outcome).toBe('started');
  expect(second.outcome).toBe('started');
  expect(first.keyHash).not.toBe(second.keyHash);
  await vb.fireCall(b.pending!);
  expect(closed).toEqual(['b']);
  await va.finish(false);
  expect(closed).toEqual(['b', 'a']);
  await vb.finish(false);
});

it('paused views release their exclusive borrow; stale views cannot close or register into successors', async () => {
  const reports: unknown[] = [],
    closed: string[] = [],
    tier = new ToolSessionTier({
      report: (report) => reports.push(report),
    });
  const ref = owner(0),
    old = tier.borrow(ref, {});
  old.register(
    ref.pending!,
    origin,
    () => {
      closed.push('kept');
    },
    { scope: 'run' },
  );
  expect(() => tier.borrow(ref, {})).toThrow(/active local borrow/);
  await old.finish(true);
  expect(closed).toEqual([]);
  const next = tier.borrow(ref, {});
  await old.finish(false);
  expect(closed).toEqual([]);
  expect(() =>
    old.register(ref.pending!, origin, () => {
      closed.push('late');
    }),
  ).toThrow(/retired/);
  await tier.settled();
  expect(closed).toEqual(['late']);
  expect(reports).toContainEqual(
    expect.objectContaining({ kind: 'close-failed', errorClass: 'ToolResourceClosedError' }),
  );
  await next.finish(false);
  expect(closed).toEqual(['late', 'kept']);
});

it('adapter cache keys include the exact turn/call and tenant/principal/session partition', () => {
  const a = owner(0),
    b = owner(1);
  const context = {
    toolCallId: 'same-provider-id',
    runId: 'new-leg',
    sessionId: 'same',
    identity: { conversationId: 'c', tenant: 't', principal: 'p' },
    resourceOwner: a.pending!,
  };
  for (const scope of ['call', 'run', 'session'] as const) {
    expect(toolSessionKey(context, scope)).not.toBe(
      toolSessionKey({ ...context, resourceOwner: b.pending! }, scope),
    );
    expect(toolSessionKey(context, scope)).not.toBe(
      toolSessionKey({ ...context, identity: { ...context.identity, tenant: 'other' } }, scope),
    );
    expect(toolSessionKey(context, scope)).not.toBe(
      toolSessionKey({ ...context, sessionId: 'other' }, scope),
    );
  }
  expect(toolSessionKey(context, 'call')).toBe(
    toolSessionKey({ ...context, toolCallId: 'different-correlation' }, 'call'),
  );
});

it('session/shutdown rows remain until explicit host control and new turns do not reuse them', async () => {
  const closed: string[] = [],
    tier = new ToolSessionTier(),
    a = owner(0),
    b = owner(1);
  const va = tier.borrow(a, { sessionId: 's' }),
    vb = tier.borrow(b, { sessionId: 's' });
  for (const [label, view, ref] of [
    ['a', va, a],
    ['b', vb, b],
  ] as const) {
    expect(
      view.register(
        ref.pending!,
        { ...origin, sessionId: 's' },
        () => {
          closed.push(label);
        },
        { scope: 'session', key: 'same' },
      ).outcome,
    ).toBe('started');
    await view.finish(false);
  }
  expect(tier.liveCount()).toBe(2);
  expect(closed).toEqual([]);
  expect(await tier.fireSession('s')).toBe(2);
  expect(closed.sort()).toEqual(['a', 'b']);
});

it('a closed call refuses a retained registrar while its turn still admits later calls', async () => {
  const closed: string[] = [],
    reports: unknown[] = [],
    tier = new ToolSessionTier({
      report: (report) => reports.push(report),
    });
  const ref = owner(0),
    view = tier.borrow(ref, {});
  view.register(
    ref.pending!,
    origin,
    () => {
      closed.push('first');
    },
    { scope: 'call' },
  );
  await view.fireCall(ref.pending!);
  expect
    .soft(() =>
      view.register(
        ref.pending!,
        origin,
        () => {
          closed.push('late');
        },
        { scope: 'call' },
      ),
    )
    .toThrow(/retired/);
  await tier.settled();
  expect.soft(closed).toEqual(['first', 'late']);
  expect.soft(tier.liveCount()).toBe(0);
  expect
    .soft(reports)
    .toContainEqual(
      expect.objectContaining({ kind: 'close-failed', errorClass: 'ToolResourceClosedError' }),
    );
  const next = nextToolDispatch({ version: 1, birth: ref.birth, nextDispatch: 1 });
  view.register(
    next.pending!,
    origin,
    () => {
      closed.push('second');
    },
    { scope: 'call' },
  );
  await view.finish(false);
  expect(closed.at(-1)).toBe('second');
});
