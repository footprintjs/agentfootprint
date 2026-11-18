import { describe, expect, it, vi } from 'vitest';
import { bindOuterCall } from '../../../src/core/agent/innerCallOuter.js';
import { policyArgsOf } from '../../../src/core/agent/innerCallPolicyArgs.js';
import { refusalVerdictOf } from '../../../src/core/agent/runtime/terminal/verdicts.js';
import { stopStoredPolicyHalt } from '../../../src/core/agent/stages/toolCalls/routing/policyHalt.js';

function latch() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

const fixtureHalt = {
  reason: 'fixture-stop',
  tellLLM: 'Fixture stopped.',
  call: { toolCallId: 'sample-owner#inner-0', toolName: 'earlier', args: {} },
};

describe('inner call policy contracts', () => {
  it('closes either caller of the gate with an already-recorded terminal outcome', () => {
    const state = { policyHaltReason: 'fixture-stop', policyHaltTarget: 'sample' };
    const stop = vi.fn();
    const scope = Object.assign(state, {
      $getValue: (key: keyof typeof state) => state[key],
      $break: stop,
    });
    expect(stopStoredPolicyHalt(scope as never)).toBe(true);
    expect(stop).toHaveBeenCalledWith('policy-halt: fixture-stop');
    expect(stopStoredPolicyHalt({} as never)).toBe(false);
  });

  it('reads the carried invocation identity independently of other rows with that name', () => {
    const state = {
      policyHaltReason: 'fixture-stop',
      policyHaltTarget: 'sample',
      policyHaltArgs: {},
      innerToolCalls: [{ toolName: 'sample', toolCallId: 'previous#inner-1', halted: true }],
    };
    expect(refusalVerdictOf(state, { messageMiddleware: [] })).toMatchObject({
      kind: 'policy-halt',
      halt: { sequence: [{ name: 'sample' }] },
    });
    const narrowed = refusalVerdictOf(state, { messageMiddleware: [] });
    if (narrowed?.kind !== 'policy-halt') throw new Error('expected a halt');
    expect(narrowed.halt.sequence[0].inner).toBeUndefined();
    expect(
      refusalVerdictOf(
        { ...state, policyHaltInnerCallId: 'current#inner-1' },
        { messageMiddleware: [] },
      ),
    ).toMatchObject({ kind: 'policy-halt', halt: { sequence: [{ name: 'sample', inner: true }] } });
  });

  it('waits for an in-flight decision before publishing the first terminal verdict', async () => {
    const outer = bindOuterCall();
    const started = latch();
    const answer = latch();
    const pending = outer.scheduleAdmission(async () => {
      started.release();
      await answer.wait;
      return outer.halted(fixtureHalt);
    });
    await started.wait;

    let finished = false;
    const close = outer.close().then(() => {
      finished = true;
    });
    try {
      expect(outer.ended).toBe(true);
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
    } finally {
      answer.release();
    }
    await expect(pending).resolves.toBe(true);
    await close;
    expect(outer.halt).toEqual(fixtureHalt);
    expect(outer.haltSignal.aborted).toBe(true);
    expect(outer.halted({ ...fixtureHalt, reason: 'later' })).toBe(false);
  });

  it('stops waiting on cancellation and declines a decision reported afterward', async () => {
    const outer = bindOuterCall();
    const controller = new AbortController();
    const started = latch();
    const answer = latch();
    const pending = outer.scheduleAdmission(async () => {
      started.release();
      await answer.wait;
      return outer.halted(fixtureHalt);
    });
    await started.wait;

    const close = outer.close(controller.signal);
    try {
      controller.abort();
      await close;
      expect(outer.halt).toBeUndefined();
    } finally {
      answer.release();
    }
    await expect(pending).resolves.toBe(false);
    expect(outer.halt).toBeUndefined();
  });

  it('starts the second admission only after the first decision completes', async () => {
    const outer = bindOuterCall();
    const started = latch();
    const finish = latch();
    const order: string[] = [];
    const first = outer.scheduleAdmission(async () => {
      started.release();
      await finish.wait;
      order.push('first');
    });
    await started.wait;

    const second = outer.scheduleAdmission(async () => {
      order.push('second');
    });
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(order).toEqual([]);
    } finally {
      finish.release();
      await Promise.all([first, second]);
    }
    expect(order).toEqual(['first', 'second']);
  });
});

it('requires positive provenance for displayed arguments from a prior inner call', () => {
  const scope = { $getValue: () => undefined } as never;
  const displayed = { toolCallId: 'fixture#inner-1', toolName: 'sample', args: { count: 1 } };
  expect(() => policyArgsOf(scope, displayed)).toThrow(
    'Policy arguments from an earlier inner call are unavailable.',
  );
  expect(policyArgsOf(scope, { ...displayed, policyArgsRef: null })).toEqual({ count: 1 });
  const policyArgsRef = 'fixture-input';
  const protectedScope = { $getValue: () => ({ [policyArgsRef]: { count: 2 } }) } as never;
  expect(policyArgsOf(protectedScope, { ...displayed, policyArgsRef })).toEqual({ count: 2 });
});
