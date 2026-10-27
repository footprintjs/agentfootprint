import type { RuntimeSnapshot } from 'footprintjs';
import type { CauseGraph } from 'foottrace/cause';
import { createRecordGraph } from 'foottrace/cause';
import { describe, expect, it } from 'vitest';
import { readStoredCauseArtifacts } from '../../src/trace-toolpack/storedCause.js';
import { traceCauseTools } from '../../src/trace-toolpack/causeTools.js';
import { callTraceTool, traceToolpack } from '../../src/trace-toolpack/traceToolpack.js';
import legacyV2 from './fixtures/public-v2-no-ownership.json';
import {
  noteData,
  rehashStoredFixture,
  requireStoredHistory,
  storedCauseFixture,
} from './storedCauseFixtures.js';

const OPERATIONS = ['attention_list', 'root_cause', 'impact'] as const;

async function ready(options: Parameters<typeof storedCauseFixture>[0] = {}) {
  const fixture = await storedCauseFixture(options);
  const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
  expect(result.status, JSON.stringify(result)).toBe('ready');
  if (result.status !== 'ready') throw Error('fixture cause not ready');
  return { ...fixture, cause: result.cause };
}

function question(snapshot: RuntimeSnapshot) {
  const bundle = snapshot.commitLog.find((entry) => entry.stageId === 'choose');
  if (!bundle) throw Error('fixture selected commit missing');
  return {
    nodeId: createRecordGraph([]).nodeId(snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
      commitIdx: snapshot.commitLog.indexOf(bundle),
      key: 'decision',
    }),
  };
}

describe('saved cause: public producer evidence', () => {
  it('matches canonical memory findings in all three operations after a real JSON storage round trip', async () => {
    const fixture = await ready();
    const memory = traceToolpack({ snapshot: fixture.snapshot });
    const saved = traceCauseTools(fixture.cause);
    expect(saved.map((tool) => tool.schema.name)).toEqual(OPERATIONS);
    for (const operation of OPERATIONS) {
      const args = operation === 'attention_list' ? {} : question(fixture.snapshot);
      const memoryAnswer = JSON.parse(await callTraceTool(memory, operation, args));
      const savedAnswer = JSON.parse(await callTraceTool(saved, operation, args));
      expect(savedAnswer.finding, operation).toEqual(memoryAnswer.finding);
      expect(savedAnswer.capture.persistence).toBe('memory-only');
      expect(JSON.stringify(savedAnswer)).not.toContain('PRIVATE_CAPTURE_FIXTURE_ERROR');
    }
    expect(fixture.cause.admission).toMatchObject({
      native: { status: 'admitted', persistence: 'memory-only', version: 1 },
      storage: { status: 'adapter-acknowledged-history', scope: 'root-log' },
      readSources: 'not-collected',
    });
  });

  it('retains literal undefined-read and undefined-write sidecars without inventing values', async () => {
    const fixture = await ready({ missing: true });
    const history = await requireStoredHistory(fixture.entries, fixture.runId);
    for (const key of ['a.b', 'a/b', '0'])
      expect(
        history.absent!.some((path) => path.at(-2) === 'stageReads' && path.at(-1) === key),
      ).toBe(true);
    expect(
      history.absent!.some((path) => path.at(-2) === 'stageWrites' && path.at(-1) === 'unset'),
    ).toBe(true);
    const bundle = fixture.snapshot.commitLog.find((entry) => entry.stageId === 'missing');
    expect(bundle).toBeDefined();
    if (!bundle) throw Error('fixture missing write commit');
    const target = createRecordGraph([]).nodeId(fixture.snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
      commitIdx: fixture.snapshot.commitLog.indexOf(bundle),
      key: 'probe',
    });
    const answer = JSON.parse(
      await callTraceTool(traceCauseTools(fixture.cause), 'root_cause', { nodeId: target }),
    );
    expect(answer.finding.nodeId).toBe(target);
    expect(answer.finding.confidence).toBe('incomplete');
    expect(answer.finding.rootCause).toBeUndefined();
    expect(answer.finding.gaps).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: 'untracked-input' })]),
    );
    expect(answer.finding.gaps.some((gap: { code: string }) => gap.code === 'invalid-data')).toBe(
      false,
    );
  });

  it.each(['a.b', 'a/b', '0'])(
    'projects the otherwise omitted read-only fact for literal key %s',
    async (key) => {
      const fixture = await ready({ readOnlyMissing: true });
      const index = ['a.b', 'a/b', '0'].indexOf(key);
      const bundle = fixture.snapshot.commitLog.find(
        (entry) => entry.stageId === `missing-read-${index}`,
      );
      expect(bundle).toBeDefined();
      if (!bundle) throw Error('fixture missing read-only commit');
      expect(bundle.trace).toEqual([]); // Per-write readKeys cannot make this test pass by accident.
      const target = createRecordGraph([]).nodeId(fixture.snapshot.logAddress!, {
        runtimeStageId: bundle.runtimeStageId,
        commitIdx: fixture.snapshot.commitLog.indexOf(bundle),
      });
      const discovered = await fixture.cause.graph.roots!({ signal: new AbortController().signal });
      expect(discovered).toContain(target);
      const answer = JSON.parse(
        await callTraceTool(traceCauseTools(fixture.cause), 'root_cause', { nodeId: target }),
      );
      expect(answer.finding.nodeId).toBe(target);
      expect(answer.finding.gaps).toEqual(
        expect.arrayContaining([expect.objectContaining({ code: 'untracked-input' })]),
      );
      expect(answer.finding.gaps.some((gap: { code: string }) => gap.code === 'invalid-data')).toBe(
        false,
      );
      expect(answer.finding.confidence).toBe('incomplete');
      expect(answer.finding.rootCause).toBeUndefined();
    },
  );

  it('leaves the public legacy v2 packet without attempt witnesses unknown', async () => {
    const fixture = legacyV2;
    const history = await requireStoredHistory(fixture.entries, fixture.runId);
    expect(history.capture.version).toBe(2);
    expect(history.readSources).toBeDefined();
    expect(history.commitLog).toHaveLength(2);
    expect(history.executionTree.attempts).toBeUndefined();
    expect(history.executionTree.next?.attempts).toBeUndefined();
    expect(history.executionTree.next?.readSourceCounts).toBeDefined();
    expect(history.readSources?.record?.occurrences.length).toBeGreaterThan(0);
    expect(
      history.readSources?.record?.occurrences.every((read) => read.attemptId === undefined),
    ).toBe(true);
    const answer = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    expect(answer).toEqual({ status: 'unknown', reason: 'source-ownership-unproven' });
    expect(answer).not.toHaveProperty('cause');
  });

  it('admits public native sources only with the newly retained producer ownership witness', async () => {
    const fixture = await storedCauseFixture({ readSources: true, plain: true });
    const history = await requireStoredHistory(fixture.entries, fixture.runId);
    expect(history.capture.version).toBe(2);
    expect(history.capture.persistence).toBe('memory-only');
    expect(history.readSources).toBeDefined();
    expect(history.commitLog).toHaveLength(2);
    expect(history.executionTree.next?.readSourceCounts).toBeDefined();
    expect(history.readSources?.record?.occurrences.length).toBeGreaterThan(0);
    expect(history.readSources?.version).toBe(2);
    const answer = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    expect(answer.status).toBe('ready');
    if (answer.status === 'ready') {
      expect(answer.cause.admission.native.version).toBe(2);
      expect(answer.cause.admission.readSources).toBe('captured');
    }
  });

  it.each([
    ['reads disabled', { readTracking: 'off' as const }],
    ['control evidence absent', { withoutControl: true }],
    ['run failed', { fail: true }],
  ])('never promotes %s through a valid storage receipt', async (_label, options) => {
    const fixture = await storedCauseFixture(options);
    const admitted = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    if (admitted.status === 'unknown') {
      expect(admitted).not.toHaveProperty('cause');
    } else {
      expect(admitted.cause.admission.native.status).toBe('incomplete');
      const answer = JSON.parse(
        await callTraceTool(
          traceCauseTools(admitted.cause),
          'root_cause',
          question(fixture.snapshot),
        ),
      );
      expect(answer.finding?.rootCause).toBeUndefined();
      expect(answer.finding?.confidence ?? answer.confidence).toBe('incomplete');
    }
  });

  it.each([
    'receipt missing',
    'receipt duplicated',
    'commit missing',
    'changed history',
    'changed omitted read',
  ])('uses the real public reader to refuse %s', async (attack) => {
    const fixture = await storedCauseFixture({ missing: true });
    let entries = fixture.entries;
    const isReceipt = (entry: unknown) => (entry as { note?: string }).note === 'capture-receipt';
    if (attack === 'receipt missing') entries = entries.filter((entry) => !isReceipt(entry));
    if (attack === 'receipt duplicated') entries = [...entries, entries.find(isReceipt)];
    if (attack === 'commit missing')
      entries = entries.filter((entry) => (entry as { kind?: string }).kind !== 'commit');
    if (attack === 'changed history') noteData(entries, 'capture-history').executionTree = {};
    if (attack === 'changed omitted read')
      (noteData(entries, 'capture-history').absent as string[][])[0]!.push('injected');
    const result = await readStoredCauseArtifacts(entries, { runId: fixture.runId });
    expect(result.status).toBe('unknown');
    expect(result).not.toHaveProperty('cause');
  });

  it('does not select another run or treat an ordinary closed stream as storage assurance', async () => {
    const fixture = await storedCauseFixture();
    expect((await readStoredCauseArtifacts(fixture.entries, { runId: 'other-run' })).status).toBe(
      'unknown',
    );
    const noCapture = await storedCauseFixture({ capture: false });
    expect(
      (await readStoredCauseArtifacts(noCapture.entries, { runId: noCapture.runId })).status,
    ).toBe('unknown');
  });

  it('rejects a history accessor without executing it or returning its private text', async () => {
    const fixture = await storedCauseFixture();
    let getters = 0;
    Object.defineProperty(noteData(fixture.entries, 'capture-history'), 'executionTree', {
      enumerable: true,
      get() {
        getters++;
        throw Error('PRIVATE_HISTORY_GETTER');
      },
    });
    const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    expect(result.status).toBe('unknown');
    expect(getters).toBe(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_HISTORY_GETTER');
  });

  it.each(['cycle', 'toJSON'] as const)(
    'refuses hostile %s history without running embedded serialization code',
    async (attack) => {
      const fixture = await storedCauseFixture();
      const tree = noteData(fixture.entries, 'capture-history').executionTree as Record<
        string,
        unknown
      >;
      let calls = 0;
      if (attack === 'cycle') tree.next = tree;
      else
        tree.toJSON = () => {
          calls++;
          throw Error('PRIVATE_SERIALIZER');
        };
      const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
      expect(result.status).toBe('unknown');
      expect(result).not.toHaveProperty('cause');
      expect(calls).toBe(0);
      expect(JSON.stringify(result)).not.toContain('PRIVATE_SERIALIZER');
    },
  );

  it('does not let a root receipt select a child scope', async () => {
    const fixture = await storedCauseFixture();
    const options = { runId: fixture.runId, drillPath: ['child#1'] };
    expect(await readStoredCauseArtifacts(fixture.entries, options)).toEqual({
      status: 'unknown',
      reason: 'invalid-data',
    });
  });
});

describe('saved cause: independently rechecked security boundaries', () => {
  const malformedViews = (['stageReads', 'stageWrites'] as const).flatMap((field) =>
    [
      { value: null, label: 'null' },
      { value: [], label: 'array' },
      { value: 42, label: 'number' },
    ].map(({ value, label }) => ({ field, value, label })),
  );

  it.each(malformedViews)(
    'refuses rehashed $field=$label even when the public producer reader acknowledges it',
    async ({ field, value }) => {
      const fixture = await storedCauseFixture();
      const original = await requireStoredHistory(fixture.entries, fixture.runId);
      const tree = noteData(fixture.entries, 'capture-history').executionTree as Record<
        string,
        unknown
      >;
      tree[field] = value;
      await rehashStoredFixture(fixture.entries, original);
      // The producer reader validates persistence, not the cause projection's retained views.
      expect(await requireStoredHistory(fixture.entries, fixture.runId)).toBeDefined();
      const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
      expect(result.status).toBe('unknown');
      expect(result).not.toHaveProperty('cause');
    },
  );

  it('refuses a billion-position commit gap from a tiny stored input', async () => {
    const fixture = await storedCauseFixture();
    const commit = fixture.entries.find(
      (entry) => (entry as { kind?: string }).kind === 'commit',
    ) as {
      bundle: { idx: number };
    };
    const closed = fixture.entries.find(
      (entry) => (entry as { kind?: string }).kind === 'closed',
    ) as {
      commits: number;
    };
    commit.bundle.idx = 1_000_000_000;
    closed.commits = 1_000_000_001;
    expect(fixture.entries.length).toBeLessThan(20);
    const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    expect(result.status).toBe('unknown');
    expect(result).not.toHaveProperty('cause');
  });

  const excessiveLimits = [
    ['entries', 65_537],
    ['missingCommits', 4097],
    ['drillDepth', 65],
    ['addressLength', 2049],
    ['entries', Infinity],
    ['missingCommits', Infinity],
    ['drillDepth', Infinity],
    ['addressLength', Infinity],
  ] as const;

  it.each(excessiveLimits)(
    'refuses excessive reader limit %s=%s before reading',
    async (key, value) => {
      const fixture = await storedCauseFixture();
      let iterations = 0;
      const entries = {
        *[Symbol.iterator]() {
          iterations++;
          yield* fixture.entries;
        },
      };
      expect(
        await readStoredCauseArtifacts(entries, {
          runId: fixture.runId,
          readerLimits: { [key]: value },
        }),
      ).toEqual({ status: 'unknown', reason: 'invalid-data' });
      expect(iterations).toBe(0);
    },
  );

  it('accepts zero as an explicit reader ceiling while retaining unknown coverage', async () => {
    const fixture = await storedCauseFixture();
    const result = await readStoredCauseArtifacts(fixture.entries, {
      runId: fixture.runId,
      readerLimits: { entries: 0 },
    });
    expect(result.status).toBe('unknown');
    expect(result).not.toHaveProperty('cause');
    expect(result).not.toEqual({ status: 'unknown', reason: 'invalid-data' });
  });
});

describe('saved cause: exact factory authority', () => {
  it('freezes the graph surface and detaches the serving assessment from the original stored entries', async () => {
    const fixture = await ready();
    const tools = traceCauseTools(fixture.cause);
    const before = await callTraceTool(tools, 'root_cause', question(fixture.snapshot));
    expect(Object.isFrozen(fixture.cause)).toBe(true);
    expect(Object.isFrozen(fixture.cause.graph)).toBe(true);
    expect(Object.isFrozen(fixture.cause.admission)).toBe(true);
    noteData(fixture.entries, 'capture-history').capture = { version: 999 };
    noteData(fixture.entries, 'capture-history').executionTree = {};
    expect(await callTraceTool(tools, 'root_cause', question(fixture.snapshot))).toBe(before);
  });

  it.each(['spread', 'replaced graph', 'inherited claim', 'accessor claim'])(
    'rejects a %s before any query or metadata getter',
    async (attack) => {
      const fixture = await ready();
      let calls = 0;
      const graph: CauseGraph = {
        roots() {
          calls++;
          return [];
        },
        parents() {
          calls++;
          return { edges: [], complete: true };
        },
        children() {
          calls++;
          return { edges: [], complete: true };
        },
        attention() {
          calls++;
          return [];
        },
        gaps() {
          calls++;
          return [];
        },
      };
      let forged: { graph: CauseGraph; admission?: unknown };
      if (attack === 'spread') forged = { ...fixture.cause };
      else if (attack === 'replaced graph') forged = { ...fixture.cause, graph };
      else if (attack === 'inherited claim')
        forged = Object.defineProperty(Object.create(fixture.cause), 'graph', { value: graph });
      else {
        forged = { graph };
        Object.defineProperty(forged, 'admission', {
          enumerable: true,
          get() {
            calls++;
            throw Error('PRIVATE_ADMISSION_GETTER');
          },
        });
      }
      for (const operation of OPERATIONS) {
        const args = operation === 'attention_list' ? {} : { nodeId: 'untrusted' };
        const text = await callTraceTool(traceCauseTools(forged), operation, args);
        expect(JSON.parse(text).gaps).toEqual([{ code: 'invalid-data', evidence: [] }]);
        expect(text).not.toContain('PRIVATE_ADMISSION_GETTER');
      }
      expect(calls).toBe(0);
    },
  );

  it('rejects a saved-claim full toolpack before a snapshot getter can run', async () => {
    const fixture = await ready();
    let calls = 0;
    const bag = { cause: fixture.cause } as {
      cause: typeof fixture.cause;
      snapshot: RuntimeSnapshot;
    };
    Object.defineProperty(bag, 'snapshot', {
      get() {
        calls++;
        throw Error('PRIVATE_SNAPSHOT_GETTER');
      },
    });
    expect(() => traceToolpack(bag)).toThrow(TypeError);
    expect(calls).toBe(0);
  });

  it('refuses cancelled and undersized reader work without inventing a root', async () => {
    const fixture = await storedCauseFixture();
    const controller = new AbortController();
    controller.abort();
    expect(
      await readStoredCauseArtifacts(fixture.entries, {
        runId: fixture.runId,
        signal: controller.signal,
      }),
    ).toEqual({ status: 'unknown', reason: 'cancelled' });
    expect(
      (await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId, maxBytes: 64 }))
        .status,
    ).toBe('unknown');
    expect(
      (
        await readStoredCauseArtifacts(fixture.entries, {
          runId: fixture.runId,
          readerLimits: { entries: 1 },
        })
      ).status,
    ).toBe('unknown');
    const fixtureReady = await ready();
    const clippedText = await callTraceTool(
      traceCauseTools(fixtureReady.cause, { maxChars: 512 }),
      'root_cause',
      question(fixtureReady.snapshot),
    );
    const clipped = JSON.parse(clippedText);
    expect(clippedText.length).toBeLessThanOrEqual(512);
    expect(clipped.gaps).toEqual([{ code: 'truncated', evidence: [] }]);
    expect(clipped.finding?.rootCause).toBeUndefined();
  });
});

/** Byte fixtures captured from verified 11.0 before this implementation. */
const LEGACY_CAUSE_BYTES = {
  attention_list:
    '{"tool":"attention_list","mode":"recorded-evidence","finding":{"nodes":[],"confidence":"complete","gaps":[]},"interpretation":"Recorded attention within this query only. Cite the returned node and evidence IDs."}',
  root_cause:
    '{"tool":"root_cause","mode":"recorded-evidence","finding":{"nodeId":"symptom","attention":[],"rootCause":"root","path":["symptom","root"],"alternatives":[],"impact":{"nodes":["affected"],"edges":[{"from":"symptom","to":"affected","kind":"data","attribution":"per-write","evidence":["record:edge"]}],"confidence":"complete","gaps":[]},"confidence":"complete","gaps":[]},"interpretation":"A unique recorded dependency root is supported. Cite its node ID and path; this is not proof of a provider-internal physical cause."}',
  impact:
    '{"tool":"impact","mode":"recorded-evidence","finding":{"nodes":["affected"],"edges":[{"from":"symptom","to":"affected","kind":"data","attribution":"per-write","evidence":["record:edge"]}],"confidence":"complete","gaps":[]},"interpretation":"Recorded reachable impact only; this does not prove effects in unrecorded services or unreached branches."}',
} as const;
const LEGACY_MEMORY_BYTES = {
  attention_list:
    '{"tool":"attention_list","mode":"recorded-evidence","finding":{"nodes":[],"confidence":"incomplete","gaps":[{"code":"unavailable","evidence":[]},{"code":"not-collected","evidence":[]}]},"capture":{"status":"incomplete","reason":"missing-attestation","scope":"root-log","persistence":"memory-only","readSources":"not-collected"},"interpretation":"Not sure, because coverage is incomplete. An absent mark is not proof of a healthy or reached step. Snapshot-only records have no engine-written capture/end attestation. This reader cannot prove a root cause from them, even after a normally finished run."}',
  root_cause:
    '{"tool":"root_cause","mode":"recorded-evidence","finding":{"nodeId":"symptom","attention":[],"path":[],"alternatives":[],"impact":{"nodes":[],"edges":[],"confidence":"incomplete","gaps":[{"code":"invalid-data","evidence":[]},{"code":"not-collected","nodeId":"symptom","evidence":[]}]},"confidence":"incomplete","gaps":[{"code":"invalid-data","evidence":[]},{"code":"not-collected","nodeId":"symptom","evidence":[]}]},"capture":{"status":"incomplete","reason":"missing-attestation","scope":"root-log","persistence":"memory-only","readSources":"not-collected"},"interpretation":"Not sure, because the returned gaps prevent a unique supported root. Alternatives are not confirmed causes. Snapshot-only records have no engine-written capture/end attestation. This reader cannot prove a root cause from them, even after a normally finished run."}',
  impact:
    '{"tool":"impact","mode":"recorded-evidence","finding":{"nodes":[],"edges":[],"confidence":"incomplete","gaps":[{"code":"invalid-data","evidence":[]},{"code":"not-collected","nodeId":"symptom","evidence":[]}]},"capture":{"status":"incomplete","reason":"missing-attestation","scope":"root-log","persistence":"memory-only","readSources":"not-collected"},"interpretation":"Not sure of the full impact, because the returned gaps limit the recorded forward slice. Snapshot-only records have no engine-written capture/end attestation. This reader cannot prove a root cause from them, even after a normally finished run."}',
} as const;

describe('saved cause: unchanged ordinary hosts', () => {
  it('retains the exact prior custom-graph and native-missing bytes', async () => {
    const edge = (nodeId: string) => ({
      nodeId,
      kind: 'data' as const,
      attribution: 'per-write' as const,
      evidence: ['record:edge'],
    });
    const graph: CauseGraph = {
      parents: (id) => ({ edges: id === 'symptom' ? [edge('root')] : [], complete: true }),
      children: (id) => ({ edges: id === 'symptom' ? [edge('affected')] : [], complete: true }),
      attention: (id) =>
        id === 'root'
          ? [{ kind: 'timeout', reason: 'TIMEOUT_RECORDED', evidence: ['record:attempt'] }]
          : [],
      gaps: () => [],
      roots: () => ['symptom'],
    };
    const snapshot = {
      runId: 'fixed-legacy-run',
      commitLog: [],
      executionTree: undefined,
      sharedState: {},
      commitValues: 'full',
    } as unknown as RuntimeSnapshot;
    const legacy = traceToolpack({ snapshot, cause: { graph } });
    const ordinary = traceToolpack({ snapshot });
    const graphOnly = traceCauseTools({ graph });
    for (const operation of OPERATIONS) {
      const args = operation === 'attention_list' ? {} : { nodeId: 'symptom' };
      expect(await callTraceTool(legacy, operation, args)).toBe(LEGACY_CAUSE_BYTES[operation]);
      expect(await callTraceTool(graphOnly, operation, args)).toBe(LEGACY_CAUSE_BYTES[operation]);
      expect(await callTraceTool(ordinary, operation, args)).toBe(LEGACY_MEMORY_BYTES[operation]);
    }
  });
});
