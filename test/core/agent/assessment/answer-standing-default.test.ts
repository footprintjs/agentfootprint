import { describe, expect, it, vi } from 'vitest';

import {
  Agent,
  askHuman,
  defineTool,
  deny,
  isPaused,
  slidingWindow,
  type AgentOptions,
} from '../../../../src/index.js';
import type { MockReply } from '../../../../src/adapters/llm/MockProvider.js';
import type {
  AnswerAssessedPayload,
  AnswerAssessmentPayload,
} from '../../../../src/events/payloads/answer.js';
import { mock } from '../../../../src/llm-providers.js';
import { assessAnswer, recordRun } from '../../../../src/observe.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';

const ANSWER = 'The work is done.';
const PENDING = 'Not sure — a tool reported unfinished work.';
const withLine = (body: string, line: string) => `${body}\n\n---\n\n${line}`;
const call = (id: string, name: string) => ({ toolCalls: [{ id, name, args: {} }] });

const tool = (name: string, execute: () => unknown) =>
  defineTool({
    name,
    description: `Run ${name}.`,
    inputSchema: { type: 'object', properties: {} },
    execute,
  });

const pendingTool = tool('submit', () => ({
  content: 'Request received.',
  effects: [],
  status: 'pending',
}));
const replies = [call('c1', 'submit'), ANSWER];

function builder(script: readonly MockReply[], options: Partial<AgentOptions> = {}) {
  return Agent.create({ provider: mock({ replies: script }), model: 'mock', ...options });
}

function capture(agent: Agent) {
  const assessed: AnswerAssessedPayload[] = [];
  const turnEnd: { finalContent: string; answerAssessment?: AnswerAssessmentPayload }[] = [];
  agent.on('agentfootprint.answer.assessed', ({ payload }) => assessed.push(payload));
  agent.on('agentfootprint.agent.turn_end', ({ payload }) => turnEnd.push(payload));
  return { assessed, turnEnd };
}

function assessmentAtEnd(
  events: ReturnType<typeof capture>,
  text: string,
  index = 0,
): AnswerAssessedPayload {
  const event = events.assessed[index];
  expect(event, `assessment event ${index + 1}`).toBeDefined();
  const { turn: _turn, iteration: _iteration, ...projection } = event!;
  expect(events.turnEnd[index]?.finalContent).toBe(text);
  expect(events.turnEnd[index]?.answerAssessment).toEqual(projection);
  return event!;
}

describe('SCENARIO — the answer standing defaults to warnings only', () => {
  it('delivers the exact model answer for a plain agent and records that no check applied', async () => {
    const agent = builder([ANSWER]).build();
    const events = capture(agent);
    expect(await agent.run({ message: 'What happened?' })).toBe(ANSWER);
    expect(events.assessed).toHaveLength(1);
    expect(assessmentAtEnd(events, ANSWER)).toEqual({
      turn: 1,
      iteration: 1,
      assessment: 'not-applicable',
      standing: 'not-assessed',
      reasons: [],
      checked: [],
    });
  });

  it.each([
    { outcome: 'failed', line: 'Not sure — a call failed.' },
    { outcome: 'refused', line: 'Not sure — a call was refused.' },
  ])('warns when a call $outcome', async ({ outcome, line }) => {
    const execute = vi.fn(() => {
      throw new Error('The fixture is unavailable.');
    });
    const setup = builder(replies).tool(tool('submit', execute));
    if (outcome === 'refused') {
      setup.toolMiddleware({ name: 'fixture-policy', onToolCall: () => deny('Out of scope.') });
    }
    const agent = setup.build();
    const events = capture(agent);
    const text = withLine(ANSWER, line);
    expect(await agent.run({ message: 'Please do the work.' })).toBe(text);
    expect(execute).toHaveBeenCalledTimes(outcome === 'refused' ? 0 : 1);
    expect(assessmentAtEnd(events, text)).toMatchObject({
      standing: 'not-sure',
      reasons: ['call-not-completed'],
    });
  });
});

describe('BOUNDARY — hosts can turn off the layer or its warning text', () => {
  it('records suppression only on the turn whose reasons missed the filter', async () => {
    const agent = builder([call('c1', 'read_ports'), ANSWER, call('c2', 'submit'), ANSWER])
      .tool(tool('read_ports', () => []))
      .tool(pendingTool)
      .answerLayer({ standingLine: { when: 'not-sure-or-ask', raiseOn: ['work-not-finished'] } })
      .build();
    const events = capture(agent);
    expect(await agent.run({ message: 'Read the ports.' })).toBe(ANSWER);
    expect(assessmentAtEnd(events, ANSWER)).toMatchObject({ reasons: ['empty-undeclared'] });
    expect(events.turnEnd[0]).toHaveProperty('standingLineOmittedByRaiseOn', true);

    const next = withLine(ANSWER, PENDING);
    expect(await agent.run({ message: 'Now submit.', continueFrom: agent.checkpoint()! })).toBe(
      next,
    );
    expect(assessmentAtEnd(events, next, 1)).toMatchObject({ reasons: ['work-not-finished'] });
    expect(events.turnEnd[1]).not.toHaveProperty('standingLineOmittedByRaiseOn');
  });

  it.each(['builder', 'options'] as const)('both off settings through %s', async (door) => {
    for (const option of [false, { standingLine: false }] as const) {
      const setup = builder(replies, door === 'options' ? { answerLayer: option } : {}).tool(
        pendingTool,
      );
      if (door === 'builder') setup.answerLayer(option);
      const agent = setup.build();
      const events = capture(agent);
      expect(await agent.run({ message: 'Please do the work.' })).toBe(ANSWER);
      expect(JSON.stringify(agent.getSpec()).includes('"assess-answer"')).toBe(option !== false);
      if (option === false) {
        expect(events.assessed).toEqual([]);
        expect(events.turnEnd).toHaveLength(1);
        expect(events.turnEnd[0]).not.toHaveProperty('answerAssessment');
      } else {
        expect(assessmentAtEnd(events, ANSWER)).toMatchObject({
          standing: 'not-sure',
          reasons: ['work-not-finished'],
        });
      }
    }
  });

  it('builder false overrides an explicit options line and counts as the one builder call', () => {
    const setup = builder([], { answerLayer: { standingLine: true } }).answerLayer(false);
    expect(JSON.stringify(setup.build().getSpec())).not.toContain('"assess-answer"');
    expect(() => setup.answerLayer()).toThrow(/already set/);
  });
});

const JSON_ANSWER = '{"ok":true}';
const parser = {
  parse(value: unknown) {
    return value as { ok: boolean };
  },
  toJsonSchema: () => ({ type: 'object', properties: { ok: { type: 'boolean' } } }),
};
const validation = {
  id: 'fixture-check',
  version: '1',
  validate() {
    return { checks: [{ id: 'ok', disposition: 'checked-pass' as const }] };
  },
};

function typedBuilder(validated: boolean, options?: Partial<AgentOptions>) {
  const setup = builder([call('c1', 'submit'), JSON_ANSWER], options)
    .tool(pendingTool)
    .outputSchema(parser);
  if (validated) setup.answerValidation(validation);
  return setup;
}

describe('BOUNDARY — the default assessment travels beside exact output contracts', () => {
  it.each([
    { contract: '.outputSchema()', validated: false },
    { contract: '.answerValidation()', validated: true },
  ])('$contract accepts the default and keeps the JSON bytes', async ({ validated }) => {
    const agent = typedBuilder(validated).build();
    const events = capture(agent);
    expect(await agent.runTyped({ message: 'Please do the work.' })).toEqual({ ok: true });
    expect(assessmentAtEnd(events, JSON_ANSWER)).toMatchObject({
      standing: 'not-sure',
      reasons: ['work-not-finished'],
    });
  });

  it.each([
    {
      validated: false,
      message:
        '.outputSchema(): a typed answer is JSON, and JSON followed by a line of prose is not.',
    },
    {
      validated: true,
      message:
        '.answerValidation(): the answer checks judge the exact bytes delivered, and the line would change them.',
    },
  ])(
    'explicit warning text keeps the existing refusal (validation=$validated)',
    ({ validated, message }) => {
      const explicit = { standingLine: { when: 'not-sure-or-ask' } } as const;
      const refusal =
        'AgentBuilder.answerLayer({ standingLine: true }) cannot be combined with ' +
        message +
        ' Keep .answerLayer() without the line — the standing still travels as data, on ' +
        'turn_end.answerAssessment and agentfootprint.answer.assessed.';
      expect(() => typedBuilder(validated).answerLayer(explicit).build()).toThrow(
        new Error(refusal),
      );
      expect(() => typedBuilder(validated, { answerLayer: explicit }).build()).toThrow(
        new Error(refusal),
      );
    },
  );
});

describe('SCENARIO — standing follows a pause and continued conversation', () => {
  it.each([
    { mode: 'default', line: undefined, expected: withLine(ANSWER, PENDING) },
    {
      mode: 'matching filter',
      line: { when: 'not-sure-or-ask', raiseOn: ['work-not-finished'] } as const,
      expected: withLine(ANSWER, PENDING),
    },
    {
      mode: 'suppressing filter',
      line: { when: 'not-sure-or-ask', raiseOn: [] } as const,
      expected: ANSWER,
    },
  ])('keeps the same pause and assesses on resume with $mode', async ({ line, expected }) => {
    const confirmation = tool('confirm', () => askHuman({ question: 'Keep waiting?' }));
    const setup = builder([call('c1', 'submit'), call('c2', 'confirm'), ANSWER]).tools([
      pendingTool,
      confirmation,
    ]);
    const agent = (line === undefined ? setup : setup.answerLayer({ standingLine: line })).build();
    const events = capture(agent);
    const recorder = recordRun(agent);
    try {
      const paused = await agent.run({ message: 'Please do the work.' });
      if (!isPaused(paused)) throw new Error('Expected the question to pause this turn.');
      expect(events.assessed).toEqual([]);
      expect(events.turnEnd).toEqual([]);
      expect(assessAnswer(recorder.toRecording()).standing).toBe('ask');

      const checkpoint = JSON.parse(JSON.stringify(paused.checkpoint));
      expect(await agent.resume(checkpoint, 'Yes.')).toBe(expected);
      expect(events.assessed).toHaveLength(1);
      expect(assessmentAtEnd(events, expected)).toMatchObject({
        turn: 1,
        standing: 'not-sure',
        reasons: ['work-not-finished'],
      });
      if (expected === ANSWER)
        expect(events.turnEnd[0]).toHaveProperty('standingLineOmittedByRaiseOn', true);
      else expect(events.turnEnd[0]).not.toHaveProperty('standingLineOmittedByRaiseOn');
    } finally {
      recorder.stop();
    }
  });

  it('sends the delivered assistant message on the next turn and drops it with its windowed turn', async () => {
    const requests: LLMMessage[][] = [];
    const script = [...replies, 'Second answer.', 'Third answer.'];
    const agent = Agent.create({
      model: 'mock',
      keepLastToolResults: false,
      provider: mock({
        respond(request) {
          const reply = script[requests.length];
          if (reply === undefined) throw new Error('Unexpected provider request.');
          requests.push(JSON.parse(JSON.stringify(request.messages)) as LLMMessage[]);
          return reply;
        },
      }),
    })
      .tool(pendingTool)
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();
    const events = capture(agent);
    const first = withLine(ANSWER, PENDING);
    // An eviction notice must fit in the span it replaces.
    const opening = `Please do the work. Background: ${'x'.repeat(400)}`;
    expect(await agent.run({ message: opening })).toBe(first);
    expect(agent.checkpoint()?.history.at(-1)).toEqual({ role: 'assistant', content: first });

    expect(await agent.run({ message: 'Follow up.', continueFrom: agent.checkpoint()! })).toBe(
      'Second answer.',
    );
    expect(requests[2]?.slice(-2)).toEqual([
      { role: 'assistant', content: first },
      { role: 'user', content: 'Follow up.' },
    ]);

    expect(await agent.run({ message: 'Once more.', continueFrom: agent.checkpoint()! })).toBe(
      'Third answer.',
    );
    expect(requests).toHaveLength(4);
    expect(requests[3]?.map(({ content }) => content)).not.toContain(first);
    expect(requests[3]?.slice(-2)).toEqual([
      { role: 'assistant', content: 'Second answer.' },
      { role: 'user', content: 'Once more.' },
    ]);
    expect(
      events.assessed.map(({ turn, standing, reasons }) => ({ turn, standing, reasons })),
    ).toEqual([
      { turn: 1, standing: 'not-sure', reasons: ['work-not-finished'] },
      { turn: 2, standing: 'not-assessed', reasons: [] },
      { turn: 3, standing: 'not-assessed', reasons: [] },
    ]);
  });
});
