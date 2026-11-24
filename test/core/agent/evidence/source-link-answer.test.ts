import assert from 'node:assert/strict';
import { createRecordGraph, type RecordScope, type SourceLinkRow } from 'foottrace/cause';
import { expect, it } from 'vitest';
import type { RuntimeSnapshot } from 'footprintjs';
import type { StageSnapshot } from 'footprintjs/advanced';
import { Agent, allow, defineTool, slidingWindow } from '../../../../src/index.js';
import { mock } from '../../../../src/providers.js';
import { openRecording, recordRun } from '../../../../src/observe.js';
import {
  epochLocations,
  keyedFold,
  readAfterCall,
  readAtCall,
} from '../../../../src/time-travel/index.js';
import { isCollapsedToolResult } from '../../../../src/core/agent/findings/serve.js';
import type { ServedRow } from '../../../../src/core/agent/receipt/servedRow.js';
import type { LLMMessage } from '../../../../src/provider-contract/types.js';
import { sourceLinksOf } from '../../../../src/trace-toolpack/sourceLinks.js';

const answer = 'The storage pool has 4200 GB.';
const unsupportedAnswer = `${answer}\n\n---\n\nNot sure — names or numbers in the answer appear in no tool result.`;
const evictedAnswer = `${answer}\n\n---\n\nNot sure — 3 results from this turn were dropped from the conversation before the answer; names or numbers in the answer appear in no tool result.`;

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

it.each(['full', 'delta'] as const)(
  'records the same protected-history limitation with or without a hidden match (%s)',
  async (commitValues) => {
    const publicResults: string[] = [];
    const address = { logRunId: 'paired-protected-history', drillPath: [] };
    for (const result of [answer, `${answer} ${answer} ${answer}`, 'Pool capacity unavailable.']) {
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
        .tool(capacity(result))
        .namesAndNumbersFromEvidence({ posture: 'assist' })
        .build();
      try {
        expect(await agent.run('What is the capacity?', { redact: { keys: ['history'] } })).toBe(
          result.includes('4200') ? answer : unsupportedAnswer,
        );
        const snapshot = agent.getSnapshot();
        assert(snapshot);
        expect(snapshot.sharedState.history).toBe('REDACTED');
        expect(answerRows(snapshot)).toBeUndefined();
        const scope: RecordScope = {
          address,
          commitLog: snapshot.commitLog,
          initialState: snapshot.initialState,
          reads: trackedReads(snapshot),
        };
        const sourceLinks = sourceLinksOf(scope);
        expect(sourceLinks).toEqual({
          version: 1,
          status: 'partial',
          links: [],
          limitations: ['privacy-active'],
        });
        const output = epochLocations(snapshot).at(-1);
        assert(output);
        const graph = createRecordGraph([{ ...scope, sourceLinks }], {
          sourceLinkPolicy: ({ key }) => key !== 'history',
        });
        const page = await graph.parents(
          graph.nodeId(address, {
            key: 'llmLatestContent',
            commitIdx: output.callIdx,
            runtimeStageId: output.callRuntimeStageId,
          }),
          { signal: new AbortController().signal },
        );
        expect(page.sourceLinks).toBeUndefined();
        expect(page.sourceLinkGaps).toEqual([{ code: 'redacted' }]);
        publicResults.push(JSON.stringify({ sourceLinks, page }));
      } finally {
        await agent.shutdown();
      }
    }
    expect(new Set(publicResults).size).toBe(1);
  },
);

it.each(['whole', 'evicted', 'collapsed'] as const)(
  'links the source only when the final call received the result whole (%s)',
  async (transport) => {
    const requests: Array<{ readonly content: string; readonly toolCallId?: string }[]> = [];
    const result = `${answer} ${'Storage capacity measurement. '.repeat(22)}`;
    const provider = mock({
      replies: [
        { content: '', toolCalls: [{ id: 'capacity', name: 'capacity', args: {} }] },
        ...Array.from({ length: 3 }, (_, index) => ({
          content: '',
          toolCalls: [
            {
              id: `label-${index}`,
              name: 'label',
              args:
                index === 0 && transport === 'collapsed'
                  ? {
                      _findings: {
                        previous: [
                          {
                            toolCallId: 'capacity',
                            standing: 'fact',
                            sought: true,
                            assertions: [
                              {
                                subject: { kind: 'storage', id: 'pool' },
                                predicate: 'capacity',
                                value: 4200,
                              },
                            ],
                          },
                        ],
                      },
                    }
                  : {},
            },
          ],
        })),
        { content: answer },
      ],
    });
    const builder = Agent.create({
      provider: {
        name: provider.name,
        complete(request) {
          requests.push(
            request.messages.map(({ content, toolCallId }) => ({
              content,
              ...(toolCallId === undefined ? {} : { toolCallId }),
            })),
          );
          return provider.complete(request);
        },
      },
      model: 'mock',
      ...(transport === 'evicted' && { keepLastToolResults: false as const }),
    })
      .tool(capacity(result))
      .tool(
        defineTool({
          name: 'label',
          description: 'Read the storage pool label.',
          inputSchema: { type: 'object' },
          execute: () => 'The label is storage.',
        }),
      )
      .namesAndNumbersFromEvidence({ posture: 'assist' });
    if (transport === 'evicted') builder.window(slidingWindow({ keepRecentTurns: 1 }));
    if (transport === 'collapsed') builder.findings({ serve: 'ledger-only' });
    const agent = builder.build();
    try {
      expect(
        await agent.run(`What is the capacity? ${'Start the sampling exercise. '.repeat(18)}`),
      ).toBe(transport === 'evicted' ? evictedAnswer : answer);
      expect(requests[1]?.some(({ content }) => content === result)).toBe(true);
      const finalInput = requests.at(-1)?.find(({ toolCallId }) => toolCallId === 'capacity');
      if (transport === 'evicted') expect(finalInput).toBeUndefined();
      if (transport === 'collapsed') {
        assert(finalInput);
        expect(isCollapsedToolResult(JSON.parse(finalInput.content))).toBe(true);
      }
      if (transport === 'whole') expect(finalInput?.content).toBe(result);

      const snapshot = agent.getSnapshot();
      assert(snapshot?.logAddress);
      const finalCall = epochLocations(snapshot).at(-1);
      assert(finalCall);
      const history = readAtCall(finalCall, 'history') as readonly LLMMessage[];
      const position = history.findIndex(({ content }) => content === result);
      const served = readAfterCall(finalCall, 'sourceLinkServedRows') as readonly ServedRow[];
      const row = served.find(({ consumer }) => consumer === finalCall.callRuntimeStageId);
      assert(row);
      if (transport === 'evicted') {
        expect(position).toBe(-1);
      } else {
        expect(position).toBeGreaterThanOrEqual(0);
        expect(
          row.served[0]?.elements?.some(([start, end]) => start <= position && position < end),
        ).toBe(transport === 'whole');
      }
      const scope: RecordScope = {
        address: snapshot.logAddress,
        commitLog: snapshot.commitLog,
        initialState: snapshot.initialState,
        reads: trackedReads(snapshot),
      };
      const sourceLinks = sourceLinksOf(scope);
      const [link] = sourceLinks?.links ?? [];
      if (transport === 'whole') {
        assert(link?.input);
        const graph = createRecordGraph([{ ...scope, sourceLinks }], {
          sourceLinkPolicy: () => true,
        });
        const page = await graph.parents(graph.nodeId(scope.address, link.output), {
          signal: new AbortController().signal,
        });
        expect(page.sourceLinks).toMatchObject([{ standing: 'witnessed' }]);
      } else {
        expect(sourceLinks).toBeUndefined();
      }
    } finally {
      await agent.shutdown();
    }
  },
);
