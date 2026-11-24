import { expect, it } from 'vitest';
import { Agent, defineTool, epochLocations, receiptAt, servedAt } from '../../../index.js';
import { mock } from '../../../adapters/llm/MockProvider.js';
import { mockClassifier } from '../../../classify/mock.js';
import { defineSkill } from '../../../injection-engine.js';
import { type Recording, recordRun } from '../../../recorders/observability/recordRun.js';
import type { AgentOptions } from '../types.js';

async function record(options: Partial<AgentOptions>, missingWire = false, hiddenSkill = false) {
  const base = mock({
    replies: [
      { toolCalls: [{ id: 'lookup-1', name: 'chosen', args: {} }] },
      { content: 'finished' },
    ],
  });
  let step = 0;
  const classifier = mockClassifier(() => ({
    model: 'fixture',
    latencyMs: 1,
    usage: { inputTokens: 1, outputTokens: 1 },
    answers: {
      tool: { type: 'choice', choice: 'chosen', confidence: 1, probabilities: { chosen: 1 } },
    },
  }));
  const tool = (name: string) =>
    defineTool({
      name,
      description: 'private schema wording',
      inputSchema: { type: 'object', properties: {} },
      execute: () => 'ok',
    });
  const builder = Agent.create({
    provider: {
      name: 'fixture',
      async complete(request) {
        const response = await base.complete(request);
        return ++step === 2 || missingWire ? { ...response, wireManifest: undefined } : response;
      },
    },
    model: 'mock',
    ...options,
  })
    .tool(tool('chosen'))
    .tool(tool('monitor'))
    .toolChoice({ classifier, serve: { top: 1 } });
  if (hiddenSkill) {
    builder.skill(
      defineSkill({
        id: 'restricted',
        description: 'Restricted service',
        body: 'Restricted service',
        tools: [tool('restricted_lookup')],
        autoActivate: 'currentSkill',
      }),
    );
  }
  const agent = builder.build();
  const recorder = recordRun(agent);
  try {
    expect(await agent.run({ message: 'Check.' })).toBe('finished');
    return JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  } finally {
    recorder.stop();
  }
}

it.each(['delta', 'full'] as const)(
  'replays only the visible omissions on their own accepted request (%s)',
  async (commitValues) => {
    const recording = await record({ commitValues });
    const [first, second] = epochLocations(recording.snapshot);
    if (!first || !second) throw new Error('Expected two recorded model calls');
    expect(receiptAt(recording.snapshot, 1)?.toolSelection).toEqual({
      consumer: { series: first.callRuntimeStageId, attempt: 1 },
      absent: [{ name: 'monitor', reason: 'top-N' }],
    });
    expect(receiptAt(recording.snapshot, 2)).not.toHaveProperty('toolSelection');
  },
);

it('keeps missing wire evidence, redacted catalogs and receipt-disabled calls out of replay', async () => {
  for (const [options, missingWire] of [
    [{}, true],
    [{ redact: { keys: ['dynamicToolSchemas'] } }, false],
    [{ recordReceipt: false }, false],
  ] satisfies [Partial<AgentOptions>, boolean][]) {
    const recording = await record(options, missingWire);
    expect(receiptAt(recording.snapshot, 1)?.toolSelection).toBeUndefined();
    expect(JSON.stringify(recording.snapshot)).not.toContain('"toolSelection"');
  }
});

it('names lost selection evidence when the whole receipt is missing', async () => {
  const saved = await record({});
  expect(receiptAt(saved.snapshot, 1)?.toolSelection?.absent).toEqual([
    { name: 'monitor', reason: 'top-N' },
  ]);
  const disabled = await record({ recordReceipt: false });
  expect(receiptAt(disabled.snapshot, 1)).toBeUndefined();
  const gap = servedAt(disabled.snapshot, 1)?.gaps.find((row) => row.gap === 'no-receipt-on-chart');
  expect(gap?.fields).toContain('toolSelection');
});

it('keeps a hidden skill and an unregistered skill indistinguishable in the saved selection', async () => {
  const options: Partial<AgentOptions> = {
    permissionChecker: {
      name: 'test visibility',
      governs: ['skill_read'],
      check: ({ target }) =>
        target === 'skill:restricted'
          ? { result: 'deny', rationale: 'restricted' }
          : { result: 'allow' },
    },
  };
  for (const registered of [false, true]) {
    const recording = await record(options, false, registered);
    const selection = receiptAt(recording.snapshot, 1)?.toolSelection;
    expect(selection?.absent).toEqual([{ name: 'monitor', reason: 'top-N' }]);
    expect(selection).not.toHaveProperty('bounded');
    expect(receiptAt(recording.snapshot, 2)).not.toHaveProperty('toolSelection');
  }
});
