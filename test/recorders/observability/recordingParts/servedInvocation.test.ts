import { expect, it, vi } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  readInvocationModelInput,
  type RecordedModelCall,
  isPaused,
  pauseHere,
} from '../../../../src/index.js';
import { conversationRedaction } from '../../../../src/doors/security.js';
import { Sequence } from '../../../../src/core-flow/Sequence.js';
import { openSavedRecording, recordRun } from '../../../../src/observe.js';
import type { LLMRequest } from '../../../../src/provider-contract/types.js';
import {
  epochLocations,
  readAfterCall,
  receiptHash,
  RECEIPT_KEY,
  servedAt,
  type EpochLocation,
} from '../../../../src/time-travel/index.js';
import { counted, fileParts, fileWhole } from './helpers.js';

const PRIVATE = 'NL1-PRIVATE-SYNTHETIC-MESSAGE';

async function childRecording(
  options: {
    redact?: boolean;
    recordReceipt?: boolean;
    reactMode?: 'dynamic' | 'dynamic-grouped';
  } = {},
) {
  const requests: LLMRequest[] = [];
  const child = (label: string) =>
    Agent.create({
      reactMode: options.reactMode ?? 'dynamic-grouped',
      model: 'mock',
      ...(options.recordReceipt === false && { recordReceipt: false }),
      ...(options.redact && { redact: conversationRedaction() }),
      provider: {
        name: 'mock',
        complete: async (request) => {
          requests.push(structuredClone(request));
          return {
            content: 'mock result',
            toolCalls: [],
            usage: { input: 1, output: 1 },
            stopReason: 'stop',
          };
        },
      },
    })
      .system(label)
      .build();
  const flow = Sequence.create()
    .step('first', child('first recorded child'))
    .step('second', child('second recorded child'))
    .build();
  const recorder = recordRun(flow);
  try {
    await flow.run({ message: options.redact ? PRIVATE : 'synthetic input' });
    return { recording: recorder.toRecording(), requests };
  } finally {
    recorder.stop();
    await flow.shutdown();
  }
}

function addressFor(
  recording: ReturnType<ReturnType<typeof recordRun>['toRecording']>,
  saved: Extract<Awaited<ReturnType<typeof openSavedRecording>>, { status: 'ready' }>,
  epoch: EpochLocation,
): RecordedModelCall {
  const group = saved.invocations.find((invocation) => invocation.key === epoch.subflowScope);
  const event = recording.events.find(
    (event) =>
      event.type === 'agentfootprint.stream.llm_start' &&
      event.meta.runtimeStageId === epoch.callRuntimeStageId,
  );
  if (!event?.meta.sourcePosition || !group || !saved.snapshotRunId)
    throw new Error('Missing fixture call position');
  return {
    invocationPath: group.path,
    engineRunId: saved.snapshotRunId,
    logRunId: event.meta.sourcePosition.logRunId,
    runtimeStageId: epoch.callRuntimeStageId,
    commitIdx: epoch.callIdx,
  };
}

it.each(['whole', 'parts'] as const)('serves the exact recorded child from %s', async (layout) => {
  const { recording, requests } = await childRecording();
  const store = inMemoryArtifacts();
  const filed =
    layout === 'parts' ? await fileParts(store, recording, { targetBytes: 4_096 }) : undefined;
  const ref = filed?.index ?? (await fileWhole(store, recording));
  const source = counted(store);
  const saved = await openSavedRecording(source.artifacts, ref);
  if (saved.status !== 'ready' || !saved.snapshotRunId)
    throw new Error('Missing fixture recording');
  expect(saved.complete).toBe(true);
  const readInvocation = vi.fn(saved.readInvocation);
  const scoped = { ...saved, readInvocation };
  const epochs = epochLocations(recording.snapshot);
  expect(epochs.map((epoch) => epoch.epoch)).toEqual([1, 1]);
  expect(epochs[0]?.callIdx).toBe(epochs[1]?.callIdx);
  expect(requests).toHaveLength(2);
  for (const [index, epoch] of epochs.entries()) {
    const address = addressFor(recording, saved, epoch);
    const group = saved.invocations.find((invocation) => invocation.key === epoch.subflowScope)!;
    readInvocation.mockClear();
    source.calls.get.length = 0;
    const result = await readInvocationModelInput(scoped, address);
    if (result.status !== 'ready' || !result.receipt) throw new Error(JSON.stringify(result));
    expect(result.view.system.text).toBe(requests[index]?.systemPrompt);
    expect(result.view.messages.asSent).toEqual(requests[index]?.messages);
    expect(result.receipt).toEqual(readAfterCall(epoch, RECEIPT_KEY));
    expect(receiptHash(result.receipt.basis.runId, result.view.system.text)).toBe(
      result.receipt.system.hash,
    );
    expect(readInvocation.mock.calls.map(([key]) => key)).toEqual([group.key, group.path.at(-2)]);
    if (filed) {
      const indexRows = JSON.parse(filed.indexText) as {
        invocations: { key: string; part: number }[];
      };
      const selected = new Set(readInvocation.mock.calls.map(([key]) => key));
      const allowed = new Set([
        filed.base,
        ...indexRows.invocations
          .filter((row) => selected.has(row.key))
          .map((row) => filed.parts[row.part]),
      ]);
      expect(source.calls.get.every((ref) => allowed.has(ref))).toBe(true);
      expect(source.calls.get.length).toBeGreaterThan(0);
    }

    await expect(
      readInvocationModelInput(scoped, { ...address, commitIdx: address.commitIdx - 1 }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not-model-call' });
    await expect(
      readInvocationModelInput(scoped, { ...address, runtimeStageId: 'foreign/call-llm#1' }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'not-model-call' });

    readInvocation.mockClear();
    await expect(
      readInvocationModelInput(scoped, { ...address, engineRunId: 'other-run' }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'address-mismatch' });
    await expect(
      readInvocationModelInput(scoped, { ...address, logRunId: 'other-log' }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'address-mismatch' });
    await expect(
      readInvocationModelInput(scoped, { ...address, invocationPath: ['other#1', group.key] }),
    ).resolves.toEqual({ status: 'unavailable', reason: 'address-mismatch' });
    expect(readInvocation).not.toHaveBeenCalled();
  }
  const foreign = addressFor(recording, saved, epochs[1]!);
  const first = addressFor(recording, saved, epochs[0]!);
  await expect(
    readInvocationModelInput(scoped, { ...first, invocationPath: foreign.invocationPath }),
  ).resolves.toEqual({ status: 'unavailable', reason: 'not-model-call' });

  const substitute = {
    ...saved,
    readInvocation: () => saved.readInvocation(foreign.invocationPath.at(-1)!),
  };
  await expect(readInvocationModelInput(substitute, first)).resolves.toEqual({
    status: 'unavailable',
    reason: 'address-mismatch',
  });
  expect(servedAt(recording.snapshot, 1)?.system.text).toBe(requests[0]?.systemPrompt);
});

it('keeps an exact but unverified view when the child recorded no receipt', async () => {
  const { recording, requests } = await childRecording({ recordReceipt: false });
  const store = inMemoryArtifacts();
  const saved = await openSavedRecording(
    counted(store).artifacts,
    await fileWhole(store, recording),
  );
  if (saved.status !== 'ready') throw new Error('Missing fixture recording');
  const place = epochLocations(recording.snapshot)[1]!;
  const result = await readInvocationModelInput(saved, addressFor(recording, saved, place));
  if (result.status !== 'ready') throw new Error(JSON.stringify(result));
  expect(result.view.system.text).toBe(requests[1]?.systemPrompt);
  expect(result.receipt).toBeUndefined();
  expect(result.view.gaps).toContainEqual(
    expect.objectContaining({
      gap: 'no-receipt-on-chart',
      cause: 'no-receipt-committed',
    }),
  );
});

it.each(['whole', 'parts'] as const)(
  'keeps the policy of the recorded child in %s',
  async (layout) => {
    const { recording, requests } = await childRecording({ redact: true });
    const store = inMemoryArtifacts();
    const ref =
      layout === 'whole'
        ? await fileWhole(store, recording)
        : (await fileParts(store, recording, { targetBytes: 4_096 })).index;
    const saved = await openSavedRecording(counted(store).artifacts, ref);
    if (saved.status !== 'ready') throw new Error('Missing fixture recording');
    const first = epochLocations(recording.snapshot)[0]!;
    const result = await readInvocationModelInput(saved, addressFor(recording, saved, first));
    expect(JSON.stringify(requests[0])).toContain(PRIVATE);
    expect(JSON.stringify(result)).not.toContain(PRIVATE);
    expect(result.status).toBe('ready');
  },
);

it('reads a newly committed child model call after a fresh composition resume', async () => {
  const calls: LLMRequest[] = [];
  const agent = Agent.create({
    model: 'mock',
    reactMode: 'dynamic-grouped',
    provider: {
      name: 'mock',
      complete: async (request) => {
        calls.push(structuredClone(request));
        const toolCalls =
          calls.length === 1 ? [{ id: 'pause-call', name: 'ask_person', args: {} }] : [];
        return {
          content: toolCalls.length ? '' : 'complete',
          toolCalls,
          usage: { input: 1, output: 1 },
          stopReason: toolCalls.length ? 'tool_use' : 'stop',
        };
      },
    },
  })
    .system('resume the same recorded child')
    .tool(
      defineTool({
        name: 'ask_person',
        description: 'test-only pause',
        inputSchema: { type: 'object' },
        execute: () => {
          pauseHere({ question: 'Continue?' });
          return '';
        },
      }),
    )
    .build();
  const flow = Sequence.create().step('resumed', agent).build();
  const recorder = recordRun(flow);
  try {
    const paused = await flow.run('mock request');
    if (!isPaused(paused)) throw new Error('The fixture should have paused');
    await flow.resume(JSON.parse(JSON.stringify(paused.checkpoint)), { approved: true });
    expect(calls).toHaveLength(2);
    const recording = recorder.toRecording();
    const source = inMemoryArtifacts();
    const saved = await openSavedRecording(
      counted(source).artifacts,
      await fileWhole(source, recording),
    );
    if (saved.status !== 'ready') throw new Error('Missing resume recording');
    const last = epochLocations(recording.snapshot).at(-1)!;
    const result = await readInvocationModelInput(saved, addressFor(recording, saved, last));
    if (result.status !== 'ready' || !result.receipt) throw new Error(JSON.stringify(result));
    expect(result.view.system.text).toBe(calls[1]?.systemPrompt);
    expect(result.view.messages.asSent).toEqual(calls[1]?.messages);
    expect(result.receipt).toEqual(readAfterCall(last, RECEIPT_KEY));
  } finally {
    recorder.stop();
    await flow.shutdown();
  }
});

it('reads a flat child at its own native commit', async () => {
  const { recording, requests } = await childRecording({ reactMode: 'dynamic' });
  const store = inMemoryArtifacts();
  const saved = await openSavedRecording(
    counted(store).artifacts,
    await fileWhole(store, recording),
  );
  if (saved.status !== 'ready') throw new Error('Missing fixture recording');
  const events = recording.events.filter(
    (event) => event.type === 'agentfootprint.stream.llm_start',
  );
  expect(events).toHaveLength(2);
  for (const [index, event] of events.entries()) {
    const origin = event.meta.sourcePosition;
    const id = event.meta.runtimeStageId;
    if (!origin || !id) throw new Error('Missing fixture call position');
    const result = await readInvocationModelInput(saved, {
      engineRunId: origin.engineRunId,
      logRunId: origin.logRunId,
      invocationPath: origin.drillPath,
      commitIdx: origin.committedThroughIdx + 1,
      runtimeStageId: id,
    });
    if (result.status !== 'ready' || !result.receipt) throw new Error(JSON.stringify(result));
    expect(result.view.system.text).toBe(requests[index]?.systemPrompt);
    expect(result.view.messages.asSent).toEqual(requests[index]?.messages);
  }
});

it('refuses foreign native bytes and an unsupported commit without displaying a view', async () => {
  const { recording } = await childRecording();
  const store = inMemoryArtifacts();
  const saved = await openSavedRecording(
    counted(store).artifacts,
    await fileWhole(store, recording),
  );
  if (saved.status !== 'ready') throw new Error('Missing fixture recording');
  const epochs = epochLocations(recording.snapshot);
  const address = addressFor(recording, saved, epochs[0]!);
  const foreign = addressFor(recording, saved, epochs[1]!);
  const alternate = await saved.readInvocation(foreign.invocationPath.at(-1)!);
  if (alternate.status !== 'ready') throw new Error('Missing sibling fixture');
  const transplant = {
    ...saved,
    async readInvocation(key: string) {
      const selected = await saved.readInvocation(key);
      return selected.status === 'ready' ? { ...selected, result: alternate.result } : selected;
    },
  };
  await expect(readInvocationModelInput(transplant, address)).resolves.toEqual({
    status: 'unavailable',
    reason: 'address-mismatch',
  });

  const unreadable = {
    ...saved,
    async readInvocation(key: string) {
      const selected = await saved.readInvocation(key);
      if (selected.status !== 'ready') return selected;
      const result = structuredClone(selected.result) as {
        treeContext: { history: { trace: { verb: string }[] }[] };
      };
      result.treeContext.history[address.commitIdx]!.trace[0]!.verb = 'future-unsupported-verb';
      return { ...selected, result };
    },
  };
  await expect(readInvocationModelInput(unreadable, address)).resolves.toEqual({
    status: 'unavailable',
    reason: 'unreadable-commit',
  });
});
