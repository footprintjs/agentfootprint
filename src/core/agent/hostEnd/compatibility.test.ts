import { expect, it, vi } from 'vitest';
import { Agent } from '../../../index.js';
import { mock } from '../../../llm-providers.js';

// Native subflow addresses from an ordinary one-response run before host-ended turns.
const flat = [
  'sf-injection-engine#1',
  'sf-messages#9',
  'sf-system-prompt#7',
  'sf-tools#11',
  'sf-cache#14',
  'sf-thinking#19',
  'final#22',
];
const grouped = [
  'sf-llm-call/sf-injection-engine#3',
  'sf-llm-call/sf-messages#11',
  'sf-llm-call/sf-system-prompt#9',
  'sf-llm-call/sf-tools#13',
  'sf-llm-call/sf-cache#16',
  'sf-llm-call/sf-thinking#21',
  'sf-llm-call#1',
  'final#24',
];

for (const reactMode of ['classic', 'dynamic', 'dynamic-grouped'] as const) {
  for (const commitValues of ['full', 'delta'] as const) {
    it.each([{}, { hostEndedTurns: false }])(
      `preserves ordinary ${reactMode}/${commitValues} saved rows and checkpoint bytes with %j`,
      async (options) => {
        const agent = Agent.create({
          model: 'mock',
          provider: mock({ reply: 'same' }),
          reactMode,
          commitValues,
          ...options,
        }).build();
        await agent.run('one');
        const snapshot = agent.getLastSnapshot()!;
        expect(Object.keys(snapshot.subflowResults ?? {}).filter((id) => id.includes('#'))).toEqual(
          reactMode === 'dynamic-grouped' ? grouped : flat,
        );
        const record = JSON.stringify(snapshot);
        expect(record).not.toMatch(/"modelReplyRunId"|"replyOrigin"|"hostEndReason"/);
        const checkpoint = agent.checkpoint()!;
        // The native run supplies its identity and the clock supplies the read time.
        expect(JSON.stringify(checkpoint)).toBe(
          JSON.stringify({
            version: 1,
            runId: snapshot.runId,
            history: [
              { role: 'user', content: 'one' },
              { role: 'assistant', content: 'same' },
            ],
            lastCompletedIteration: 1,
            originalInput: { message: 'one' },
            checkpointedAt: checkpoint.checkpointedAt,
            turnNumber: 1,
          }),
        );
      },
    );
  }
}

it('refuses a disabled host turn before admission, decision access or effects', async () => {
  const respond = vi.fn(() => 'same');
  const readCandidate = vi.fn(() => 'candidate');
  const wrapper = vi.fn();
  const agent = Agent.create({ model: 'mock', provider: mock({ respond }) })
    .aroundTurn({
      name: 'probe',
      around(turn, proceed) {
        wrapper(turn);
        return proceed();
      },
    })
    .build();
  await agent.run('one');
  const before = agent.getLastSnapshot()!.runId;
  respond.mockClear();
  wrapper.mockClear();
  await expect(
    agent.endTurn(
      {
        get reply() {
          return readCandidate();
        },
        reason: 'host-cap',
      },
      { message: 'two' },
    ),
  ).rejects.toThrow(/hostEndedTurns/);
  expect(agent.getLastSnapshot()!.runId).toBe(before);
  expect(readCandidate).not.toHaveBeenCalled();
  expect(wrapper).not.toHaveBeenCalled();
  expect(respond).not.toHaveBeenCalled();
});

it('strips imported origin from a default agent’s requests while retaining the original saved attribution', async () => {
  const first = Agent.create({
    model: 'mock',
    provider: mock({ reply: 'same' }),
    hostEndedTurns: true,
  }).build();
  await first.endTurn({ reply: 'same', reason: 'host-cap' });
  const saved = JSON.parse(JSON.stringify(first.checkpoint()));
  const requests: string[] = [];
  const next = Agent.create({
    model: 'mock',
    provider: mock({
      respond(request) {
        requests.push(JSON.stringify(request.messages));
        return 'same';
      },
    }),
  }).build();
  await next.run({ message: 'next', continueFrom: saved });
  expect(requests).toHaveLength(1);
  expect(requests[0]).not.toContain('replyOrigin');
  expect(next.checkpoint()!.history).toEqual([
    { role: 'assistant', content: 'same', replyOrigin: { kind: 'host', runId: saved.runId } },
    { role: 'user', content: 'next' },
    { role: 'assistant', content: 'same' },
  ]);
});

it('rejects non-boolean configuration before the first turn', () => {
  expect(() =>
    Agent.create({
      model: 'mock',
      provider: mock({ reply: 'same' }),
      hostEndedTurns: 'false' as never,
    }).build(),
  ).toThrow(/hostEndedTurns must be a boolean/);
});
