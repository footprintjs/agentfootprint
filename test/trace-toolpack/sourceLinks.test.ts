import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { CommitBundle } from 'foottrace';
import {
  createRecordGraph,
  readServedRow,
  readSourceLinkRow,
  type RecordScope,
  type ServedRow,
  type SourceLinkRow,
  type SourceLinkRowLocation,
  type SourceLinkWrite,
} from 'foottrace/cause';
import { FlowChartExecutor, flowChart, type RuntimeSnapshot } from 'footprintjs';
import type { StageSnapshot } from 'footprintjs/advanced';
import { describe, expect, it } from 'vitest';
import {
  Agent,
  defineTool,
  inMemoryArtifacts,
  isPlacedToolResult,
  placedResultKind,
} from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { sourceLinksOf } from '../../src/trace-toolpack/sourceLinks.js';

const servedKey = 'sourceLinkServedRows';
const witnessKey = 'sourceLinkRows';
const require = createRequire(import.meta.url);
const fixture = JSON.parse(
  readFileSync(
    join(dirname(require.resolve('foottrace/package.json')), 'dist/fixtures/source-links-v1.json'),
    'utf8',
  ),
) as {
  address: RecordScope['address'];
  initialState: { history: string[] };
  servedRow: ServedRow;
  witnessRow: SourceLinkRow;
  witness: SourceLinkRowLocation;
  boundWrite: SourceLinkWrite;
  checkPairs: (Pick<SourceLinkRow, 'linkBasis' | 'namedBy' | 'check'> & {
    standing?: 'witnessed';
    gap?: string;
  })[];
};
const context = { signal: new AbortController().signal };

function commit(
  runtimeStageId: string,
  idx: number,
  overwrite: Record<string, unknown>,
): CommitBundle {
  return {
    runtimeStageId,
    idx,
    stageId: runtimeStageId,
    stage: runtimeStageId,
    trace: Object.keys(overwrite).map((path) => ({ path, verb: 'set' })),
    overwrite,
    updates: {},
    redactedPaths: [],
  };
}

function fixtureScope(
  row: SourceLinkRow,
  options: { rows?: readonly unknown[] } = {},
): RecordScope {
  return {
    address: fixture.address,
    initialState: fixture.initialState,
    commitLog: [
      commit(fixture.servedRow.consumer, 0, { [servedKey]: [fixture.servedRow] }),
      commit(fixture.witness.runtimeStageId, fixture.witness.commitIdx, {
        answer: 'synthetic value',
        [witnessKey]: options.rows ?? [row],
      }),
    ],
  };
}

describe('the packed source-link contract', () => {
  it.each(fixture.checkPairs)('projects $linkBasis $check from its committed row', async (pair) => {
    const { linkBasis, namedBy, check, standing, gap } = pair;
    const { input, ...witnessRow } = fixture.witnessRow;
    const row: SourceLinkRow = {
      ...witnessRow,
      linkBasis,
      ...(namedBy === undefined ? {} : { namedBy }),
      check,
      ...(check === 'not-checked' || check === 'no-match' || input === undefined ? {} : { input }),
    };
    expect(readSourceLinkRow(row)).toEqual(row);
    const scope = fixtureScope(row);
    const sourceLinks = sourceLinksOf(scope);
    expect(sourceLinks?.links).toEqual([
      {
        linkBasis,
        ...(namedBy === undefined ? {} : { namedBy }),
        check,
        consumer: { runtimeStageId: row.consumer },
        output: { ...row.output, ...fixture.boundWrite },
        ...(row.input === undefined ? {} : { input: row.input }),
        served: { key: servedKey },
        witness: { ...fixture.witness, key: witnessKey },
      },
    ]);
    const graph = createRecordGraph([{ ...scope, sourceLinks }], { sourceLinkPolicy: () => true });
    const page = await graph.parents(
      graph.nodeId(scope.address, { ...fixture.boundWrite, key: row.output.key }),
      context,
    );
    if (standing === 'witnessed') {
      expect(page.sourceLinks).toMatchObject([{ standing }]);
    } else {
      expect(page.sourceLinks).toBeUndefined();
      expect(page.sourceLinkGaps).toContainEqual(expect.objectContaining({ code: gap }));
    }
  });

  it('omits the channel for a legacy record, a missing base or a consumer in an earlier leg', () => {
    const scope = fixtureScope(fixture.witnessRow);
    expect(sourceLinksOf({ ...scope, commitLog: [] })).toBeUndefined();
    expect(sourceLinksOf({ ...scope, initialState: undefined })).toBeUndefined();
    expect(
      sourceLinksOf({
        ...scope,
        initialState: { ...scope.initialState, [servedKey]: [fixture.servedRow] },
        commitLog: [
          commit(fixture.servedRow.consumer, 0, { other: 'next leg' }),
          scope.commitLog[1],
        ],
      }),
    ).toBeUndefined();
  });

  it('does not accept a served row written in a later commit of the same execution', () => {
    const scope = fixtureScope(fixture.witnessRow);
    expect(
      sourceLinksOf({
        ...scope,
        commitLog: [
          commit(fixture.servedRow.consumer, 0, { answer: 'first commit' }),
          commit(fixture.servedRow.consumer, 1, { [servedKey]: [fixture.servedRow] }),
          commit(fixture.witness.runtimeStageId, 2, {
            answer: 'synthetic value',
            [witnessKey]: [fixture.witnessRow],
          }),
        ],
      }),
    ).toBeUndefined();
  });

  it('omits the channel when a row or bundle is malformed', () => {
    expect(
      sourceLinksOf(
        fixtureScope(fixture.witnessRow, { rows: [{ ...fixture.witnessRow, version: 2 }] }),
      ),
    ).toBeUndefined();
    const scope = fixtureScope(fixture.witnessRow);
    expect(sourceLinksOf({ ...scope, commitLog: [...scope.commitLog, null] })).toBeUndefined();
  });

  it('does not invoke an accessor supplied as recorded trace metadata', () => {
    const scope = fixtureScope(fixture.witnessRow);
    let reads = 0;
    const getter = {
      get trace() {
        reads++;
        throw new Error('foreign trace');
      },
    };
    expect(sourceLinksOf({ ...scope, commitLog: [...scope.commitLog, getter] })).toBeUndefined();
    expect(reads).toBe(0);
  });

  it('keeps the first 256 bindable witnesses from a saved scope with 257 candidates', () => {
    const scope = fixtureScope(fixture.witnessRow, {
      rows: Array.from({ length: 257 }, () => structuredClone(fixture.witnessRow)),
    });
    const savedScope = JSON.parse(JSON.stringify(scope)) as RecordScope;
    const sourceLinks = sourceLinksOf(savedScope);
    expect(sourceLinks).toMatchObject({ status: 'partial', limitations: ['budget-exhausted'] });
    expect(sourceLinks?.links.map(({ witness }) => witness.element)).toEqual(
      Array.from({ length: 256 }, (_, index) => index),
    );
  });

  it('keeps the original witness positions around a locator with no binding', () => {
    const row = fixture.witnessRow;
    const missingOutput = { ...row, output: { ...row.output, key: 'unwritten' } };
    const scope = fixtureScope(row, {
      rows: [row, missingOutput, row].map((entry) => structuredClone(entry)),
    });
    const sourceLinks = sourceLinksOf(scope);
    expect(sourceLinks).toMatchObject({ status: 'captured', limitations: [] });
    expect(sourceLinks?.links.map(({ witness }) => witness.element)).toEqual([0, 2]);
  });

  it('reports an empty partial channel when admission spends the budget before the first binding', () => {
    const scope = fixtureScope(fixture.witnessRow);
    const overBudget = {
      ...scope,
      initialState: { ...scope.initialState, other: Array<unknown>(1_000_001) },
    };
    expect(sourceLinksOf(overBudget)).toEqual({
      version: 1,
      status: 'partial',
      links: [],
      limitations: ['budget-exhausted'],
    });
  });

  it('reports a later consumer’s protected history even after the witness budget is spent', () => {
    const scope = fixtureScope(fixture.witnessRow);
    const checked = commit(fixture.witness.runtimeStageId, fixture.witness.commitIdx, {
      answer: 'synthetic value',
      [witnessKey]: [fixture.witnessRow],
      sourceLinkRowsBounded: true,
    });
    const consumer = 'later-protected-consumer';
    const protectedCall = commit(consumer, 2, {
      [servedKey]: [fixture.servedRow, { ...fixture.servedRow, consumer }],
      sourceLinkConsumer: { consumer, historyProtected: true },
    });
    const sourceLinks = sourceLinksOf({
      ...scope,
      commitLog: [scope.commitLog[0], checked, protectedCall],
    });
    expect(sourceLinks?.limitations).toEqual(['budget-exhausted', 'privacy-active']);
  });

  it('retains witnesses before the commit reader limit', () => {
    const scope = fixtureScope(fixture.witnessRow);
    const complete = sourceLinksOf(scope);
    expect(complete?.links).toHaveLength(1);
    const tail = Array.from({ length: 4095 }, (_, i) => commit(`tail-${i}`, i + 2, {}));
    const result = sourceLinksOf({ ...scope, commitLog: [...scope.commitLog, ...tail] });
    expect(result).toEqual({
      ...complete,
      status: 'partial',
      limitations: ['budget-exhausted'],
    });
    expect(
      sourceLinksOf({ ...scope, commitLog: tail.concat(commit('extra', 4097, {})) }),
    ).toBeUndefined();
  });

  it('keeps tracked reads in the admitted prefix before an over-wide commit', () => {
    const consumer = fixture.servedRow.consumer;
    const door = fixture.witness.runtimeStageId;
    const scope: RecordScope = {
      address: fixture.address,
      initialState: fixture.initialState,
      commitLog: [
        commit(consumer, 0, { answer: 'synthetic value', [servedKey]: [fixture.servedRow] }),
        commit(door, 1, {
          [witnessKey]: [
            { ...fixture.witnessRow, output: { ...fixture.witnessRow.output, checkedIn: 'read' } },
          ],
        }),
      ],
      reads: { [door]: ['answer'] },
    };
    const complete = sourceLinksOf(scope);
    expect(complete?.links).toHaveLength(1);
    const wide = commit(
      'wide',
      2,
      Object.fromEntries(Array.from({ length: 129 }, (_, i) => [`field-${i}`, i])),
    );
    let calls = 0;
    Object.defineProperty(wide.trace, '128', {
      get() {
        calls++;
        throw new Error('unread trace row');
      },
    });
    const result = sourceLinksOf({
      ...scope,
      commitLog: [...scope.commitLog, wide, commit('later', 3, {})],
      reads: { ...scope.reads, wide: [], later: [] },
    });
    expect(result).toEqual({
      ...complete,
      status: 'partial',
      limitations: ['budget-exhausted'],
    });
    expect(calls).toBe(0);
  });

  it('reports a reader limit when the over-wide commit shows a served write', () => {
    const scope = fixtureScope(fixture.witnessRow);
    const wide = commit(fixture.servedRow.consumer, 0, {
      [servedKey]: [fixture.servedRow],
      ...Object.fromEntries(Array.from({ length: 128 }, (_, i) => [`field-${i}`, i])),
    });
    expect(sourceLinksOf({ ...scope, commitLog: [wide, scope.commitLog[1]] })).toEqual({
      version: 1,
      status: 'partial',
      links: [],
      limitations: ['budget-exhausted'],
    });
  });
});

type HistoryState = {
  history: string[];
  answer?: string;
  sourceLinkServedRows?: ServedRow[];
  sourceLinkRows?: SourceLinkRow[];
};

it.each(['delta', 'full'] as const)(
  'projects two exact witnesses from a native %s log',
  async (commitValues) => {
    expect(readServedRow(fixture.servedRow)).toEqual(fixture.servedRow);
    const chart = flowChart<HistoryState>(
      'Seed history',
      (scope) => {
        scope.history = fixture.initialState.history;
      },
      'seed-history',
    )
      .addFunction(
        'First call',
        (scope) => {
          expect(scope.history[0]).toBe('synthetic value');
          scope.sourceLinkServedRows = [
            { ...fixture.servedRow, consumer: scope.$attempt().series },
          ];
          scope.answer = 'first answer';
        },
        'first-call',
      )
      .addFunction(
        'First check',
        (scope) => {
          expect(scope.answer).toBe('first answer');
          scope.sourceLinkRows = [
            {
              ...fixture.witnessRow,
              consumer: scope.sourceLinkServedRows![0]!.consumer,
              output: { ...fixture.witnessRow.output, checkedIn: 'read' },
            },
          ];
        },
        'first-check',
      )
      .addFunction(
        'Second call',
        (scope) => {
          expect(scope.history[0]).toBe('synthetic value');
          scope.sourceLinkServedRows = [
            ...scope.sourceLinkServedRows!,
            { ...fixture.servedRow, consumer: scope.$attempt().series },
          ];
        },
        'second-call',
      )
      .addFunction(
        'Second check',
        (scope) => {
          scope.answer = 'second answer';
          scope.sourceLinkRows = [
            ...scope.sourceLinkRows!,
            { ...fixture.witnessRow, consumer: scope.sourceLinkServedRows![1]!.consumer },
          ];
        },
        'second-check',
      )
      .build();
    const executor = new FlowChartExecutor(chart, {
      commitValues,
      writeProvenance: 'reads-prefix',
    });
    await executor.run();
    const snapshot = executor.getSnapshot();
    expect(snapshot.commitValues).toBe(commitValues);
    const scope: RecordScope = {
      address: snapshot.logAddress!,
      initialState: snapshot.initialState,
      commitLog: snapshot.commitLog,
    };
    const sourceLinks = sourceLinksOf(scope);
    expect(sourceLinks?.links).toHaveLength(2);
    expect(sourceLinks?.links.map(({ witness }) => witness.element)).toEqual([0, 1]);
    expect(
      sourceLinks?.links.map(({ output, witness }) => [
        output.checkedIn,
        output.commitIdx === witness.commitIdx,
      ]),
    ).toEqual([
      ['read', false],
      ['written', true],
    ]);
    const graph = createRecordGraph([{ ...scope, sourceLinks }], { sourceLinkPolicy: () => true });
    for (const link of sourceLinks!.links) {
      const page = await graph.parents(graph.nodeId(scope.address, link.output), context);
      expect(page.sourceLinks).toMatchObject([{ standing: 'witnessed' }]);
    }
  },
);

function trackedScope(snapshot: RuntimeSnapshot): RecordScope {
  const { logAddress, commitLog, executionTree, initialState } = snapshot;
  assert(logAddress);
  const reads: Record<string, readonly string[]> = {};
  function visit(stage: StageSnapshot | undefined): void {
    if (stage === undefined) return;
    if (stage.runtimeStageId && stage.stageReads)
      reads[stage.runtimeStageId] = Object.keys(stage.stageReads);
    for (const child of stage.children ?? []) visit(child);
    visit(stage.next);
  }
  visit(executionTree);
  return { address: logAddress, commitLog, initialState, reads };
}

it('keeps the answered prefix when binding a real artifact recording exhausts the scope budget', async () => {
  const redemptions = 90;
  const store = inMemoryArtifacts();
  const getReport = defineTool({
    name: 'get_report',
    description: 'Get a report',
    execute: () => 'fixture payload '.repeat(200),
  });
  const consumeReport = defineTool({
    name: 'consume_report',
    description: 'Consume a report from an artifact',
    inputSchema: {
      type: 'object',
      properties: { report: { type: 'string' } },
      required: ['report'],
    },
    wants: { report: placedResultKind('get_report') },
    execute: () => 'consumed',
  });
  let step = 0;
  const provider = mock({
    respond: (request) => {
      const current = step++;
      if (current >= redemptions * 2) return { content: 'done', toolCalls: [] };
      if (current % 2 === 0) {
        return {
          content: '',
          toolCalls: [{ id: `get-${current}`, name: 'get_report', args: {} }],
        };
      }
      const result = request.messages.filter(({ role }) => role === 'tool').at(-1);
      assert(result && typeof result.content === 'string');
      const placed: unknown = JSON.parse(result.content);
      assert(isPlacedToolResult(placed));
      return {
        content: '',
        toolCalls: [{ id: `use-${current}`, name: 'consume_report', args: { report: placed.ref } }],
      };
    },
  });
  const agent = Agent.create({
    provider,
    model: 'mock',
    maxIterations: 500,
    artifacts: { store, placement: { maxInlineChars: 1600 } },
  })
    .tool(getReport)
    .tool(consumeReport)
    .build();
  try {
    expect(await agent.run({ message: 'Fetch and consume the reports' })).toBe('done');
    const snapshot = agent.getLastSnapshot();
    assert(snapshot);
    const rows = snapshot.sharedState[witnessKey] as readonly SourceLinkRow[] | undefined;
    assert(rows);
    expect(rows).toHaveLength(redemptions);

    const scope = trackedScope(snapshot);
    const result = sourceLinksOf(scope);
    assert(result);
    expect(result).toMatchObject({ status: 'partial', limitations: ['budget-exhausted'] });
    expect(result.links.length).toBeGreaterThan(0);
    expect(result.links.length).toBeLessThan(redemptions);
    expect(result.links.map(({ consumer }) => consumer.runtimeStageId)).toEqual(
      rows.slice(0, result.links.length).map(({ consumer }) => consumer),
    );
    expect(
      result.links.every(
        ({ linkBasis, check }) => linkBasis === 'reference' && check === 'redeemed',
      ),
    ).toBe(true);
  } finally {
    await agent.shutdown();
  }
}, 30_000);
