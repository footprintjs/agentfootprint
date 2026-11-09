import { describe, expect, it } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { controlDepRecorder, readStoredCapture } from 'footprintjs/trace';
import { memorySink } from 'foottrace/write';
import { run as runFileExample } from '../../../examples/features/112-closed-native-prefix-cause.js';
import { readStoredCauseArtifacts } from '../storedCause.js';
import { traceCauseTools } from '../causeTools.js';
import { callTraceTool, traceToolpack } from '../traceToolpack.js';
import {
  noteData,
  rehashStoredFixture,
  requireStoredHistory,
  storedCauseFixture,
} from '../../../test/trace-toolpack/storedCauseFixtures.js';

describe('saved failed native prefixes', () => {
  it('queries a real file after its adapter durably acknowledges the failed prefix', async () => {
    const result = await runFileExample();
    expect(result.modelCalls).toBe(0);
    expect(result).toHaveProperty('originalErrorPreserved', true);
    if (!('root' in result)) throw Error('Expected an admitted file history.');
    expect(result.admission.native.closedPrefix?.boundary).toBe('failed');
    expect(result.root.finding.rootCause).toEqual(expect.any(String));
    expect(result.root.storage.status).toBe('adapter-acknowledged-history');
    expect(result.impact.finding.confidence).toBe('complete');
  });

  it('localizes one recorded failed invocation without claiming its physical cause', async () => {
    const original = Error('PRIVATE_NATIVE_FAILURE');
    const sink = memorySink();
    const chart = flowChart(
      'Reject request',
      () => {
        throw original;
      },
      'reject',
    )
      .setLogger({ info() {}, log() {}, debug() {}, warn() {}, error() {} })
      .build();
    const executor = new FlowChartExecutor(chart, {
      captureCoverage: true,
      captureExtent: true,
      captureClosure: true,
      readSources: true,
      readTracking: 'full',
      writeTracking: 'full',
      writeProvenance: 'reads-prefix',
      sink: {
        adapter: sink,
        capture: { acknowledge: async (target) => ({ ...target, durability: 'durable' }) },
      },
    });
    executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: true }));
    await expect(executor.run()).rejects.toBe(original);
    const cut = executor.getClosedCapture();
    expect(cut.status).toBe('closed');
    if (cut.status !== 'closed') throw Error('expected a closed native prefix');
    expect(cut.record.closure.selectedFailure?.attemptId).toBe('reject#0@1');
    const entries = JSON.parse(JSON.stringify(sink.entries)) as unknown[];
    const reopened = await readStoredCapture(entries, { runId: cut.record.closure.runId });
    expect(reopened.status).toBe('acknowledged');
    const admitted = await readStoredCauseArtifacts(entries, { runId: cut.record.closure.runId });
    if (admitted.status !== 'ready') throw Error(`unexpected ${admitted.reason}`);
    const tools = traceCauseTools(admitted.cause);
    const listed = JSON.parse(await callTraceTool(tools, 'attention_list'));
    expect(listed.finding.nodes).toHaveLength(1);
    const nodeId = listed.finding.nodes[0].nodeId as string;
    const cause = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    expect(cause.capture.status).toBe('admitted');
    expect(cause.finding.rootCause, JSON.stringify(cause)).toBe(nodeId);
    expect(cause.finding.path).toEqual([nodeId]);
    expect(cause.finding.confidence).toBe('complete');
    expect(cause.interpretation).toContain('recorded dependency root');
    expect(cause.interpretation).toContain('do not establish a semantic or service-internal cause');
    const impact = JSON.parse(await callTraceTool(tools, 'impact', { nodeId }));
    expect(impact.finding.confidence).toBe('complete');
    expect(impact.finding.nodes).toEqual([]);
    expect(JSON.stringify([listed, cause, impact])).not.toContain('PRIVATE_NATIVE_FAILURE');
    const copied = JSON.parse(
      await callTraceTool(traceCauseTools({ ...admitted.cause }), 'root_cause', { nodeId }),
    );
    expect(copied.gaps).toEqual([{ code: 'invalid-data', evidence: [] }]);
    const limited = JSON.parse(
      await callTraceTool(traceCauseTools(admitted.cause, { maxChars: 512 }), 'root_cause', {
        nodeId,
      }),
    );
    expect(limited.confidence).toBe('incomplete');
    expect(limited).not.toHaveProperty('finding');
    expect(JSON.stringify(limited)).not.toContain('rootCause');
  });

  it.each([false, true])(
    'admits producer-validated failed evidence, exact sources %s',
    async (readSources) => {
      const fixture = await storedCauseFixture({ fail: true, closedCapture: true, readSources });
      const producer = await requireStoredHistory(fixture.entries, fixture.runId);
      expect(producer.capture.boundary.status).toBe('failed');
      expect((producer as any).closure).toMatchObject({ boundary: 'failed', status: 'closed' });
      const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') throw Error('expected admitted history');
      expect(result.cause.admission.native).toMatchObject({
        status: 'admitted',
        reason: 'captured-root-log',
        closedPrefix: {
          version: 1,
          policy: 'native-root-prefix-v1',
          scope: 'root-log',
          boundary: 'failed',
          selectedFailure: {
            kind: 'invocation',
            runId: fixture.runId,
            runtimeStageId: 'prepare#2',
            attemptId: 'prepare#2@1',
          },
        },
      });
      const listed = JSON.parse(
        await callTraceTool(traceCauseTools(result.cause), 'attention_list'),
      );
      expect(listed.capture.status).toBe('admitted');
      expect(listed.capture.closedPrefix.boundary).toBe('failed');
      expect(listed.capture.closedPrefix.limitations).toContain('external-work-not-attested');
      expect(listed.interpretation).toContain('failed');
      expect(listed.interpretation).toContain('prefix');
      expect(JSON.stringify(result.cause.admission)).not.toContain('PRIVATE_CAPTURE_FIXTURE_ERROR');
    },
  );

  it('never transfers saved closure authority onto a live snapshot', async () => {
    const fixture = await storedCauseFixture({ fail: true, closedCapture: true });
    const history = await requireStoredHistory(fixture.entries, fixture.runId);
    const live = { ...fixture.snapshot, closure: (history as any).closure };
    const listed = JSON.parse(
      await callTraceTool(traceToolpack({ snapshot: live }), 'attention_list'),
    );
    expect(listed.capture).toMatchObject({ status: 'incomplete', reason: 'run-not-completed' });
    expect(listed.capture).not.toHaveProperty('closedPrefix');
  });

  it('keeps older failed histories without a closure incomplete', async () => {
    const fixture = await storedCauseFixture({ fail: true });
    const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    expect(result.status).toBe('ready');
    if (result.status !== 'ready') throw Error('expected incomplete graph');
    expect(result.cause.admission.native).toMatchObject({
      status: 'incomplete',
      reason: 'run-not-completed',
    });
    expect(result.cause.admission.native).not.toHaveProperty('closedPrefix');
  });

  it.each(['readTracking', 'withoutControl'] as const)(
    'does not let closure replace required %s evidence',
    async (missing) => {
      const fixture = await storedCauseFixture({
        fail: true,
        closedCapture: true,
        ...(missing === 'readTracking' ? { readTracking: 'off' } : { withoutControl: true }),
      });
      const result = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
      expect(result.status).toBe('ready');
      if (result.status !== 'ready') throw Error('expected incomplete graph');
      expect(result.cause.admission.native.status).toBe('incomplete');
    },
  );

  it.each(['run', 'attempt', 'extent', 'policy'] as const)(
    'refuses a rehashed contradictory %s closure',
    async (fault) => {
      const fixture = await storedCauseFixture({ fail: true, closedCapture: true });
      const original = await requireStoredHistory(fixture.entries, fixture.runId);
      const payload = noteData(fixture.entries, 'capture-history');
      const closure = payload.closure as any;
      if (fault === 'run') closure.runId = 'another-run';
      if (fault === 'attempt') closure.selectedFailure.attemptId = 'prepare#2@2';
      if (fault === 'extent') closure.commits.to--;
      if (fault === 'policy') closure.policy = 'future-policy';
      await rehashStoredFixture(fixture.entries, original);
      expect(await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId })).toEqual({
        status: 'unknown',
        reason: 'stored-admission',
      });
    },
  );
});
