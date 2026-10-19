import { FlowChartExecutor, flowChart, type RuntimeSnapshot } from 'footprintjs';
import type { CauseGraph } from 'foottrace/cause';
import { describe, expect, it } from 'vitest';
import { callTraceTool, traceToolpack } from '../../src/trace-toolpack/traceToolpack.js';
import { causeResponse } from '../../src/trace-toolpack/causeResponse.js';
import { snapshotCauseArtifacts } from '../../src/trace-toolpack/causeSnapshot.js';

const snapshot = {
  runId: 'host-policy-run',
  commitLog: [],
  executionTree: undefined,
  sharedState: {},
} as unknown as RuntimeSnapshot;
const modelKnobs = {
  maxNodes: 100,
  maxDepth: 20,
  maxEdges: 1000,
  maxCalls: 1000,
  timeoutMs: 5000,
  maxChars: 16000,
  backward: { maxCalls: 1000 },
  impact: { maxCalls: 1000 },
};

function fixture() {
  const seen = new Set<string>();
  let calls = 0;
  const graph: CauseGraph = {
    roots: () => ['start'],
    parents: () => ({ edges: [], complete: true }),
    children(id) {
      calls++;
      return {
        complete: true,
        edges:
          id === 'start'
            ? Array.from({ length: 29 }, (_, i) => ({
                nodeId: `child-${i}`,
                kind: 'data' as const,
                attribution: 'per-write' as const,
                evidence: ['proof:edge'],
              }))
            : [],
      };
    },
    attention(id) {
      calls++;
      seen.add(id);
      return [];
    },
    gaps() {
      calls++;
      return [];
    },
  };
  return { artifacts: { snapshot, cause: { graph } }, seen, calls: () => calls };
}

describe('cause resource policy belongs to the host', () => {
  it.each(['attention_list', 'root_cause', 'impact'])(
    '%s advertises only scoped IDs, with no resource controls',
    (name) => {
      const tool = traceToolpack(fixture().artifacts).find((t) => t.schema.name === name)!;
      expect(Object.keys(tool.schema.inputSchema.properties ?? {})).toEqual([
        name === 'attention_list' ? 'nodeIds' : 'nodeId',
      ]);
    },
  );

  it('cannot raise a ten-node host ceiling even through a direct execute call', async () => {
    const { artifacts, seen } = fixture();
    const tools = traceToolpack(artifacts, { cause: { maxNodes: 10, timeoutMs: 500 } });
    const tool = tools.find((t) => t.schema.name === 'attention_list')!;
    await tool.execute({ nodeIds: [] }, {} as never); // Load before the timed graph query.
    const result = JSON.parse(
      String(await tool.execute({ nodeIds: ['start'], ...modelKnobs }, {} as never)),
    );
    expect(seen.size).toBeLessThanOrEqual(10);
    expect(result.finding.confidence).toBe('incomplete');
    expect(result.finding.gaps.some((g: { code: string }) => g.code === 'node-limit')).toBe(true);
  });

  it('cannot raise a one-call host ceiling through direct execute either', async () => {
    const { artifacts, calls } = fixture();
    const tools = traceToolpack(artifacts, { cause: { maxCalls: 1 } });
    const tool = tools.find((t) => t.schema.name === 'attention_list')!;
    await tool.execute({ nodeIds: ['start'], ...modelKnobs }, {} as never);
    expect(calls()).toBeLessThanOrEqual(1);
  });

  it.each(Object.entries(modelKnobs))(
    'rejects a model-supplied %s before querying',
    async (key, value) => {
      const { artifacts, calls } = fixture();
      await callTraceTool(traceToolpack(artifacts), 'root_cause', {
        nodeId: 'start',
        [key]: value,
      });
      expect(calls()).toBe(0);
    },
  );

  it('explains why snapshot-only evidence cannot prove a root on missing-node answers', async () => {
    const result = JSON.parse(
      await callTraceTool(traceToolpack({ snapshot }), 'root_cause', { nodeId: 'unknown' }),
    );
    expect(result.finding?.rootCause).toBeUndefined();
    expect(result.interpretation).toContain('capture/end attestation');
    expect(result.interpretation).toContain('cannot prove a root cause');
    expect(result.interpretation).toContain('normally finished run');
  });

  it('keeps that limitation after a real fully tracked run finishes normally', async () => {
    const chart = flowChart<{ value: number }>(
      'Recorded step',
      (scope) => {
        scope.value = 3;
      },
      'recorded',
    ).build();
    const executor = new FlowChartExecutor(chart, {
      readTracking: 'full',
      writeTracking: 'full',
      commitValues: 'full',
      writeProvenance: 'reads-prefix',
    });
    await executor.run();
    const completed = executor.getSnapshot();
    expect(completed.commitLog.length).toBeGreaterThan(0);
    const projection = snapshotCauseArtifacts({ snapshot: completed }, new Map());
    if (projection === undefined || projection === 'truncated') throw new Error('missing fixture');
    const ids = await projection.graph.roots!({ signal: new AbortController().signal });
    expect(ids.length).toBeGreaterThan(0);
    const result = JSON.parse(
      await callTraceTool(traceToolpack({ snapshot: completed }), 'root_cause', { nodeId: ids[0] }),
    );
    expect(result.finding.rootCause).toBeUndefined();
    expect(result.finding.confidence).toBe('incomplete');
    expect(result.interpretation).toContain('capture/end attestation');
  });

  it('keeps the snapshot warning inside the smallest host output ceiling on overflow', () => {
    const response = causeResponse(
      'root_cause',
      { proof: 'x'.repeat(1000) },
      'Recorded.',
      512,
      true,
    );
    expect(response.length).toBeLessThanOrEqual(512);
    expect(JSON.parse(response).gaps[0].code).toBe('truncated');
    expect(JSON.parse(response).interpretation).toContain('capture/end attestation');
  });
});
