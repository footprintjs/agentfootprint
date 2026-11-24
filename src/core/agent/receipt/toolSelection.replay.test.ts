import { expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  epochLocations,
  isPaused,
  pauseHere,
  receiptAt,
  RunCheckpointError,
  servedAt,
} from '../../../index.js';
import { mock } from '../../../adapters/llm/MockProvider.js';
import { mockClassifier } from '../../../classify/mock.js';
import { defineSkill } from '../../../injection-engine.js';
import { type Recording, recordRun } from '../../../recorders/observability/recordRun.js';
import type { AgentOptions } from '../types.js';

function selectionAgent(
  provider: AgentOptions['provider'],
  options: Partial<AgentOptions> = {},
  fixture: { hiddenSkill?: boolean; pauseOnChosen?: boolean } = {},
) {
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
      execute: () =>
        name === 'chosen' && fixture.pauseOnChosen ? pauseHere({ question: 'Continue?' }) : 'ok',
    });
  const builder = Agent.create({ ...options, provider, model: 'mock' })
    .tool(tool('chosen'))
    .tool(tool('monitor'))
    .toolChoice({ classifier, serve: { top: 1 } });
  if (fixture.hiddenSkill) {
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
  return builder.build();
}

async function record(options: Partial<AgentOptions>, missingWire = false, hiddenSkill = false) {
  const base = mock({
    replies: [
      { toolCalls: [{ id: 'lookup-1', name: 'chosen', args: {} }] },
      { content: 'finished' },
    ],
  });
  let step = 0;
  const agent = selectionAgent(
    {
      name: 'fixture',
      async complete(request) {
        const response = await base.complete(request);
        return ++step === 2 || missingWire ? { ...response, wireManifest: undefined } : response;
      },
    },
    options,
    { hiddenSkill },
  );
  const recorder = recordRun(agent);
  try {
    expect(await agent.run({ message: 'Check.' })).toBe('finished');
    return JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
  } finally {
    recorder.stop();
    await agent.shutdown();
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

function finishingProvider(offers: string[][]) {
  return mock({
    respond: (request) => {
      offers.push((request.tools ?? []).map((tool) => tool.name));
      return 'Finished.';
    },
  });
}

function lastCallReceipt(snapshot: unknown) {
  const at = epochLocations(snapshot).at(-1);
  if (!at) throw new Error('Expected the new model call in replay.');
  const receipt = receiptAt(snapshot, at.epoch);
  expect(receipt?.basis.epoch).toBe(at.epoch);
  return { at, receipt };
}

it.each(['resume', 'new question'] as const)(
  'replays the selection evidence for a %s from a saved crash checkpoint',
  async (continuation) => {
    let calls = 0;
    const first = selectionAgent(
      mock({
        respond: () => {
          if (++calls === 1) return { toolCalls: [{ id: 'first', name: 'chosen', args: {} }] };
          throw new Error('Provider lost the second request.');
        },
      }),
    );
    const offers: string[][] = [];
    const next = selectionAgent(finishingProvider(offers));
    const recorder = recordRun(next);
    try {
      const failure: unknown = await first.run({ message: 'Check.' }).catch((error) => error);
      if (!(failure instanceof RunCheckpointError)) throw new Error('Expected a crash checkpoint.');
      expect(calls).toBe(2);
      const saved = JSON.parse(JSON.stringify(failure.checkpoint)) as typeof failure.checkpoint;
      const answer =
        continuation === 'resume'
          ? await next.resumeOnError(saved)
          : await next.run({ message: 'Check again.', continueFrom: saved });
      expect(answer).toBe('Finished.');
      expect(offers).toEqual([['chosen']]);
      const { snapshot } = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
      const { at, receipt } = lastCallReceipt(snapshot);
      // A new user turn gets its own allowance. The saved checkpoint cannot
      // attest how many omission rows the interrupted turn already consumed.
      if (continuation === 'resume') {
        expect(receipt).not.toHaveProperty('toolSelection');
      } else {
        expect(receipt?.toolSelection).toEqual({
          consumer: { series: at.callRuntimeStageId, attempt: 1 },
          absent: [{ name: 'monitor', reason: 'top-N' }],
        });
      }
    } finally {
      recorder.stop();
      await first.shutdown();
      await next.shutdown();
    }
  },
);

it('does not borrow an unrelated turn’s omission allowance after an in-tool pause', async () => {
  const first = selectionAgent(
    mock({ replies: [{ toolCalls: [{ id: 'pause', name: 'chosen', args: {} }] }] }),
    {},
    { pauseOnChosen: true },
  );
  const offers: string[][] = [];
  const next = selectionAgent(finishingProvider(offers), {}, { pauseOnChosen: true });
  try {
    const paused = await first.run({ message: 'Ask before continuing.' });
    if (!isPaused(paused)) throw new Error('Expected a tool pause.');
    const saved = JSON.parse(JSON.stringify(paused.checkpoint)) as typeof paused.checkpoint;
    await expect(next.run({ message: 'An unrelated question.' })).resolves.toBe('Finished.');
    expect(receiptAt(next.getLastSnapshot(), 1)?.toolSelection?.absent).toEqual([
      { name: 'monitor', reason: 'top-N' },
    ]);
    await expect(next.resume(saved, 'Continue.')).resolves.toBe('Finished.');
    expect(offers).toEqual([['chosen'], ['chosen']]);
    const { receipt } = lastCallReceipt(next.getLastSnapshot());
    expect(receipt).not.toHaveProperty('toolSelection');
  } finally {
    await first.shutdown();
    await next.shutdown();
  }
});
