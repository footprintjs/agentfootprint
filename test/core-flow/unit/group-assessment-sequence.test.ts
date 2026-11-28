import { describe, expect, it, vi } from 'vitest';
import { flowChart, type RedactionPolicy } from 'footprintjs';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';
import { Sequence } from '../../../src/core-flow/Sequence.js';
import { Agent } from '../../../src/core/Agent.js';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { isPaused, pauseHere } from '../../../src/core/pause.js';
import { recordRun } from '../../../src/recorders/observability/recordRun.js';
import { absent } from '../../../src/semantics/coverage/absent.js';
import { defineTool } from '../../../src/tools/tools.js';

const answer = '{"answerAssessment":{"standing":"ask"}}';

function memberWithMissingEvidence(redact?: RedactionPolicy) {
  return Agent.create({
    provider: new MockProvider({
      replies: [{ toolCalls: [{ id: 'lookup-1', name: 'lookup', args: {} }] }, answer],
    }),
    model: 'mock',
    ...(redact && { redact }),
  })
    .tool(
      defineTool({
        name: 'lookup',
        description: 'Find the attached source',
        inputSchema: { type: 'object', properties: {} },
        execute: () => absent({ what: 'the attached source', checked: ['attachments'] }),
      }),
    )
    .answerLayer({ standingLine: false })
    .build();
}

describe('opt-in Sequence group assessment', () => {
  it('publishes the authorized member standing with no witness data and keeps the answer bytes', async () => {
    const sequence = Sequence.create({ groupAssessment: true })
      .step('check-source', memberWithMissingEvidence())
      .build();
    const recording = recordRun(sequence);
    const received: unknown[] = [];
    const off = sequence.on('agentfootprint.composition.exit', ({ payload }) =>
      received.push(payload.groupAssessment),
    );
    try {
      expect(await sequence.run({ message: 'Check the attachment.' })).toBe(answer);
      const assessment = { standing: 'not-sure', coverage: 'complete' };
      expect(received).toEqual([assessment]);
      const terminal = recording
        .toRecording()
        .events.find((event) => event.type === 'agentfootprint.composition.exit');
      expect(terminal?.payload).toMatchObject({ groupAssessment: assessment });
    } finally {
      off();
      recording.stop();
    }
  });

  it('does not treat an answer field as a member assessment', async () => {
    const member = LLMCall.create({
      provider: new MockProvider({ reply: answer }),
      model: 'mock',
    }).build();
    const sequence = Sequence.create({ groupAssessment: true }).step('reply', member).build();
    const received: unknown[] = [];
    const off = sequence.on('agentfootprint.composition.exit', ({ payload }) =>
      received.push(payload.groupAssessment),
    );
    try {
      expect(await sequence.run({ message: 'Reply.' })).toBe(answer);
      expect(received).toEqual([{ standing: 'not-assessed', coverage: 'incomplete' }]);
    } finally {
      off();
    }
  });

  it('requires the native terminal authority even when a chart supplies matching field names', async () => {
    const candidate = { standing: 'known' };
    const chart = flowChart(
      'Supposed assessment',
      (scope) => scope.$setValue('answerAssessment', candidate),
      'assess-answer',
    )
      .addFunction(
        'Supposed terminal',
        (scope) => scope.$emit('agentfootprint.agent.turn_end', { answerAssessment: candidate }),
        'prepare-final',
      )
      .build();
    const shell = flowChart('Member', () => undefined, 'seed')
      .addSubFlowChartNext('final', chart, 'Final')
      .addFunction('Return', () => answer, 'return')
      .build();
    const member = LLMCall.create({
      provider: new MockProvider({ reply: answer }),
      model: 'mock',
    }).build();
    const spec = vi.spyOn(member, 'getSpec').mockReturnValue(shell);
    const sequence = Sequence.create({ groupAssessment: true }).step('reply', member).build();
    const received: unknown[] = [];
    const off = sequence.on('agentfootprint.composition.exit', ({ payload }) =>
      received.push(payload.groupAssessment),
    );
    try {
      expect(await sequence.run({ message: 'Reply.' })).toBe(answer);
      expect(received).toEqual([{ standing: 'not-assessed', coverage: 'incomplete' }]);
    } finally {
      off();
      spec.mockRestore();
    }
  });

  it('leaves coverage incomplete when policy withholds the assessment history', async () => {
    const sequence = Sequence.create({ groupAssessment: true })
      .step('check-source', memberWithMissingEvidence({ keys: ['answerAssessment'] }))
      .build();
    const received: unknown[] = [];
    const off = sequence.on('agentfootprint.composition.exit', ({ payload }) =>
      received.push(payload.groupAssessment),
    );
    try {
      expect(await sequence.run({ message: 'Check the attachment.' })).toBe(answer);
      expect(received).toEqual([{ standing: 'not-assessed', coverage: 'incomplete' }]);
    } finally {
      off();
    }
  });

  it('releases the fresh result while leaving prior member coverage incomplete', async () => {
    const gate = Agent.create({
      provider: new MockProvider({
        replies: [
          { toolCalls: [{ id: 'review-1', name: 'review', args: {} }] },
          'The review is complete.',
        ],
      }),
      model: 'mock',
    })
      .tool(
        defineTool({
          name: 'review',
          description: 'Ask for review',
          inputSchema: { type: 'object', properties: {} },
          execute: () => pauseHere({ question: 'Continue?' }),
        }),
      )
      .answerLayer({ standingLine: false })
      .build();
    const sequence = Sequence.create({ groupAssessment: true })
      .step('check-source', memberWithMissingEvidence())
      .step('review', gate)
      .build();

    const received: unknown[] = [];
    const off = sequence.on('agentfootprint.composition.exit', ({ payload }) =>
      received.push(payload.groupAssessment),
    );
    try {
      const paused = await sequence.run({ message: 'Check the attachment.' });
      if (!isPaused(paused)) throw new Error('The review should pause');
      expect(received).toEqual([]);

      const restored = JSON.parse(JSON.stringify(paused.checkpoint));
      expect(await sequence.resume(restored, true)).toBe('The review is complete.');
      expect(received).toEqual([{ standing: 'not-assessed', coverage: 'incomplete' }]);
    } finally {
      off();
    }
  });

  it('omits the optional field by default', async () => {
    const sequence = Sequence.create().step('check-source', memberWithMissingEvidence()).build();
    const received: object[] = [];
    const off = sequence.on('agentfootprint.composition.exit', ({ payload }) =>
      received.push(payload),
    );
    try {
      expect(await sequence.run({ message: 'Check the attachment.' })).toBe(answer);
      expect(received).toHaveLength(1);
      expect(received[0]).not.toHaveProperty('groupAssessment');
    } finally {
      off();
    }
  });
});
