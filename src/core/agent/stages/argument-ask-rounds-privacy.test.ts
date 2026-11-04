import { describe, expect, it } from 'vitest';
import {
  Agent,
  Sequence,
  defineTool,
  isInputPause,
  isPaused,
  isCheckInPause,
  checkInApproved,
} from '../../../index.js';
import { recordRun } from '../../../observe.js';
import { SHOWN_ARGS } from '../../toolShownArgs.js';
import {
  scripted,
  batch,
  answer,
  events,
  replyTo,
  stored,
} from '../../../../test/core/agent/arguments/askReviewHarness.js';

const SECRET = 'PRIVATE-account-42738';
const HOOKS = [
  'onResume',
  'onPause',
  'onWrite',
  'onRead',
  'onCommit',
  'onStageExecuted',
  'onStageStart',
  'onStageEnd',
  'onEmit',
  'onSubflowEntry',
  'onSubflowExit',
  'onDecision',
  'onSelected',
  'onRunStart',
  'onRunEnd',
  'onRunFailed',
  'onError',
  'onNext',
  'onLoop',
  'onBreak',
  'onFork',
  'onAttempt',
  'onStageRetry',
] as const;

describe.each(['direct', 'mounted'] as const)(
  'hidden answer across later projections: %s',
  (shape) => {
    it.each(['another-round', 'kept-check-in'] as const)(
      '%s keeps only checkpoint computation raw',
      async (leg) => {
        const ran: unknown[] = [];
        const tool = defineTool({
          name: 'lookup',
          description: 'Look up an account',
          inputSchema: {
            type: 'object',
            properties: {
              account: { type: 'string' },
              pin: { type: 'integer' },
              region: { type: 'string' },
            },
          },
          askOrAssume: {
            account: { ask: 'Account?' },
            ...(leg === 'another-round' && { pin: { ask: 'Pin?' } }),
          },
          ...(leg === 'kept-check-in' && { checkIn: 'always' as const }),
          execute: (args) => {
            ran.push({ ...args });
            return 'found';
          },
        });
        const hidden = {
          ...tool,
          [SHOWN_ARGS]: (args: Record<string, unknown>) =>
            'account' in args ? { ...args, account: 'REDACTED' } : args,
        };
        const m = scripted([
          batch({ id: 'one', name: 'lookup', args: { region: 'eu' } }),
          ...(leg === 'kept-check-in'
            ? [batch({ id: 'two', name: 'lookup', args: { region: 'eu' } })]
            : []),
          answer('Done'),
        ]);
        const agent = Agent.create({ provider: m.provider as never, model: 'mock' })
          .tool(hidden as never)
          .build();
        const runner = shape === 'direct' ? agent : Sequence.create().step('member', agent).build();
        const hooks: unknown[] = [];
        const recorder = { id: 'hidden-all-hooks' } as Record<string, unknown>;
        for (const hook of HOOKS) recorder[hook] = (value: unknown) => hooks.push({ hook, value });
        runner.attach(recorder as never);
        const seen = events(runner as never),
          record = recordRun(runner);
        try {
          const first = await runner.run({ message: 'go' });
          if (!isInputPause(first)) throw new Error('Expected initial argument ask');
          const values = Object.fromEntries(
            first.awaitingInput.fields.map((field) => [
              field.id,
              field.description?.includes('Account') ? SECRET : 2.5,
            ]),
          );
          const second = await runner.resume(stored(first), replyTo(first, values));
          expect(isPaused(second)).toBe(true);
          if (!isPaused(second)) throw new Error('Expected later pause');
          expect(JSON.stringify(second.checkpoint)).toContain(SECRET);
          for (const [name, surface] of Object.entries({
            hooks,
            events: seen,
            recording: record.toRecording(),
            snapshot: runner.getSnapshot(),
            narrative: agent.getLastNarrativeEntries(),
            rows: agent.findings(),
            pauseData: second.pauseData,
          }))
            expect(
              secretPaths(surface),
              name + ' leaked hidden answer: ' + secretPaths(surface).join(','),
            ).toEqual([]);
          if (leg === 'another-round') {
            if (!isInputPause(second)) throw new Error('Expected pin re-ask');
            expect(second.awaitingInput.fields).toHaveLength(1);
            await runner.resume(stored(second), replyTo(second, { f1: 42 }));
            expect(ran).toEqual([{ region: 'eu', account: SECRET, pin: 42 }]);
          } else {
            if (!isCheckInPause(second)) throw new Error('Expected kept-answer check-in');
            expect(second.checkIn.args).toEqual({ region: 'eu', account: 'REDACTED' });
            expect(JSON.stringify(second.checkIn.evidence)).not.toContain(SECRET);
            await runner.resume(
              stored(second),
              checkInApproved({ request: second.checkIn, by: 'fixture-person' }),
            );
            expect(ran).toEqual([{ region: 'eu', account: SECRET }]);
          }
          for (const [name, surface] of Object.entries({
            hooks,
            events: seen,
            recording: record.toRecording(),
            snapshot: runner.getSnapshot(),
            narrative: agent.getLastNarrativeEntries(),
            rows: agent.findings(),
          })) {
            const paths = secretPaths(surface);
            expect(paths, name + ' final leak paths: ' + paths.join(',')).toEqual([]);
          }
          // Visible structure remains; this test does not pass by masking the run wholesale.
          expect(JSON.stringify(seen)).toContain('lookup');
          expect(JSON.stringify(runner.getSnapshot())).toContain('region');
        } finally {
          record.stop();
          await runner.shutdown();
        }
      },
    );
  },
);

function secretPaths(value: unknown, path = '', seen = new Set<unknown>()): string[] {
  if (typeof value === 'string') return value.includes(SECRET) ? [path] : [];
  if (value === null || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  return Object.entries(value).flatMap(([key, item]) => secretPaths(item, path + '/' + key, seen));
}
