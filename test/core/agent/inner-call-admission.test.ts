import { describe, expect, it } from 'vitest';
import { bindOuterCall } from '../../../src/core/agent/innerCallOuter.js';
import { agentToolDispatch, type InnerCallFacts } from '../../../src/core/agent/toolDispatch.js';
import type { ToolExecutionContext } from '../../../src/tools/tools.js';
import { target } from './fixtures/innerCalls.js';

function latch() {
  let release!: () => void;
  const wait = new Promise<void>((resolve) => {
    release = resolve;
  });
  return { wait, release };
}

function resultOf(value: Promise<unknown>) {
  return value.then(
    () => 'entered',
    (error: unknown) => String(error),
  );
}

const fixtureHalt = {
  reason: 'fixture-stop',
  tellLLM: 'Fixture stopped.',
  call: { toolCallId: 'sample-owner#inner-0', toolName: 'earlier', args: {} },
};

describe('composed call admission', () => {
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
    expect(outer.ended).toBe(true);
    try {
      await new Promise<void>((resolve) => setImmediate(resolve));
      expect(finished).toBe(false);
    } finally {
      answer.release();
    }
    await expect(pending).resolves.toBe(true);
    await close;
    expect(outer.halt).toEqual(fixtureHalt);
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

  it('holds the next admission until the current call enters, then releases before it returns', async () => {
    const outer = bindOuterCall();
    const gate = latch();
    const executing = latch();
    const gateStarted = latch();
    const asks: unknown[][] = [];
    const tool = target('sample', {
      execute: async (args) => {
        if (args.account === 'first') await executing.wait;
        return 'fixture';
      },
    }).tool;
    const dispatch = agentToolDispatch({
      outer,
      outerToolCallId: 'sample-owner',
      lookup: () => tool,
      innerContext: () => ({} as ToolExecutionContext),
      gates: {
        permission: async ({ args }) => {
          asks.push(outer.admitted().map((call) => call.args.account));
          if (args.account === 'first') {
            gateStarted.release();
            await gate.wait;
          }
          return { kind: 'allow' };
        },
      },
    });
    const first = dispatch.call('sample', { account: 'first' });
    await gateStarted.wait;
    const second = dispatch.call('sample', { account: 'second' });
    expect(asks).toEqual([[]]);
    try {
      gate.release();
      await expect(second).resolves.toBe('fixture');
      expect(asks).toEqual([[], ['first']]);
    } finally {
      executing.release();
      await first;
    }
  });

  it.each(['ended', 'halt'] as const)(
    'stops queued work when the owner becomes %s',
    async (state) => {
      const outer = bindOuterCall();
      const gate = latch();
      const gateStarted = latch();
      const { tool, entered } = target('sample');
      const asks: string[] = [];
      const rows: InnerCallFacts[] = [];
      const dispatch = agentToolDispatch({
        outer,
        outerToolCallId: 'sample-owner',
        lookup: () => tool,
        innerContext: () => ({} as ToolExecutionContext),
        record: (row) => rows.push(row),
        gates: {
          permission: async ({ toolCallId }) => {
            asks.push(toolCallId);
            gateStarted.release();
            await gate.wait;
            return { kind: 'allow' };
          },
        },
      });
      const first = resultOf(dispatch.call('sample', { account: 'first' }));
      await gateStarted.wait;
      const second = resultOf(dispatch.call('sample', { account: 'second' }));
      const close = state === 'ended' ? outer.close() : undefined;
      if (state === 'halt') outer.halted(fixtureHalt);
      gate.release();
      await close;
      expect(await first).toMatch(state === 'ended' ? /has ended/ : /policy halted/);
      expect(await second).toMatch(state === 'ended' ? /has ended/ : /policy halted/);
      expect(asks).toEqual(['sample-owner#inner-1']);
      expect(entered).toEqual([]);
      expect(rows).toMatchObject([
        { toolCallId: 'sample-owner#inner-1', entered: false, refusedBy: state },
        { toolCallId: 'sample-owner#inner-2', entered: false, refusedBy: state },
      ]);
    },
  );
});
