import assert from 'node:assert/strict';
import { createRecordGraph, type ServedRow, type SourceLinkRow } from 'foottrace/cause';
import { memorySink } from 'foottrace/write';
import { FlowChartExecutor, flowChart } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import { describe, expect, it } from 'vitest';
import { snapshotCauseArtifacts } from '../../src/trace-toolpack/causeSnapshot.js';
import { openRecording } from '../../src/trace-toolpack/openRecording.js';
import { readStoredCauseArtifacts } from '../../src/trace-toolpack/storedCause.js';
import { storedCauseOptions } from '../../src/trace-toolpack/storedCauseOptions.js';
import type { TraceToolpackArtifacts } from '../../src/trace-toolpack/types.js';

type State = {
  history: string[];
  answer?: string;
  sourceLinkServedRows?: ServedRow[];
  sourceLinkRows?: SourceLinkRow[];
};

const chart = flowChart<State>(
  'Seed history',
  (scope) => {
    scope.history = ['synthetic input'];
  },
  'seed-history',
)
  .addFunction(
    'Consume history',
    (scope) => {
      expect(scope.history[0]).toBe('synthetic input');
      scope.sourceLinkServedRows = [
        {
          kind: 'served',
          version: 1,
          consumer: scope.$attempt().series,
          served: [{ key: 'history', elements: [[0, 1]] }],
        },
      ];
    },
    'consumer',
  )
  .addFunction(
    'Check answer',
    (scope) => {
      scope.answer = 'synthetic answer';
      scope.sourceLinkRows = [
        {
          kind: 'source-link',
          version: 1,
          linkBasis: 'match',
          check: 'value-found',
          consumer: scope.sourceLinkServedRows![0]!.consumer,
          output: { key: 'answer', checkedIn: 'written' },
          input: { key: 'history', element: 0 },
        },
      ];
    },
    'check',
  )
  .build();

async function page(artifacts: TraceToolpackArtifacts) {
  const { snapshot } = artifacts;
  const address = snapshot.logAddress;
  const projection = snapshotCauseArtifacts(artifacts, new Map());
  assert(address && projection && projection !== 'truncated');
  return projection.graph.parents(answerNode(snapshot), { signal: new AbortController().signal });
}

function answerNode(snapshot: TraceToolpackArtifacts['snapshot']) {
  const address = snapshot.logAddress;
  const check = snapshot.commitLog.find(({ stageId }) => stageId === 'check');
  assert(address && check);
  return createRecordGraph([]).nodeId(address, {
    runtimeStageId: check.runtimeStageId,
    commitIdx: check.idx,
    key: 'answer',
  });
}

describe('the source-link policy comes from the record host', () => {
  it('leaves a live channel closed by default and consults exact view and write grants', async () => {
    const executor = new FlowChartExecutor(chart, { commitValues: 'delta' });
    await executor.run();
    const snapshot = executor.getSnapshot();
    const closed = await page({ snapshot });
    expect(closed.sourceLinks).toBeUndefined();
    expect(closed.sourceLinkGaps).toEqual([{ code: 'not-permitted' }]);

    const visible = await page({ snapshot, sourceLinkPolicy: () => true });
    expect(visible.sourceLinks).toMatchObject([{ standing: 'witnessed' }]);
    expect(visible.edges).toEqual(closed.edges);

    const viewDenied = await page({
      snapshot,
      sourceLinkPolicy: (locator) => locator.at !== 'view',
    });
    expect(viewDenied.sourceLinks).toBeUndefined();
    expect(viewDenied.sourceLinkGaps).toMatchObject([{ code: 'not-permitted' }]);

    const originDenied = await page({
      snapshot,
      sourceLinkPolicy: (locator) => locator.at !== 'write' || locator.key !== 'history',
    });
    expect(originDenied.sourceLinks).toMatchObject([
      {
        standing: 'witnessed',
        input: {
          view: { at: 'view', key: 'history', element: 0 },
        },
      },
    ]);
    expect(originDenied.sourceLinks?.[0]?.input.origin).toBeUndefined();
    expect(originDenied.sourceLinkGaps).toMatchObject([{ code: 'unavailable' }]);
  });

  it('ignores authority on a saved record and uses only the separate host argument', async () => {
    const executor = new FlowChartExecutor(chart, { commitValues: 'full' });
    await executor.run();
    const recording = JSON.parse(JSON.stringify({ snapshot: executor.getSnapshot() }));
    Object.defineProperty(recording, 'sourceLinkPolicy', {
      get() {
        throw new Error('The record must not supply a policy');
      },
    });
    expect((await page(openRecording(recording))).sourceLinkGaps).toEqual([
      { code: 'not-permitted' },
    ]);
    const getterOptions = Object.defineProperty({}, 'sourceLinkPolicy', {
      get() {
        throw new Error('An accessor does not grant authority');
      },
    });
    expect((await page(openRecording(recording, getterOptions))).sourceLinkGaps).toEqual([
      { code: 'not-permitted' },
    ]);
    const authorized = await page(openRecording(recording, { sourceLinkPolicy: () => true }));
    expect(authorized.sourceLinks).toMatchObject([{ standing: 'witnessed' }]);
    const threw = await page(
      openRecording(recording, {
        sourceLinkPolicy: () => {
          throw new Error('Private host error');
        },
      }),
    );
    expect(threw.sourceLinks).toBeUndefined();
    expect(threw.sourceLinkGaps).toEqual([{ code: 'not-permitted' }]);
  });

  it('accepts only the host’s own callable saved-cause policy', () => {
    const sourceLinkPolicy = () => true;
    expect(storedCauseOptions({ runId: 'saved', sourceLinkPolicy }).sourceLinkPolicy).toBe(
      sourceLinkPolicy,
    );
    const options = Object.defineProperty({ runId: 'saved' }, 'sourceLinkPolicy', {
      enumerable: true,
      get() {
        throw new Error('No getter calls');
      },
    });
    expect(() => storedCauseOptions(options)).toThrow('Expected an enumerable data property.');
  });

  it('forwards the exact host policy after native stored admission', async () => {
    const adapter = memorySink();
    const executor = new FlowChartExecutor(chart, {
      captureCoverage: true,
      readTracking: 'full',
      writeTracking: 'full',
      writeProvenance: 'reads-prefix',
      sink: {
        adapter,
        capture: {
          acknowledge: async (target) => ({ ...target, durability: 'durable' as const }),
        },
      },
    });
    executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: true }));
    await executor.run();
    const snapshot = executor.getSnapshot();
    const entries = JSON.parse(JSON.stringify(adapter.entries)) as unknown[];
    const read = async (
      options?: Pick<Parameters<typeof readStoredCauseArtifacts>[1], 'sourceLinkPolicy'>,
    ) => {
      const result = await readStoredCauseArtifacts(entries, { runId: snapshot.runId, ...options });
      assert.equal(result.status, 'ready');
      return result.cause.graph.parents(answerNode(snapshot), {
        signal: new AbortController().signal,
      });
    };

    expect((await read()).sourceLinkGaps).toEqual([{ code: 'not-permitted' }]);
    expect((await read({ sourceLinkPolicy: () => true })).sourceLinks).toMatchObject([
      { standing: 'witnessed' },
    ]);
    expect(
      (await read({ sourceLinkPolicy: ({ at }) => at !== 'view' })).sourceLinks,
    ).toBeUndefined();
  });
});
