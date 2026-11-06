/**
 * A pause raised INSIDE the `dynamic-grouped` boundary, with integrity rows held
 * on the boundary's own scope, resumed on a fresh instance from a JSON checkpoint.
 *
 * The library's own pauses are raised on the outer chart (tool dispatch, the
 * argument ask), so a provider raises this one, in the shape `interrupt()` throws and
 * the stage boundary converts. A thinking handler cannot: `buildThinkingSubflow`
 * catches what `normalize()` throws. What it pins: the rows ride the subflow's capture,
 * reach the ledger once through the Route decider, and the standing equals the saved
 * record.
 *
 * Only rows filed before the provider call can be held at this pause: the wire and
 * choice seams file after the response, and nothing after them in the boundary pauses.
 *
 * Test types (Convention 3): BOUNDARY.
 */

import { describe, expect, it } from 'vitest';

import { Agent, defineTool, slidingWindow } from '../../../index.js';
import { isPaused } from '../../pause.js';
import { assessAnswer, recordRun } from '../../../observe.js';
import { assessmentDataOf, type AnswerAssessmentData } from './compose.js';

const usage = { input: 10, output: 5 };
const call = (id: string, name: string) => ({
  content: '',
  toolCalls: [{ id, name, args: {} }],
  stopReason: 'tool_use' as const,
  usage,
});
const answered = (extra: object = {}) => ({
  content: 'The answer.',
  toolCalls: [],
  stopReason: 'stop' as const,
  usage,
  ...extra,
});
const raisePause = (): never => {
  throw Object.assign(new Error('Execution interrupted'), {
    name: 'InterruptSignal',
    payload: { reason: 'Hold on?' },
  });
};

const tool = (name: string, extra: object = {}) =>
  defineTool({
    name,
    description: name,
    inputSchema: { type: 'object', properties: {} },
    execute: () => `IDS ${'x'.repeat(600)}`,
    ...extra,
  } as never);

interface Paused {
  readonly checkpoint: {
    readonly subflowPath: readonly string[];
    readonly subflowStates: Record<string, Record<string, unknown>>;
    readonly sharedState: Record<string, unknown>;
  };
}

/** Resume on a new instance from the saved checkpoint; the equality law held on that leg. */
async function resumeFresh(fresh: Agent, paused: Paused) {
  let inRun: AnswerAssessmentData | undefined;
  fresh.on('agentfootprint.answer.assessed', (e) => {
    const { turn: _t, iteration: _i, ...data } = e.payload as unknown as Record<string, unknown>;
    void _t;
    void _i;
    inRun = data as unknown as AnswerAssessmentData;
  });
  const recorder = recordRun(fresh);
  await fresh.resume(JSON.parse(JSON.stringify(paused.checkpoint)) as never, 'yes');
  const text = JSON.stringify(recorder.toRecording());
  recorder.stop();
  const saved = assessAnswer(JSON.parse(text));
  expect(inRun).toBeDefined();
  expect(assessmentDataOf(saved)).toEqual(inRun);
  expect(await fresh.assessment()).toEqual(saved);
  const state = fresh.getLastSnapshot()?.sharedState as Record<string, unknown>;
  const rows = ((state.findingsLedger ?? []) as Record<string, unknown>[]).filter(
    (row) => row.kind === 'integrity-finding',
  );
  return { saved, rows, state };
}

describe('BOUNDARY — a pause inside the grouped boundary, resumed fresh', () => {
  it('a row held before the provider call: the note reaches the resumed answer, once', async () => {
    let calls = 0;
    let filed = false;
    let raised = false;
    const provider = {
      name: 'mock',
      complete: async () => {
        calls += 1;
        if (calls === 1) return call('c1', 'whats_here');
        if (filed && !raised) {
          raised = true;
          raisePause();
        }
        return raised ? answered() : call(`c${calls}`, 'screen_fire');
      },
    };
    const build = () =>
      Agent.create({
        provider: provider as never,
        model: 'm',
        maxIterations: 12,
        keepLastToolResults: false,
        reactMode: 'dynamic-grouped',
      })
        .tools([tool('whats_here'), tool('screen_fire', { argumentsFrom: ['whats_here'] })])
        .window(slidingWindow({ keepRecentTurns: 2 }))
        .answerLayer()
        .build();
    const agent = build();
    agent.on('agentfootprint.integrity.context_error', () => {
      filed = true;
    });
    const paused = (await agent.run({ message: 'walk' })) as unknown as Paused;
    expect(isPaused(paused as never)).toBe(true);
    expect(paused.checkpoint.subflowPath).toEqual(['sf-llm-call']);
    const held = paused.checkpoint.subflowStates['sf-llm-call']!.integrityFindingRows as unknown[];
    expect(held).toHaveLength(1);
    expect(paused.checkpoint.sharedState.integrityFindingRows).toBeUndefined();
    expect(paused.checkpoint.sharedState.findingsLedger ?? []).toEqual([]);

    const r = await resumeFresh(build(), paused);
    expect(r.saved.notes?.map((n) => n.finding)).toEqual(['dangling-reference']);
    expect(r.rows).toHaveLength(1);
    expect(r.state.integrityFindingRows).toBeUndefined();
  });

  it('rows held on both scopes: a lowering row from outside and a note from inside, each once', async () => {
    let calls = 0;
    let raised = false;
    const provider = {
      name: 'mock',
      complete: async () => {
        calls += 1;
        if (calls === 1) return call('c1', 'whats_here');
        // The column finding is filed by tool-calls on the OUTER scope in pass 3, and is
        // still held when pass 4's boundary files its first dangling row, then pauses.
        if (calls === 3) return call('c3', 'lun_map');
        if (calls === 4 && !raised) {
          raised = true;
          raisePause();
        }
        return raised ? answered() : call(`c${calls}`, 'screen_fire');
      },
    };
    const build = () =>
      Agent.create({
        provider: provider as never,
        model: 'm',
        maxIterations: 12,
        keepLastToolResults: false,
        reactMode: 'dynamic-grouped',
        checkColumnTypes: 'warn',
      })
        .tools([
          tool('whats_here'),
          tool('screen_fire', { argumentsFrom: ['whats_here'] }),
          defineTool({
            name: 'lun_map',
            description: 'lun_map',
            inputSchema: { type: 'object', properties: {} },
            resultColumns: { logical_unit_number: 'number' } as never,
            execute: () => [{ other: 1 }],
          }),
        ])
        .window(slidingWindow({ keepRecentTurns: 2 }))
        .answerLayer()
        .build();
    const paused = (await build().run({ message: 'walk' })) as unknown as Paused;
    expect(isPaused(paused as never)).toBe(true);
    const finding = (rows: unknown) =>
      (rows as readonly { finding: string }[]).map((row) => row.finding);
    expect(finding(paused.checkpoint.sharedState.integrityFindingRows)).toEqual(['missing-column']);
    expect(finding(paused.checkpoint.subflowStates['sf-llm-call']!.integrityFindingRows)).toEqual([
      'missing-column',
      'dangling-reference',
    ]);

    const r = await resumeFresh(build(), paused);
    expect(r.saved.standing).toBe('not-sure');
    expect(r.saved.reasons.map((x) => x.reason)).toEqual(['missing-column']);
    expect(r.saved.notes?.map((n) => n.finding)).toEqual(['dangling-reference']);
    expect(finding(r.rows)).toEqual(['missing-column', 'dangling-reference']);
    expect(r.state.integrityFindingRows).toBeUndefined();
  });
});

describe('BOUNDARY — two filings on one scope before the Route decider files them', () => {
  it.each(['classic', 'dynamic', 'dynamic-grouped'] as const)(
    'a batch of two calls keeps both rows (%s)',
    async (reactMode) => {
      const columns = (name: string) =>
        defineTool({
          name,
          description: name,
          inputSchema: { type: 'object', properties: {} },
          resultColumns: { logical_unit_number: 'number' } as never,
          execute: () => [{ other: 1 }],
        });
      let calls = 0;
      const agent = Agent.create({
        provider: {
          name: 'mock',
          complete: async () => {
            calls += 1;
            if (calls > 1) return answered();
            return {
              ...call('a', 'first_map'),
              toolCalls: [
                { id: 'a', name: 'first_map', args: {} },
                { id: 'b', name: 'second_map', args: {} },
              ],
            };
          },
        } as never,
        model: 'm',
        reactMode,
        checkColumnTypes: 'warn',
      })
        .tools([columns('first_map'), columns('second_map')])
        .answerLayer()
        .build();
      await agent.run({ message: 'go' });
      const state = agent.getLastSnapshot()?.sharedState as {
        findingsLedger: readonly { kind: string; tools?: readonly string[] }[];
      };
      const rows = state.findingsLedger.filter((row) => row.kind === 'integrity-finding');
      expect(rows.map((row) => row.tools)).toEqual([['first_map'], ['second_map']]);
    },
  );
});
