/**
 * SCENARIO — the standing reads how this turn's calls settled, in the answer
 * and from its saved recording. BOUNDARY — the retry needs comparable arguments.
 */

import { describe, expect, it, vi } from 'vitest';

import { Agent, checkInDeclined, defineTool, deny, isCheckInPause } from '../../../index.js';
import { mock } from '../../../llm-providers.js';
import { assessAnswer, recordRun, type AnswerAssessment } from '../../../observe.js';
import type { LLMMessage } from '../../../provider-contract/types.js';
import { assessmentDataOf } from './compose.js';

const TOOL = 'read_inventory';
const DISPLAY = 'Inventory lookup';
const ANSWER = 'I reviewed the inventory request.';
const NOT_COMPLETED = 'call-not-completed';

const call = (id: string, args: Record<string, unknown> = {}, name = TOOL) => ({
  toolCalls: [{ id, name, args }],
});
const answered = { content: ANSWER };
const failed = () => ({ content: 'Request received.', effects: [], status: 'failure' as const });

function inventory(execute: () => unknown, extra: { checkIn?: 'always'; ceiling?: number } = {}) {
  return defineTool({
    name: TOOL,
    displayName: DISPLAY,
    description: 'Read an item from the fixture inventory.',
    inputSchema: {
      type: 'object',
      properties: { item: { type: 'string' }, options: { type: 'object' } },
    },
    execute,
    ...(extra.checkIn !== undefined && { checkIn: extra.checkIn }),
    ...(extra.ceiling !== undefined && { resultCeiling: { maxChars: extra.ceiling } }),
  });
}

function agentFor(replies: (typeof answered | ReturnType<typeof call>)[], hideItem = false) {
  return Agent.create({
    provider: mock({ replies, chunkDelayMs: 0 }),
    model: 'mock',
    ...(hideItem && {
      redact: { fields: { history: ['1.toolCalls.0.args.item', '3.toolCalls.0.args.item'] } },
    }),
  }).answerLayer({ standingLine: true });
}

async function leg(agent: Agent, drive = () => agent.run({ message: 'Read the inventory.' })) {
  const recorder = recordRun(agent);
  try {
    const result = await drive();
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as ReturnType<
      typeof recorder.toRecording
    >;
    const assessment = assessAnswer(recording);
    expect(await agent.assessment()).toEqual(assessment);
    if (typeof result === 'string') {
      const projection = assessmentDataOf(assessment);
      const event = recording.events.find((e) => e.type === 'agentfootprint.answer.assessed');
      const turnEnd = recording.events.find((e) => e.type === 'agentfootprint.agent.turn_end');
      expect(event?.payload).toMatchObject(projection);
      expect(turnEnd?.payload).toMatchObject({ answerAssessment: projection });
    }
    return { result, assessment, history: recording.snapshot.sharedState.history as LLMMessage[] };
  } finally {
    recorder.stop();
  }
}

function expectIncomplete(
  assessment: AnswerAssessment,
  id = 'read-1',
  standing: AnswerAssessment['standing'] = 'not-sure',
  checks: readonly string[] = ['tool-coverage', 'result-shape'],
) {
  expect(assessment.standing).toBe(standing);
  const reason = assessment.reasons.find((entry) => entry.reason === NOT_COMPLETED);
  expect(reason).toMatchObject({
    layer: 3,
    witness: [{ kind: 'history', path: '/outcome', toolCallId: id }],
    source: { kind: 'calls', calls: [{ toolCallId: id, toolName: TOOL }] },
  });
  expect(assessment.checked.map((entry) => entry.check)).toEqual(checks);
}

function expectSettlementOnly(assessment: AnswerAssessment) {
  expectIncomplete(assessment, 'read-1', 'not-sure', []);
}

function expectLine(result: unknown, outcome: 'refused' | 'failed') {
  const text = String(result);
  expect(text).toContain(ANSWER + '\n\n---\n\nNot sure');
  expect(text).toContain(DISPLAY);
  expect(text).toMatch(
    outcome === 'refused' ? /refus|did not run|was not run/i : /fail|did not return/i,
  );
}

function expectOutcome(
  history: readonly LLMMessage[],
  id: string,
  outcome?: LLMMessage['outcome'],
) {
  const message = history.find((m) => m.role === 'tool' && m.toolCallId === id);
  expect(message).toBeDefined();
  expect(message?.outcome).toBe(outcome);
}

describe('the standing for a committed call outcome', () => {
  it('names a call declined at a check-in', async () => {
    const execute = vi.fn(() => 'Available');
    const agent = agentFor([call('read-1'), answered])
      .tool(inventory(execute, { checkIn: 'always' }))
      .build();
    const paused = await agent.run({ message: 'Read the inventory.' });
    if (!isCheckInPause(paused)) throw new Error('Expected a check-in.');
    const run = await leg(agent, () =>
      agent.resume(paused.checkpoint, checkInDeclined({ request: paused.checkIn, by: 'fixture' })),
    );
    expect(execute).not.toHaveBeenCalled();
    expectOutcome(run.history, 'read-1', 'refused');
    expectSettlementOnly(run.assessment);
    expectLine(run.result, 'refused');
  });

  it('names a call refused before execution', async () => {
    const execute = vi.fn(() => 'Available');
    const agent = agentFor([call('read-1'), answered])
      .tool(inventory(execute))
      .toolMiddleware({ name: 'fixture-scope', onToolCall: () => deny('Outside this request.') })
      .build();
    const run = await leg(agent);
    expect(execute).not.toHaveBeenCalled();
    expectOutcome(run.history, 'read-1', 'refused');
    expectSettlementOnly(run.assessment);
    expectLine(run.result, 'refused');
  });

  it.each([
    {
      title: 'an exception',
      execute: () => {
        throw new Error('Inventory service unavailable');
      },
    },
    { title: 'a declared failure with neutral result text', execute: failed },
    { title: 'a result withheld at the tool ceiling', execute: () => 'Available', ceiling: 3 },
  ])('names the call after $title', async ({ execute, ceiling }) => {
    const agent = agentFor([call('read-1'), answered])
      .tool(inventory(execute, { ceiling }))
      .build();
    const run = await leg(agent);
    expectOutcome(run.history, 'read-1', 'failed');
    if (ceiling === undefined) expectIncomplete(run.assessment);
    else expectSettlementOnly(run.assessment);
    expectLine(run.result, 'failed');
  });

  it('keeps the exact assessment and line for a completed call with refusal-like text', async () => {
    const agent = agentFor([call('read-1'), answered])
      .tool(inventory(() => 'declined by human: tool-authored text'))
      .build();
    const run = await leg(agent);
    expectOutcome(run.history, 'read-1');
    expect(JSON.stringify(run.assessment)).toBe(
      '{"assessment":"not-applicable","standing":"not-assessed","reasons":[],' +
        '"checked":[{"layer":3,"check":"tool-coverage","ran":0,"of":1,"witness":[]},' +
        '{"layer":3,"check":"result-shape","ran":0,"of":1,"witness":[]}],"turnFrom":"person"}',
    );
    expect(run.result).toBe(ANSWER + '\n\n---\n\nNot assessed — no check applied to this answer.');
  });

  it('keeps ask first when a later call is still waiting on the person', async () => {
    const confirm = defineTool({
      name: 'confirm_review',
      description: 'Confirm the fixture inventory review.',
      inputSchema: { type: 'object', properties: {} },
      checkIn: 'always',
      execute: () => 'Confirmed.',
    });
    const agent = agentFor([call('read-1'), call('confirm-1', {}, confirm.schema.name), answered])
      .tools([inventory(failed), confirm])
      .build();
    const run = await leg(agent);
    expect(isCheckInPause(run.result)).toBe(true);
    expectOutcome(run.history, 'read-1', 'failed');
    expect(run.assessment.reasons[0]?.reason).toBe('asked');
    expectIncomplete(run.assessment, 'read-1', 'ask');
  });
});

describe('retrying a call in the standing', () => {
  const firstArgs = { item: 'amber', options: { include: ['tags', 'notes'], limit: 2 } };
  const equalArgs = { options: { limit: 2, include: ['tags', 'notes'] }, item: 'amber' };
  const differentArgs = { ...equalArgs, item: 'green' };

  function retry(secondArgs = equalArgs, earlierFailure = true, hideItem = false) {
    const execute = vi.fn<() => unknown>(earlierFailure ? () => 'Available' : failed);
    execute.mockImplementationOnce(earlierFailure ? failed : () => 'Available');
    return agentFor([call('read-1', firstArgs), call('read-2', secondArgs), answered], hideItem)
      .tool(inventory(execute))
      .build();
  }

  it('clears a failure when the later call completes with structurally equal arguments', async () => {
    const run = await leg(retry());
    expectOutcome(run.history, 'read-1', 'failed');
    expectOutcome(run.history, 'read-2');
    expect(run.assessment.reasons).toEqual([]);
    expect(run.assessment.standing).toBe('not-assessed');
  });

  it('clears only the matching failure when retries reuse the call id', async () => {
    const id = 'lookup';
    const differentFailure = 'The green item could not be read.';
    const execute = vi
      .fn<() => unknown>(() => 'Available')
      .mockImplementationOnce(failed)
      .mockImplementationOnce(() => ({ ...failed(), content: differentFailure }));
    const run = await leg(
      agentFor([call(id, firstArgs), call(id, differentArgs), call(id, equalArgs), answered])
        .tool(inventory(execute))
        .build(),
    );
    expect(
      run.history
        .filter((message) => message.role === 'tool')
        .map(({ toolCallId, outcome }) => [toolCallId, outcome]),
    ).toEqual([
      [id, 'failed'],
      [id, 'failed'],
      [id, undefined],
    ]);
    expectIncomplete(run.assessment, id);
    expect(run.assessment.reasons[0]?.witness).toEqual([
      {
        kind: 'history',
        index: run.history.findIndex((message) => message.content === differentFailure),
        path: '/outcome',
        toolCallId: id,
      },
    ]);
  });

  it('keeps the failure when the matching completion was proposed in the same batch', async () => {
    const execute = vi.fn<() => unknown>(() => 'Available').mockImplementationOnce(failed);
    const batch = {
      toolCalls: [...call('read-1', firstArgs).toolCalls, ...call('read-2', equalArgs).toolCalls],
    };
    const run = await leg(agentFor([batch, answered]).tool(inventory(execute)).build());
    expectOutcome(run.history, 'read-1', 'failed');
    expectOutcome(run.history, 'read-2');
    expectIncomplete(run.assessment);
  });

  it('leaves a failure when the later call completes with different arguments', async () => {
    const run = await leg(retry(differentArgs));
    expectOutcome(run.history, 'read-1', 'failed');
    expectOutcome(run.history, 'read-2');
    expectIncomplete(run.assessment);
    expectLine(run.result, 'failed');
  });

  it('leaves a failure when only an earlier call completed with equal arguments', async () => {
    const run = await leg(retry(equalArgs, false));
    expectOutcome(run.history, 'read-1');
    expectOutcome(run.history, 'read-2', 'failed');
    expectIncomplete(run.assessment, 'read-2');
    expectLine(run.result, 'failed');
  });

  it.each(['masked', 'missing'] as const)(
    'leaves a failure when the saved arguments are %s',
    async (keptOut) => {
      const run = await leg(retry());
      const history = run.history.map((message) => {
        if (message.toolCalls?.length !== 1) return message;
        const { args, ...request } = message.toolCalls[0]!;
        return {
          ...message,
          toolCalls: [
            keptOut === 'masked' ? { ...request, args: { ...args, item: 'REDACTED' } } : request,
          ],
        };
      });
      const saved = assessAnswer({ snapshot: { sharedState: { history } } });
      expectIncomplete(saved);
    },
  );

  it('leaves a failure when the record policy hides part of otherwise equal arguments', async () => {
    const run = await leg(retry(equalArgs, true, true));
    const proposals = run.history.flatMap((message) => message.toolCalls ?? []);
    expect(proposals.map((proposal) => proposal.args.item)).toEqual(['REDACTED', 'REDACTED']);
    expectIncomplete(run.assessment);
    expectLine(run.result, 'failed');
  });

  it('does not carry a failure forward to the next person turn', async () => {
    const agent = agentFor([call('read-1', firstArgs), answered, answered])
      .tool(inventory(failed))
      .build();
    const first = await leg(agent);
    const next = await leg(agent, () =>
      agent.run({ message: 'Thanks.', continueFrom: agent.checkpoint()! }),
    );
    expectOutcome(next.history, 'read-1', 'failed');
    expect(next.assessment.reasons).toEqual([]);
    expect(next.assessment.standing).toBe('not-assessed');
    expectIncomplete(first.assessment);
  });
});
