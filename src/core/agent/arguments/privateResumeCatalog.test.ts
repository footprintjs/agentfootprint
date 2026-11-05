import { describe, expect, it } from 'vitest';
import type { CombinedRecorder } from 'footprintjs';
import { Agent, Sequence, defineTool, isInputPause, isCheckInPause } from '../../../index.js';
import { recordRun } from '../../../observe.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import {
  answer,
  batch,
  events,
  replyTo,
  scripted,
  stored,
} from '../../../../test/core/agent/arguments/askReviewHarness.js';

const SECRET = 'PRIVATE-resume-catalogue-fixture';
const call = { id: 'one', name: 'lookup', args: { region: 'eu' } };

function eraseCallerPolicy(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const found = Object.hasOwn(record, 'runRedaction') ? 1 : 0;
  if (found) delete record.runRedaction;
  return (
    found + Object.values(record).reduce<number>((sum, child) => sum + eraseCallerPolicy(child), 0)
  );
}

function erasePendingDeclaration(value: unknown): number {
  if (value === null || typeof value !== 'object') return 0;
  const record = value as Record<string, unknown>;
  const waiting = record.waiting as Record<string, unknown> | undefined;
  const found = waiting !== undefined && Object.hasOwn(waiting, 'privateFields') ? 1 : 0;
  if (found) delete waiting!.privateFields;
  return (
    found +
    Object.values(record).reduce<number>((sum, child) => sum + erasePendingDeclaration(child), 0)
  );
}

function setup(
  shape: 'direct' | 'mounted',
  hidden: boolean,
  checkIn = false,
  missing = false,
  covered = false,
) {
  const ran: unknown[] = [];
  const mock = scripted([batch(call), batch({ ...call, id: 'two' }), answer('Done')]);
  const tool = defineTool({
    name: 'lookup',
    description: 'Look up an account',
    inputSchema: {
      type: 'object',
      properties: { account: { type: 'string' }, region: { type: 'string' } },
    },
    askOrAssume: { account: { ask: 'Account?' } },
    ...(checkIn && { checkIn: 'always' as const }),
    execute: (args) => {
      ran.push({ ...args });
      return 'found';
    },
  });
  const view = {
    ...tool,
    [SHOWN_ARGS]: (args: Readonly<Record<string, unknown>>) =>
      'account' in args ? { ...args, account: 'REDACTED' } : args,
  };
  const builder = Agent.create({
    provider: mock.provider as never,
    model: 'fixture',
    ...(covered && { redact: { keys: ['history', 'pausedCheckInArgs'] } }),
  });
  const agent = (missing ? builder : builder.tool(hidden ? view : tool)).build();
  const runner = shape === 'direct' ? agent : Sequence.create().step('member', agent).build();
  const seen = events(runner as never);
  const hooks: unknown[] = [];
  runner.attach({
    id: 'private-resume-catalogue-hooks',
    ...Object.fromEntries(
      [
        'onPause',
        'onResume',
        'onWrite',
        'onRead',
        'onCommit',
        'onStageExecuted',
        'onRunStart',
        'onRunEnd',
      ].map((name) => [name, (value: unknown) => hooks.push({ name, value })]),
    ),
  } as CombinedRecorder);
  const recorder = recordRun(runner);
  return { runner, ran, mock, seen, hooks, recorder };
}

describe.each(['direct', 'mounted'] as const)('private pending resume: %s', (shape) => {
  it('refuses an altered caller-covered checkpoint even with a private carrier', async () => {
    const first = setup(shape, true, true, false, shape === 'mounted');
    const fresh = setup(shape, true, true);
    try {
      const asked = await first.runner.run(
        { message: 'go' },
        { redact: { keys: ['history', 'pausedCheckInArgs'] } },
      );
      if (!isInputPause(asked)) throw Error('Expected an argument question');
      const checkpoint = stored(asked);
      expect(eraseCallerPolicy(checkpoint)).toBeGreaterThan(0);
      let refusal: unknown;
      try {
        await fresh.runner.resume(checkpoint, replyTo(asked, { f1: SECRET }));
      } catch (error) {
        refusal = error;
      }
      expect.soft(refusal).toMatchObject({ code: 'ERR_RESUME_REDACTION', reason: 'missing' });
      expect(fresh.ran).toEqual([]);
    } finally {
      first.recorder.stop();
      fresh.recorder.stop();
      await first.runner.shutdown();
      await fresh.runner.shutdown();
    }
  });

  it.each(['view', 'tool'] as const)(
    'refuses a pending private answer when the fresh catalogue loses its %s',
    async (lost) => {
      const first = setup(shape, true);
      const fresh = setup(shape, false, false, lost === 'tool');
      try {
        const asked = await first.runner.run({ message: 'go' });
        if (!isInputPause(asked)) throw Error('Expected an argument question');
        let refusal: unknown;
        try {
          await fresh.runner.resume(stored(asked), replyTo(asked, { f1: SECRET }));
        } catch (error) {
          refusal = error;
        }
        if (lost === 'view')
          expect.soft(refusal).toMatchObject({ code: 'ERR_PRIVATE_ARGUMENT_RECORD' });
        expect.soft(fresh.ran).toEqual([]);
        const surfaces = {
          hooks: fresh.hooks,
          events: fresh.seen,
          recording: fresh.recorder.toRecording(),
          snapshot: fresh.runner.getSnapshot(),
          modelRequests: fresh.mock.requests,
        };
        for (const [name, surface] of Object.entries(surfaces)) {
          expect.soft(JSON.stringify(surface)?.includes(SECRET) === true, name).toBe(false);
        }
      } finally {
        first.recorder.stop();
        fresh.recorder.stop();
        await first.runner.shutdown();
        await fresh.runner.shutdown();
      }
    },
  );

  it('retains the complete saved caller policy on an untouched fresh continuation', async () => {
    const first = setup(shape, true, true, false, shape === 'mounted');
    const fresh = setup(shape, true, true);
    try {
      const asked = await first.runner.run(
        { message: 'go' },
        { redact: { keys: ['history', 'pausedCheckInArgs'] } },
      );
      if (!isInputPause(asked)) throw Error('Expected an argument question');
      const next = await fresh.runner.resume(stored(asked), replyTo(asked, { f1: SECRET }));
      expect(isCheckInPause(next)).toBe(true);
      if (!isCheckInPause(next)) throw Error('Expected the tool check-in');
      expect(next.checkpoint.sharedState.runRedaction).toMatchObject({
        keys: ['history', 'pausedCheckInArgs'],
      });
      if (shape === 'direct')
        expect(typeof fresh.runner.getSnapshot()?.sharedState.pausedCheckInArgs).toBe('string');
      expect(JSON.stringify(fresh.runner.getSnapshot()).includes(SECRET)).toBe(false);
      expect(fresh.ran).toEqual([]);
    } finally {
      first.recorder.stop();
      fresh.recorder.stop();
      await first.runner.shutdown();
      await fresh.runner.shutdown();
    }
  });

  it('refuses a protected question whose pending privacy declaration was removed', async () => {
    const first = setup(shape, true);
    const fresh = setup(shape, false);
    try {
      const asked = await first.runner.run({ message: 'go' });
      if (!isInputPause(asked)) throw Error('Expected an argument question');
      const checkpoint = stored(asked);
      expect(erasePendingDeclaration(checkpoint)).toBeGreaterThan(0);
      await expect(
        fresh.runner.resume(checkpoint, replyTo(asked, { f1: SECRET })),
      ).rejects.toMatchObject({ code: 'ERR_PRIVATE_ARGUMENT_RECORD' });
      expect(fresh.ran).toEqual([]);
      expect(JSON.stringify(fresh.recorder.toRecording()).includes(SECRET)).toBe(false);
    } finally {
      first.recorder.stop();
      fresh.recorder.stop();
      await first.runner.shutdown();
      await fresh.runner.shutdown();
    }
  });
});
