import { flowChart, FlowChartExecutor, type RuntimeSnapshot } from 'footprintjs';
import { controlDepRecorder } from 'footprintjs/trace';
import { describe, expect, it } from 'vitest';
import { traceToolpack, callTraceTool } from '../../src/trace-toolpack/traceToolpack.js';
import { createRecordGraph } from 'foottrace/cause';

/** Real engine records; no fabricated capture note, custom graph, provider or model. */
async function recorded() {
  let attempt = 0;
  const chart = flowChart<{ quote: number; decision: number; preparation: number }>(
    'Recover',
    (scope) => {
      if (++attempt === 1) throw new Error('PRIVATE_SYNTHETIC_PROVIDER_ERROR');
      scope.quote = 4;
    },
    'quote',
  )
    .retry({ attempts: 2 })
    .addFunction(
      'Choose',
      (scope) => {
        scope.decision = scope.quote;
      },
      'choose',
    )
    .addFunction(
      'Prepare',
      (scope) => {
        scope.preparation = scope.decision;
      },
      'prepare',
    )
    .build();
  const executor = new FlowChartExecutor(chart, {
    captureCoverage: true,
    readTracking: 'full',
    writeTracking: 'full',
    writeProvenance: 'reads-prefix',
  });
  executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: true }));
  await executor.run();
  return executor.getSnapshot();
}

async function discover(snapshot: RuntimeSnapshot) {
  const tools = traceToolpack({ snapshot });
  const listed = JSON.parse(await callTraceTool(tools, 'attention_list'));
  const root = listed.finding.nodes.find((node: { attention: unknown[] }) => node.attention.length);
  expect(root).toBeDefined();
  return { tools, listed, nodeId: root.nodeId ?? root.id };
}

describe('native capture-note admission', () => {
  it('finds a real recorded root and impact with no host graph or control callback', async () => {
    const snapshot = await recorded();
    const { tools, listed, nodeId } = await discover(snapshot);
    expect(listed.capture.status).toBe('admitted');
    const result = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    expect(result.finding.rootCause, JSON.stringify(result)).toBe(nodeId);
    expect(result.finding.confidence, JSON.stringify(result)).toBe('complete');
    expect(result.capture).toMatchObject({ status: 'admitted', reason: 'captured-root-log' });
    expect(result.interpretation).not.toContain('cannot prove a root cause');
    const impact = JSON.parse(await callTraceTool(tools, 'impact', { nodeId }));
    expect(impact.finding.confidence).toBe('complete');
    expect(impact.finding.nodes.length).toBeGreaterThan(0);
    expect(JSON.stringify(result)).not.toContain('PRIVATE_SYNTHETIC_PROVIDER_ERROR');
    expect(snapshot.capture?.channels.readSources).toBe('not-collected');
  });

  it('admits a JSON round trip as an in-memory claim, never as durable delivery proof', async () => {
    const { tools, nodeId } = await discover(JSON.parse(JSON.stringify(await recorded())));
    const result = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    expect(result.finding.rootCause, JSON.stringify(result)).toBe(nodeId);
    expect(result.capture.persistence).toBe('memory-only');
    expect(result.capture.readSources).toBe('not-collected');
  });

  it('backtracks a dependent write through the public graph without inferring semantic derivation', async () => {
    const snapshot = await recorded();
    const graph = createRecordGraph([]);
    const target = graph.nodeId(snapshot.logAddress!, {
      runtimeStageId: 'choose#1',
      commitIdx: 1,
      key: 'decision',
    });
    const result = JSON.parse(
      await callTraceTool(traceToolpack({ snapshot }), 'root_cause', { nodeId: target }),
    );
    expect(result.finding.rootCause).toBeDefined();
    expect(result.finding.path.length).toBeGreaterThan(1);
    expect(result.interpretation).toContain('not proof of a provider-internal physical cause');
  });

  it('uses captured control data instead of executing a host callback to invent missing facts', async () => {
    const snapshot = await recorded();
    const { nodeId } = await discover(snapshot);
    let calls = 0;
    const tools = traceToolpack({
      snapshot,
      controlDeps: () => {
        calls++;
        throw Error('PRIVATE');
      },
    });
    const result = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    expect(result.finding.rootCause).toBeDefined();
    expect(calls).toBe(0);
  });

  it.each(['failed', 'cancelled', 'paused', 'running'])(
    'does not admit a %s boundary',
    async (status) => {
      const snapshot = structuredClone(await recorded());
      (snapshot.capture!.boundary as { status: string }).status = status;
      const { tools, nodeId } = await discover(snapshot);
      const result = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
      expect(result.finding.rootCause).toBeUndefined();
      expect(result.capture.reason).toBe('run-not-completed');
    },
  );

  const refusals: [string, (snapshot: any) => void, string][] = [
    [
      'legacy',
      (s) => {
        delete s.capture;
      },
      'missing-attestation',
    ],
    [
      'wrong run',
      (s) => {
        s.capture.runId = 'other-run';
      },
      'run-mismatch',
    ],
    [
      'wrong log',
      (s) => {
        s.capture.logAddress.logRunId = 'other-log';
      },
      'scope-not-covered',
    ],
    [
      'child',
      (s) => {
        s.logAddress.drillPath = ['child#1'];
      },
      'scope-not-covered',
    ],
    [
      'old leg',
      (s) => {
        s.capture.commits.from = 1;
      },
      'incomplete-extent',
    ],
    [
      'trimmed log',
      (s) => {
        s.capture.commits.to++;
      },
      'incomplete-extent',
    ],
    [
      'disabled reads',
      (s) => {
        s.capture.channels.reads = 'disabled';
      },
      'channel-not-captured',
    ],
    [
      'partial writes',
      (s) => {
        s.capture.channels.writes = 'partial';
      },
      'channel-not-captured',
    ],
    [
      'missing warnings',
      (s) => {
        s.capture.channels.attention = 'unknown';
      },
      'channel-not-captured',
    ],
    [
      'failed decisions',
      (s) => {
        s.capture.channels.control = 'failed';
      },
      'channel-not-captured',
    ],
    [
      'summary reads',
      (s) => {
        s.capture.modes.readTracking = 'summary';
      },
      'modes-not-supported',
    ],
    [
      'summary writes',
      (s) => {
        s.capture.modes.writeTracking = 'summary';
      },
      'modes-not-supported',
    ],
    [
      'step provenance',
      (s) => {
        s.capture.modes.writeProvenance = 'off';
      },
      'modes-not-supported',
    ],
    [
      'future note',
      (s) => {
        s.capture.version = 2;
      },
      'invalid-attestation',
    ],
    [
      'future limitation',
      (s) => {
        s.capture.limitations.push('future-limit');
      },
      'capture-limited',
    ],
    [
      'redacted',
      (s) => {
        s.capture.limitations.push('redacted-export');
      },
      'capture-limited',
    ],
    [
      'resumed',
      (s) => {
        s.capture.limitations.push('resumed-segment');
      },
      'capture-limited',
    ],
    [
      'durability invented',
      (s) => {
        s.capture.persistence = 'stored';
      },
      'invalid-attestation',
    ],
    [
      'no producer',
      (s) => {
        delete s.recorders;
      },
      'control-not-retained',
    ],
    [
      'stale producer',
      (s) => {
        s.recorders[0].capture.runId = 'other-run';
      },
      'control-not-retained',
    ],
    [
      'partial producer',
      (s) => {
        s.recorders[0].capture.control = 'partial';
      },
      'control-not-retained',
    ],
    [
      'no decisions map',
      (s) => {
        delete s.recorders[0].data.controlDeps;
      },
      'control-not-retained',
    ],
    [
      'two producers',
      (s) => {
        s.recorders.push(s.recorders[0]);
      },
      'control-not-retained',
    ],
    [
      'tree stripped',
      (s) => {
        s.executionTree.next = undefined;
      },
      'projection-incomplete',
    ],
  ];
  it.each(refusals)('keeps %s uncertain and names the reason', async (_name, mutate, reason) => {
    const snapshot = structuredClone(await recorded());
    mutate(snapshot);
    const { tools, nodeId } = await discover(snapshot);
    const result = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId }));
    expect(result.finding.rootCause).toBeUndefined();
    expect(result.finding.confidence).toBe('incomplete');
    expect(result.capture).toMatchObject({ status: 'incomplete', reason });
  });

  it('does not invoke or echo a capture accessor', async () => {
    let reads = 0;
    const snapshot = structuredClone(await recorded());
    Object.defineProperty(snapshot.capture, 'runId', {
      get() {
        reads++;
        throw Error('PRIVATE');
      },
    });
    const { tools, nodeId } = await discover(snapshot);
    const text = await callTraceTool(tools, 'root_cause', { nodeId });
    expect(reads).toBe(0);
    expect(text).not.toContain('PRIVATE');
    expect(JSON.parse(text).finding.rootCause).toBeUndefined();
  });

  it.each(['legacy', 'admitted', 'incomplete'] as const)(
    'keeps %s capture disclosures within the smallest output ceiling',
    async (kind) => {
      const snapshot = structuredClone(await recorded());
      if (kind === 'legacy') delete (snapshot as any).capture;
      if (kind === 'incomplete') (snapshot.capture!.channels as any).reads = 'partial';
      const { nodeId } = await discover(snapshot);
      const text = await callTraceTool(
        traceToolpack({ snapshot }, { cause: { maxChars: 512 } }),
        'root_cause',
        { nodeId },
      );
      expect(text.length).toBeLessThanOrEqual(512);
      expect(JSON.parse(text).finding?.rootCause).toBeUndefined();
      expect(JSON.parse(text).gaps[0].code).toBe('truncated');
    },
  );

  it('does not turn collected-empty attention into missing capture', async () => {
    const chart = flowChart(
      'Healthy',
      (scope) => {
        scope.value = 1;
      },
      'healthy',
    ).build();
    const executor = new FlowChartExecutor(chart, {
      captureCoverage: true,
      writeProvenance: 'reads-prefix',
    });
    executor.attachFlowRecorder(controlDepRecorder({ captureCoverage: true }));
    await executor.run();
    const result = JSON.parse(
      await callTraceTool(traceToolpack({ snapshot: executor.getSnapshot() }), 'attention_list'),
    );
    expect(result.finding.confidence, JSON.stringify(result)).toBe('complete');
    expect(result.finding.nodes).toEqual([]);
    expect(result.finding.gaps).toEqual([]);
  });

  it.each([
    [
      'missing modes',
      (s: any) => {
        delete s.capture.modes;
      },
    ],
    [
      'invalid modes',
      (s: any) => {
        s.capture.modes = null;
      },
    ],
    [
      'unknown value encoding',
      (s: any) => {
        s.capture.modes.commitValues = 'unknown';
      },
    ],
    [
      'mismatched encoding',
      (s: any) => {
        s.capture.modes.commitValues = 'delta';
      },
    ],
    [
      'unknown read versions',
      (s: any) => {
        s.capture.channels.readSources = 'captured';
      },
    ],
    [
      'duplicate limits',
      (s: any) => {
        s.capture.limitations[1] = s.capture.limitations[0];
      },
    ],
    [
      'non-array limits',
      (s: any) => {
        s.capture.limitations = {};
      },
    ],
    [
      'inherited note',
      (s: any) => {
        const n = s.capture;
        delete s.capture;
        Object.setPrototypeOf(s, { capture: n });
      },
    ],
    [
      'oversized producer list',
      (s: any) => {
        s.recorders = Array(33).fill(s.recorders[0]);
      },
    ],
    [
      'wrong producer type',
      (s: any) => {
        s.recorders[0].name = 'other';
      },
    ],
    [
      'producer without data',
      (s: any) => {
        delete s.recorders[0].data;
      },
    ],
    [
      'array control data',
      (s: any) => {
        s.recorders[0].data.controlDeps = [];
      },
    ],
    [
      'invalid control ID',
      (s: any) => {
        s.recorders[0].data.controlDeps = { child: { deciderId: 5 } };
      },
    ],
    [
      'control accessor',
      (s: any) => {
        Object.defineProperty(s.recorders[0].data, 'controlDeps', {
          get: () => {
            throw Error('PRIVATE');
          },
        });
      },
    ],
  ])('refuses %s without inventing completeness', async (_name, change) => {
    const snapshot = structuredClone(await recorded());
    change(snapshot);
    const { tools, nodeId } = await discover(snapshot);
    const text = await callTraceTool(tools, 'root_cause', { nodeId });
    const result = JSON.parse(text);
    expect(result.finding.rootCause).toBeUndefined();
    expect(result.capture.status).toBe('incomplete');
    expect(text).not.toContain('PRIVATE');
  });
});
