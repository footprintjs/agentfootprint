import { describe, expect, it } from 'vitest';
import { Agent, AnswerValidationError, allow } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { agentThinkingTrace } from '../../src/observe.js';

const DRAFT = 'PRIVATE_MODEL_DRAFT';
const DELIVERED = 'The host accepted this answer.';
type Recorder = ReturnType<typeof agentThinkingTrace>;
type Event = Parameters<NonNullable<Recorder['onEmit']>>[0];
const event = (
  name: string,
  payload: unknown,
  stage = 'call-llm#1',
  pipelineId = 'fixture',
): Event =>
  ({
    name,
    payload,
    runtimeStageId: stage,
    pipelineId,
    subflowPath: [],
    stageName: '',
    timestamp: 0,
  } as Event);
function emit(recorder: Recorder, value: Event): void {
  if (recorder.onEmit === undefined) throw new Error('The recorder must consume emit events.');
  recorder.onEmit(value);
}
const answers = (recorder: ReturnType<typeof agentThinkingTrace>) =>
  recorder.getTrace().steps.filter((step) => step.kind === 'answer');

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  describe(`Story answer admission — ${reactMode}`, () => {
    it('records the accepted rewritten answer only at its native delivery stage', async () => {
      const recorder = agentThinkingTrace({ agent: 'Neo' });
      let beforeVerdict: unknown;
      let deliveredAt: string | undefined;
      const agent = Agent.create({ provider: mock({ reply: DRAFT }), model: 'mock', reactMode })
        .messageMiddleware({
          name: 'host-answer',
          onMessage(message) {
            if (message.phase === 'input') return allow();
            beforeVerdict = answers(recorder);
            return allow(DELIVERED, 'The host replaced an unverified draft.');
          },
        })
        .watch(recorder)
        .build();
      agent.on('agentfootprint.agent.turn_end', (e) => {
        deliveredAt = e.meta.runtimeStageId;
      });
      expect(await agent.run({ message: 'Triage.' })).toBe(DELIVERED);
      expect(beforeVerdict).toEqual([]);
      expect(answers(recorder)).toEqual([
        expect.objectContaining({
          answer: {
            headline: DELIVERED,
            text: DELIVERED,
          },
        }),
      ]);
      const trace = recorder.getTrace();
      expect(trace.at?.[trace.steps.findIndex((step) => step.kind === 'answer')]).toBe(deliveredAt);
      expect(JSON.stringify(trace)).not.toContain(DRAFT);
    });

    it('records no delivered answer when enforcing validation refuses the governed candidate', async () => {
      const recorder = agentThinkingTrace();
      const agent = Agent.create({
        provider: mock({ reply: '{"answer":"unverified"}' }),
        model: 'mock',
        reactMode,
      })
        .messageMiddleware({ name: 'governed-answer', onMessage: () => allow() })
        .outputSchema({ parse: (value: unknown) => value })
        .answerValidation({
          id: 'required-source',
          version: '1',
          validate: () => ({
            checks: [{ id: 'source', disposition: 'unreachable' }],
          }),
        })
        .watch(recorder)
        .build();
      await expect(agent.run({ message: 'Triage.' })).rejects.toBeInstanceOf(AnswerValidationError);
      expect(answers(recorder)).toEqual([]);
    });

    for (const verdict of ['accepted', 'refused', 'observed'] as const) {
      it(`records only the canonical delivery for standalone validation — ${verdict}`, async () => {
        const recorder = agentThinkingTrace();
        const raw = JSON.stringify({ answer: 'accepted', discarded: DRAFT });
        const canonical = JSON.stringify({ answer: 'accepted' });
        let beforeVerdict: unknown;
        let deliveredAt: string | undefined;
        const llmEnds: unknown[] = [];
        const agent = Agent.create({ provider: mock({ reply: raw }), model: 'mock', reactMode })
          .outputSchema({
            parse(value: unknown) {
              if (typeof value !== 'object' || value === null || !('answer' in value)) {
                throw new Error('Expected an answer.');
              }
              return { answer: value.answer };
            },
          })
          .answerValidation({
            id: 'standalone-source',
            version: '1',
            mode: verdict === 'observed' ? 'observe' : 'enforce',
            validate(value) {
              expect(value).toEqual({ answer: 'accepted' });
              beforeVerdict = answers(recorder);
              return {
                checks: [
                  {
                    id: 'source',
                    disposition: verdict === 'accepted' ? 'checked-pass' : 'unreachable',
                  },
                ],
              };
            },
          })
          .watch(recorder)
          .build();
        agent.on('agentfootprint.stream.llm_end', (e) => llmEnds.push(e.payload));
        agent.on('agentfootprint.agent.turn_end', (e) => {
          deliveredAt = e.meta.runtimeStageId;
        });

        if (verdict === 'refused') {
          await expect(agent.run({ message: 'Triage.' })).rejects.toBeInstanceOf(
            AnswerValidationError,
          );
          expect(answers(recorder)).toEqual([]);
        } else {
          expect(await agent.run({ message: 'Triage.' })).toBe(canonical);
          expect(answers(recorder)).toEqual([
            expect.objectContaining({ answer: { headline: canonical, text: canonical } }),
          ]);
          const trace = recorder.getTrace();
          expect(trace.at?.[trace.steps.findIndex((step) => step.kind === 'answer')]).toBe(
            deliveredAt,
          );
        }
        expect(beforeVerdict).toEqual([]);
        expect(llmEnds).toEqual([expect.objectContaining({ content: '', contentWithheld: true })]);
        expect(JSON.stringify(recorder.getTrace())).not.toContain(DRAFT);
      });
    }

    it('preserves the ungoverned answer and its original llm-end stage', async () => {
      const recorder = agentThinkingTrace();
      let llmAt: string | undefined;
      const agent = Agent.create({ provider: mock({ reply: DELIVERED }), model: 'mock', reactMode })
        .watch(recorder)
        .build();
      agent.on('agentfootprint.stream.llm_end', (e) => {
        llmAt = e.meta.runtimeStageId;
      });
      expect(await agent.run({ message: 'Triage.' })).toBe(DELIVERED);
      expect(answers(recorder)).toHaveLength(1);
      const trace = recorder.getTrace();
      expect(trace.at?.[trace.steps.findIndex((step) => step.kind === 'answer')]).toBe(llmAt);
      expect(answers(recorder)[0]).toMatchObject({ answer: { text: DELIVERED } });
    });
  });
}

describe('Story pending answer metadata', () => {
  it('retains cost, tools and reasoning without retaining or prematurely recording withheld text', () => {
    const recorder = agentThinkingTrace({ asker: 'oncall' });
    emit(
      recorder,
      event('agentfootprint.stream.llm_start', {
        tools: [{ name: 'lookup', description: 'Read' }],
      }),
    );
    emit(
      recorder,
      event('agentfootprint.stream.llm_end', {
        content: DRAFT,
        contentWithheld: true,
        toolCallCount: 0,
        usage: { input: 2, output: 3, cacheRead: 1 },
        durationMs: 17,
      }),
    );
    emit(
      recorder,
      event('agentfootprint.stream.thinking_end', { blocks: [{ content: 'Source reasoning.' }] }),
    );
    expect(answers(recorder)).toEqual([]);
    expect(JSON.stringify(recorder.getTrace())).not.toContain(DRAFT);
    emit(recorder, event('agentfootprint.agent.turn_end', { finalContent: DELIVERED }, 'final#2'));
    expect(answers(recorder)).toEqual([
      expect.objectContaining({
        to: 'oncall',
        answer: { headline: DELIVERED, text: DELIVERED },
        cost: { ms: 17, tokens: 5, tokensIn: 2, tokensOut: 3, tokensCached: 1 },
        toolsSeen: [{ name: 'lookup', description: 'Read' }],
        thinking: 'Source reasoning.',
      }),
    ]);
    expect(recorder.getTrace().at?.at(-1)).toBe('final#2');
    emit(recorder, event('agentfootprint.agent.turn_end', { finalContent: DELIVERED }, 'final#3'));
    expect(answers(recorder)).toHaveLength(1);
  });

  it.each([
    { finalContent: DRAFT, refused: 'answer-validation' },
    { finalContent: undefined },
    { finalContent: 7 },
  ])('a refused or unavailable delivery consumes pending metadata without an answer', (payload) => {
    const recorder = agentThinkingTrace();
    emit(
      recorder,
      event('agentfootprint.stream.llm_end', {
        content: DRAFT,
        contentWithheld: true,
        toolCallCount: 0,
      }),
    );
    emit(recorder, event('agentfootprint.agent.turn_end', payload, 'final#2'));
    emit(recorder, event('agentfootprint.agent.turn_end', { finalContent: DELIVERED }, 'final#3'));
    expect(answers(recorder)).toEqual([]);
  });

  it.each(['next-call', 'next-pipeline', 'clear'] as const)(
    'does not carry pending metadata past %s',
    (reset) => {
      const recorder = agentThinkingTrace();
      emit(
        recorder,
        event('agentfootprint.stream.llm_end', {
          content: DRAFT,
          contentWithheld: true,
          toolCallCount: 0,
        }),
      );
      if (reset === 'next-call') emit(recorder, event('agentfootprint.stream.llm_start', {}));
      if (reset === 'clear') recorder.clear();
      emit(
        recorder,
        event(
          'agentfootprint.agent.turn_end',
          { finalContent: DELIVERED },
          'final#2',
          reset === 'next-pipeline' ? 'other' : 'fixture',
        ),
      );
      expect(answers(recorder)).toEqual([]);
    },
  );
});
