import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  epochLocations,
  keyedFold,
  type ReactMode,
} from '../../../../src/index.js';
import { RECEIPT_KEY } from '../../../../src/lib/conventions.js';
import { mock } from '../../../../src/llm-providers.js';
import { recordRun } from '../../../../src/observe.js';
import { requestAttempt } from '../../../../src/provider-contract/requestObserver.js';
import type { LLMRequest } from '../../../../src/provider-contract/types.js';
import type { ServedRow } from '../../../../src/core/agent/receipt/servedRow.js';

const key = 'sourceLinkServedRows';

async function record(mode: ReactMode, rewriteLastRequest = false, recordReceipt = true) {
  const fixture = mock({
    replies: [
      { toolCalls: [{ id: 'fixture-1', name: 'sample_label', args: {} }] },
      { content: 'The label was recorded.' },
    ],
  });
  const requests: LLMRequest[] = [];
  const agent = Agent.create({
    provider: {
      name: fixture.name,
      complete(request, hooks) {
        const rewriting = rewriteLastRequest && requests.length > 0;
        const sent = rewriting ? { ...request, messages: [...request.messages] } : request;
        const attempt = requestAttempt(hooks, sent);
        requests.push(sent);
        try {
          return fixture.complete(sent);
        } finally {
          attempt.close();
        }
      },
    },
    model: 'mock',
    reactMode: mode,
    recordReceipt,
  })
    .tool(
      defineTool({
        name: 'sample_label',
        description: 'Read the sample label.',
        inputSchema: { type: 'object' },
        execute: () => 'blue',
      }),
    )
    .build();
  const recorder = recordRun(agent);
  try {
    await agent.run('Read the sample label.');
    return { recording: recorder.toRecording(), requests };
  } finally {
    recorder.stop();
  }
}

function servedCommits(epochs: ReturnType<typeof epochLocations>) {
  const logs = [...new Set(epochs.flatMap(({ runLog, log }) => [runLog, log]))];
  return logs.flatMap((log) =>
    log.filter((bundle) => bundle.trace.some(({ path }) => path === key)),
  );
}

describe('the served history row', () => {
  it.each([
    { mode: 'classic', logs: 1, verbs: ['set', 'append'] },
    { mode: 'dynamic', logs: 1, verbs: ['set', 'append'] },
    { mode: 'dynamic-grouped', logs: 2, verbs: ['set', 'set'] },
  ] as const)(
    'writes one row in each actual call execution and keeps provider messages unchanged ($mode)',
    async ({ mode, logs, verbs }) => {
      const { recording, requests } = await record(mode);
      const consumers = recording.events
        .filter((event) => event.type === 'agentfootprint.stream.llm_start')
        .map((event) => event.meta.runtimeStageId);
      const epochs = epochLocations(recording.snapshot);
      expect(epochs).toHaveLength(2);
      expect(epochs.map(({ callRuntimeStageId }) => callRuntimeStageId)).toEqual(consumers);
      expect(new Set(epochs.map(({ log }) => log)).size).toBe(logs);
      expect(servedCommits(epochs)).toEqual(epochs.map(({ log, callIdx }) => log[callIdx]));
      for (const [index, epoch] of epochs.entries()) {
        const { log, callIdx, callRuntimeStageId, runLog, source } = epoch;
        if (mode === 'dynamic-grouped') expect(log).not.toBe(runLog);
        expect(callIdx).toBe(
          log.findIndex((bundle) => bundle.runtimeStageId === callRuntimeStageId),
        );
        const { trace } = log[callIdx]!;
        expect(trace.filter(({ path }) => path === key).map(({ verb }) => verb)).toEqual([
          verbs[index],
        ]);
        expect(trace.some(({ path }) => path === RECEIPT_KEY)).toBe(true);

        const fold = keyedFold(source);
        const before = (fold.valueAt(key, callIdx - 1) as readonly ServedRow[] | undefined) ?? [];
        const after = fold.valueAt(key, callIdx);
        expect(after).toEqual([
          ...before,
          {
            kind: 'served',
            version: 1,
            consumer: consumers[index],
            served: [{ key: 'history', elements: [[0, requests[index]!.messages.length]] }],
          },
        ]);
      }
      expect(requests[1]?.messages.at(-1)?.content).toBe('blue');
      expect(JSON.stringify(requests)).not.toContain(key);
    },
  );

  it('keeps the earlier row when a provider wrapper replaces the next request', async () => {
    const { recording } = await record('classic', true);
    const epochs = epochLocations(recording.snapshot);
    expect(epochs).toHaveLength(2);
    expect(servedCommits(epochs)).toEqual([epochs[0]!.log[epochs[0]!.callIdx]]);
  });

  it('keeps the receipt opt-out at the recording boundary', async () => {
    const { recording } = await record('classic', false, false);
    const epochs = epochLocations(recording.snapshot);
    expect(epochs).toHaveLength(2);
    expect(servedCommits(epochs)).toEqual([]);
  });
});
