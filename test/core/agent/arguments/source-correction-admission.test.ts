import { describe, expect, it } from 'vitest';
import { commitValueAt } from 'foottrace';
import { isPaused } from '../../../../src/index.js';
import {
  VM,
  QUESTION,
  TOOL,
  proposal,
  quoted,
  batch,
  correctionFixture,
  stateOf,
  argumentsOf,
} from './sourceCorrectionHarness.js';

describe('source correction settles only at the actual native batch barrier', () => {
  it('withholds before permission or human-context callbacks and never publishes a tool bracket/result', async () => {
    let permissions = 0,
      humanContexts = 0;
    const f = correctionFixture([batch(proposal('held-before-callbacks', { vm: VM })), 'Held.'], {
      configure: {
        permissionChecker: {
          name: 'synthetic-permission',
          check() {
            permissions++;
            return { result: 'allow' };
          },
        },
        argumentAskContext() {
          humanContexts++;
          return {};
        },
      },
    });
    try {
      expect(await f.agent.run(QUESTION)).toBe('Held.');
      expect(permissions).toBe(0);
      expect(humanContexts).toBe(0);
      expect(f.ran).toEqual([]);
      expect(
        f.events.some((event) =>
          [
            'agentfootprint.stream.tool_start',
            'agentfootprint.stream.tool_end',
            'agentfootprint.stream.tool_progress',
          ].includes(event.type),
        ),
      ).toBe(false);
      expect(stateOf(f.agent).toolResults).toEqual([]);
      expect(stateOf(f.agent).lastToolResult).toBeUndefined();
    } finally {
      await f.agent.shutdown();
    }
  });
  it('cancellation after input staging and before ToolCalls spends nothing and files no fictional ask', async () => {
    const controller = new AbortController();
    const f = correctionFixture([batch(proposal('stopped', { vm: VM }))]);
    const stop = f.agent.on('agentfootprint.agent.route_decided', () => {
      controller.abort(new Error('Synthetic before-dispatch stop'));
    });
    try {
      const outcome = await f.agent
        .run(QUESTION, { signal: controller.signal })
        .catch((error: unknown) => error);
      expect(outcome).toBeInstanceOf(Error);
      expect(controller.signal.aborted).toBe(true);
      expect(f.requests).toHaveLength(1);
      expect(f.ran).toEqual([]);
      expect(f.agent.findings() ?? []).toEqual([]);
      expect(stateOf(f.agent).sourceDeclarationCorrectionSpent).not.toBe(true);
      expect(f.agent.checkpoint()?.sourceDeclarationCorrection).toBeUndefined();
    } finally {
      stop();
      await f.agent.shutdown();
    }
  });
  it('a sibling with native malformed streamed arguments preempts automatic correction', async () => {
    const f = correctionFixture([
      batch(proposal('candidate', { vm: VM }), {
        id: 'malformed-wire',
        name: TOOL,
        args: {},
        argumentsFailure: { reason: 'invalid-json' },
      }),
    ]);
    try {
      expect(isPaused(await f.agent.run(QUESTION))).toBe(true);
      expect(f.requests).toHaveLength(1);
      expect(f.ran).toEqual([]);
      expect(argumentsOf(f.agent, 'candidate')).toEqual([
        expect.objectContaining({ asked: 'unverified', claimed: 'none' }),
      ]);
      expect(stateOf(f.agent).sourceDeclarationCorrectionSpent).not.toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });
  it.each(['dynamic', 'dynamic-grouped'] as const)(
    'files one correction in ToolCalls, then verified execution (%s)',
    async (mode) => {
      const f = correctionFixture(
        [batch(proposal('omitted', { vm: VM })), batch(quoted('verified')), 'Done.'],
        { mode },
      );
      try {
        expect(await f.agent.run(QUESTION)).toBe('Done.');
        expect(f.ran).toEqual([{ vm: VM }]);
        expect(argumentsOf(f.agent, 'omitted')).toHaveLength(1);
        expect(argumentsOf(f.agent, 'omitted')[0]).toMatchObject({
          correction: 'source-declaration-required',
        });
        const log = f.agent.getSnapshot()!.commitLog;
        const first = log.findIndex((bundle, index) =>
          bundle.trace.some((trace) => {
            if (!trace.path.endsWith('findingsLedger')) return false;
            const rows = commitValueAt(log, index, trace.path);
            return Array.isArray(rows) && rows.some((row) => row?.toolCallId === 'omitted');
          }),
        );
        expect(first).toBeGreaterThanOrEqual(0);
        expect(log[first]?.runtimeStageId).toMatch(/tool-calls/);
        const emitted = f.events.filter(
          (event) =>
            event.type === 'agentfootprint.findings.argument' &&
            (event.payload as { toolCallId?: string }).toolCallId === 'omitted',
        );
        expect(emitted).toHaveLength(1);
        expect(emitted[0]?.payload).not.toHaveProperty('asked');
        expect(stateOf(f.agent).argumentSourceOmissionRows).toEqual([]);
      } finally {
        await f.agent.shutdown();
      }
    },
  );

  it('settles valid-ID protocol preemption without spending correction or raising a human ask', async () => {
    const f = correctionFixture([
      batch(proposal('candidate', { vm: VM }), { id: 'bad-name', name: '', args: {} }),
      'Refused.',
    ]);
    try {
      expect(await f.agent.run(QUESTION)).toBe('Refused.');
      expect(f.ran).toEqual([]);
      expect(argumentsOf(f.agent, 'candidate')).toEqual([
        expect.objectContaining({ withheld: 'batch-preempted', claimed: 'none' }),
      ]);
      expect(argumentsOf(f.agent, 'candidate')[0]).not.toHaveProperty('asked');
      expect(argumentsOf(f.agent, 'candidate')[0]).not.toHaveProperty('correction');
      expect(stateOf(f.agent).sourceDeclarationCorrectionSpent).not.toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });

  it.each(['', 'same'])('unbindable IDs cannot mint correlated rows or spend (%j)', async (id) => {
    const calls = [proposal(id, { vm: VM }), ...(id ? [proposal(id, { vm: VM })] : [])];
    const f = correctionFixture([batch(...calls), 'Refused.']);
    try {
      expect(await f.agent.run(QUESTION)).toBe('Refused.');
      expect(f.ran).toEqual([]);
      expect(
        argumentsOf(f.agent).some((row) => row.correction !== undefined || row.asked !== undefined),
      ).toBe(false);
      expect(stateOf(f.agent).sourceDeclarationCorrectionSpent).not.toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('a host-context failure before a mixed human question does not file the deferred candidate as asked', async () => {
    const f = correctionFixture([batch(proposal('present', { vm: VM }), proposal('human', {}))], {
      configure: {
        argumentAskContext: () => {
          throw new Error('Synthetic host context failure');
        },
      },
    });
    try {
      await expect(f.agent.run(QUESTION)).rejects.toThrow(/Synthetic host context failure/);
      expect(f.ran).toEqual([]);
      expect(argumentsOf(f.agent, 'present')).toEqual([]);
      expect(stateOf(f.agent).sourceDeclarationCorrectionSpent).not.toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('a malformed basis/source declaration preserves native reference refusal without correction', async () => {
    const f = correctionFixture(
      [
        batch(
          proposal('malformed', {
            vm: VM,
            _findings: { basis: 'direct', from: [{ argument: 'vm', source: 'user', quote: 7 }] },
          }),
        ),
      ],
      { findings: true },
    );
    try {
      expect(await f.agent.run(QUESTION)).toBe('Finished synthetic fixture.');
      expect(f.requests).toHaveLength(2);
      expect(f.ran).toEqual([]);
      expect(argumentsOf(f.agent, 'malformed')).toEqual([
        expect.objectContaining({ asked: 'unverified', claimed: 'none' }),
      ]);
      expect(argumentsOf(f.agent, 'malformed')[0]).not.toHaveProperty('correction');
      expect(f.agent.findings()).toContainEqual(
        expect.objectContaining({ kind: 'reference-refusal', reason: 'malformed' }),
      );
      expect(stateOf(f.agent).sourceDeclarationCorrectionSpent).not.toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });

  it('multiple eligible omissions spend one batch opportunity and a repeated omission asks normally', async () => {
    const f = correctionFixture([
      batch(proposal('a', { vm: VM }), proposal('b', { vm: VM })),
      batch(proposal('again', { vm: VM })),
    ]);
    try {
      expect(isPaused(await f.agent.run(QUESTION))).toBe(true);
      expect(f.requests).toHaveLength(2);
      expect(f.ran).toEqual([]);
      expect(argumentsOf(f.agent).filter((row) => row.correction !== undefined)).toHaveLength(2);
      expect(argumentsOf(f.agent, 'again')).toEqual([
        expect.objectContaining({ asked: 'unverified' }),
      ]);
      expect(stateOf(f.agent).sourceDeclarationCorrectionSpent).toBe(true);
    } finally {
      await f.agent.shutdown();
    }
  });
});
