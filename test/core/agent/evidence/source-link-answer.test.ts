import assert from 'node:assert/strict';
import { createRecordGraph, type RecordScope, type SourceLinkRow } from 'foottrace/cause';
import { expect, it } from 'vitest';
import type { RuntimeSnapshot } from 'footprintjs';
import type { StageSnapshot } from 'footprintjs/advanced';
import { Agent, allow, defineTool } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import { openRecording, recordRun } from '../../../../src/observe.js';
import { keyedFold } from '../../../../src/time-travel/index.js';
import { sourceLinksOf } from '../../../../src/trace-toolpack/sourceLinks.js';

const answer = 'The storage pool has 4200 GB.';

const capacity = (result: string) =>
  defineTool({
    name: 'capacity',
    description: 'Read the storage capacity.',
    inputSchema: { type: 'object' },
    execute: () => result,
  });

function trackedReads(snapshot: RuntimeSnapshot) {
  const reads: Record<string, string[]> = {};
  function visit(stage: StageSnapshot | undefined) {
    if (stage === undefined) return;
    if (stage.runtimeStageId !== undefined)
      reads[stage.runtimeStageId] = Object.keys(stage.stageReads ?? {});
    visit(stage.next);
    for (const child of stage.children ?? []) visit(child);
  }
  visit(snapshot.executionTree);
  return reads;
}

function answerRows(snapshot: RuntimeSnapshot) {
  const fold = keyedFold(snapshot);
  return fold.valueAt('sourceLinkRows', fold.length - 1) as readonly SourceLinkRow[] | undefined;
}

it('binds the checked answer span to an exact served history entry on live and JSON-saved records', async () => {
  const agent = Agent.create({
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'c1', name: 'capacity', args: {} }] },
        { content: answer },
      ],
    }),
    model: 'mock',
  })
    .tool(capacity(answer))
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .build();
  const recorder = recordRun(agent);
  try {
    expect(await agent.run('What is the capacity?')).toBe(answer);
    const recording = recorder.toRecording();
    const saved = openRecording(JSON.parse(JSON.stringify(recording)));
    const tokenStart = answer.indexOf('4200');
    const span = [tokenStart, tokenStart + '4200'.length];
    for (const snapshot of [agent.getSnapshot(), saved.snapshot]) {
      assert(snapshot?.logAddress);
      const rows = answerRows(snapshot);
      expect(rows).toMatchObject([
        {
          kind: 'source-link',
          version: 1,
          linkBasis: 'match',
          check: 'value-found',
          output: { key: 'llmLatestContent', checkedIn: 'read', span },
          input: { key: 'history', element: 2 },
        },
      ]);
      const scope: RecordScope = {
        address: snapshot.logAddress,
        commitLog: snapshot.commitLog,
        initialState: snapshot.initialState,
        reads: trackedReads(snapshot),
      };
      const sourceLinks = sourceLinksOf(scope);
      const [link] = sourceLinks?.links ?? [];
      assert(link);
      expect(link.consumer.runtimeStageId).toBe(rows?.[0]?.consumer);
      expect(link.witness.runtimeStageId).not.toBe(link.output.runtimeStageId);
      const graph = createRecordGraph([{ ...scope, sourceLinks }], {
        sourceLinkPolicy: () => true,
      });
      const page = await graph.parents(graph.nodeId(scope.address, link.output), {
        signal: new AbortController().signal,
      });
      expect(page.sourceLinks).toMatchObject([
        {
          standing: 'witnessed',
          output: { selection: { key: 'llmLatestContent', span } },
          input: { view: { key: 'history', element: 2 } },
        },
      ]);
    }
  } finally {
    recorder.stop();
    await agent.shutdown();
  }
});

it('witnesses the checked canonical output at the offset written by validation', async () => {
  const draft = '{"capacity":4200}';
  const delivered = '{"unit":"GB","capacity":4200}';
  const agent = Agent.create({
    provider: mock({
      replies: [
        { content: '', toolCalls: [{ id: 'c1', name: 'capacity', args: {} }] },
        { content: draft },
      ],
    }),
    model: 'mock',
  })
    .tool(capacity(draft))
    .outputSchema({
      parse(value) {
        const { capacity } = value as { capacity: number };
        return { unit: 'GB', capacity };
      },
    })
    .namesAndNumbersFromEvidence({ posture: 'assist' })
    .answerValidation({
      id: 'canonical-capacity',
      version: '1',
      agentChecks: ['names-and-numbers'],
      validate: () => ({ checks: [{ id: 'schema', disposition: 'checked-pass' }] }),
    })
    .build();
  try {
    expect(await agent.run('What is the capacity?')).toBe(delivered);
    const snapshot = agent.getSnapshot();
    assert(snapshot?.logAddress);
    const start = delivered.indexOf('4200');
    const span = [start, start + '4200'.length];
    expect(answerRows(snapshot)).toMatchObject([
      { check: 'value-found', output: { key: 'llmLatestContent', checkedIn: 'written', span } },
    ]);
    const scope: RecordScope = {
      address: snapshot.logAddress,
      commitLog: snapshot.commitLog,
      initialState: snapshot.initialState,
      reads: trackedReads(snapshot),
    };
    const sourceLinks = sourceLinksOf(scope);
    const [link] = sourceLinks?.links ?? [];
    assert(link);
    expect(link.witness.runtimeStageId).toBe(link.output.runtimeStageId);
    expect(link.witness.commitIdx).toBe(link.output.commitIdx);
    const graph = createRecordGraph([{ ...scope, sourceLinks }], {
      sourceLinkPolicy: () => true,
    });
    const page = await graph.parents(graph.nodeId(scope.address, link.output), {
      signal: new AbortController().signal,
    });
    expect(page.sourceLinks).toMatchObject([
      { standing: 'witnessed', output: { selection: { key: 'llmLatestContent', span } } },
    ]);
  } finally {
    await agent.shutdown();
  }
});

it.each([
  ['delta', 'unchanged'],
  ['delta', 'rewritten'],
  ['full', 'unchanged'],
  ['full', 'rewritten'],
] as const)(
  'binds the native Route output in %s mode after a middleware decision leaves it %s',
  async (commitValues, mode) => {
    const delivered = mode === 'rewritten' ? `Final answer. ${answer}` : answer;
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: '', toolCalls: [{ id: 'c1', name: 'capacity', args: {} }] },
          { content: answer },
        ],
      }),
      model: 'mock',
      commitValues,
    })
      .tool(capacity(answer))
      .messageMiddleware({
        name: 'record-answer',
        onMessage: (message) =>
          message.phase === 'output' && mode === 'rewritten'
            ? allow(delivered, 'added final-answer label')
            : allow(),
      })
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    try {
      expect(await agent.run('What is the capacity?')).toBe(delivered);
      const snapshot = agent.getSnapshot();
      assert(snapshot?.logAddress);
      const start = delivered.indexOf('4200');
      const span = [start, start + '4200'.length];
      expect(answerRows(snapshot)?.[0]?.output.checkedIn).toBe(
        mode === 'rewritten' ? 'written' : 'read',
      );
      const scope: RecordScope = {
        address: snapshot.logAddress,
        commitLog: snapshot.commitLog,
        initialState: snapshot.initialState,
        reads: trackedReads(snapshot),
      };
      const sourceLinks = sourceLinksOf(scope);
      const [link] = sourceLinks?.links ?? [];
      assert(link);
      const graph = createRecordGraph([{ ...scope, sourceLinks }], {
        sourceLinkPolicy: () => true,
      });
      const page = await graph.parents(graph.nodeId(scope.address, link.output), {
        signal: new AbortController().signal,
      });
      expect(page.sourceLinks).toMatchObject([
        { standing: 'witnessed', output: { selection: { key: 'llmLatestContent', span } } },
      ]);
    } finally {
      await agent.shutdown();
    }
  },
);

it.each([answer, 'The storage pool has a different capacity.'])(
  'writes no answer link or gap-count signal when the history is masked',
  async (result) => {
    const agent = Agent.create({
      provider: mock({
        replies: [
          { content: '', toolCalls: [{ id: 'c1', name: 'capacity', args: {} }] },
          { content: answer },
        ],
      }),
      model: 'mock',
    })
      .tool(capacity(result))
      .namesAndNumbersFromEvidence({ posture: 'assist' })
      .build();
    try {
      expect(await agent.run('What is the capacity?', { redact: { keys: ['history'] } })).toBe(
        answer,
      );
      const snapshot = agent.getSnapshot();
      assert(snapshot?.logAddress);
      expect(answerRows(snapshot)).toBeUndefined();
      expect(
        sourceLinksOf({
          address: snapshot.logAddress,
          commitLog: snapshot.commitLog,
          initialState: snapshot.initialState,
          reads: trackedReads(snapshot),
        }),
      ).toBeUndefined();
    } finally {
      await agent.shutdown();
    }
  },
);
