import assert from 'node:assert/strict';
import { createRecordGraph, readServedRow, type RecordScope } from 'foottrace/cause';
import { expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/providers.js';
import { openRecording, recordRun } from '../../src/observe.js';
import { epochLocations, keyedFold } from '../../src/time-travel/index.js';
import { sourceLinksOf } from '../../src/trace-toolpack/sourceLinks.js';

it('keeps source links out of the live and saved grouped answer', async () => {
  const answer = 'The storage pool has 4200 GB.';
  const capacity = defineTool({
    name: 'capacity',
    description: 'Read the storage capacity',
    inputSchema: { type: 'object', properties: {} },
    execute: () => answer,
  });
  const agent = Agent.create({
    model: 'mock',
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'c1', name: 'capacity', args: {} }] },
        { content: answer },
      ],
    }),
    reactMode: 'dynamic-grouped',
  })
    .tool(capacity)
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();

  const recorder = recordRun(agent);
  expect(await agent.run({ message: 'What is the capacity?' })).toBe(answer);
  const recording = recorder.toRecording();
  const evidence = recording.events.find(
    (event) => event.type === 'agentfootprint.agent.evidence_checked',
  );
  expect(evidence?.payload).toMatchObject({ action: 'grounded', lookedUp: 1, unsupported: [] });

  const saved = openRecording(JSON.parse(JSON.stringify(recording)));
  for (const [mode, snapshot] of [
    ['live', agent.getLastSnapshot()],
    ['saved', saved.snapshot],
  ] as const) {
    assert(snapshot?.logAddress, `${mode} snapshot must have its own recorded scope`);
    const epochs = epochLocations(snapshot);
    expect(epochs, mode).toHaveLength(2);
    const child = epochs[1]!;
    expect(child.subflowScope, mode).toMatch(/^sf-llm-call#/);

    const servedKey = 'sourceLinkServedRows';
    const parent = keyedFold(snapshot);
    expect(parent.valueAt(servedKey, parent.length - 1), mode).toBeUndefined();
    const childFold = keyedFold(child.source);
    const childRows = childFold.valueAt(servedKey, child.callIdx);
    assert(Array.isArray(childRows), `${mode} child must record served rows`);
    expect(childRows.map(readServedRow), mode).toContainEqual(
      expect.objectContaining({ consumer: child.callRuntimeStageId }),
    );
    expect(
      child.log.some((bundle) => bundle.trace.some((entry) => entry.path === 'sourceLinkRows')),
      mode,
    ).toBe(false);

    const scope: RecordScope = {
      address: snapshot.logAddress,
      initialState: snapshot.initialState,
      commitLog: snapshot.commitLog,
      complete: true,
    };
    const channel = sourceLinksOf(scope);
    const projected = { ...scope, ...(channel === undefined ? {} : { sourceLinks: channel }) };
    expect(Object.hasOwn(projected, 'sourceLinks'), mode).toBe(false);

    const key = 'llmLatestContent';
    const writes = snapshot.commitLog.filter(
      (bundle, index) =>
        bundle.trace.some((entry) => entry.path === key) && parent.valueAt(key, index) === answer,
    );
    const output = writes.at(-1);
    assert(output, `${mode} parent must record the checked answer`);
    const graph = createRecordGraph([projected], { sourceLinkPolicy: () => true });
    const write = { runtimeStageId: output.runtimeStageId, commitIdx: output.idx };
    const context = { signal: new AbortController().signal };
    expect(await graph.openScope(scope.address, context), mode).toContain(
      graph.nodeId(scope.address, write),
    );
    const page = await graph.parents(graph.nodeId(scope.address, { ...write, key }), context);
    expect(Object.hasOwn(page, 'sourceLinks'), mode).toBe(false);
    expect(Object.hasOwn(page, 'sourceLinkGaps'), mode).toBe(false);
  }
});
