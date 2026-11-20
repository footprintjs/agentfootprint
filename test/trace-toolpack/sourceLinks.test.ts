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
import { FlowChartExecutor, flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';
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

  it('projects at most 256 rows and marks a remaining candidate as budget exhausted', () => {
    const scope = fixtureScope(fixture.witnessRow, {
      rows: Array.from({ length: 257 }, () => structuredClone(fixture.witnessRow)),
    });
    const sourceLinks = sourceLinksOf(scope);
    expect(sourceLinks).toMatchObject({ status: 'partial', limitations: ['budget-exhausted'] });
    expect(sourceLinks?.links).toHaveLength(256);
    expect(sourceLinks?.links.at(-1)?.witness.element).toBe(255);
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
