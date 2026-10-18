import type { RuntimeSnapshot } from 'footprintjs';
import type { CauseGraph } from 'foottrace/cause';
import { describe, expect, it } from 'vitest';
import { callTraceTool, traceToolpack } from '../../src/trace-toolpack/traceToolpack.js';

const SECRET = 'PRIVATE-CUSTOMER-PAYMENT-MESSAGE';
const snapshot = {
  runId: 'captured-run',
  commitLog: [],
  executionTree: undefined,
  sharedState: { customer: SECRET },
  commitValues: 'delta',
} as unknown as RuntimeSnapshot;

function fixture() {
  let calls = 0;
  const edge = (nodeId: string) => ({
    nodeId,
    kind: 'data' as const,
    attribution: 'per-write' as const,
    evidence: ['proof:dependency'],
  });
  const graph: CauseGraph = {
    parents(id) {
      calls++;
      return { edges: id === 'symptom' ? [edge('root')] : [], complete: true };
    },
    children(id) {
      calls++;
      return { edges: id === 'symptom' ? [edge('affected')] : [], complete: true };
    },
    attention(id) {
      calls++;
      return id === 'root'
        ? [{ kind: 'timeout', reason: 'TIMEOUT_RECORDED', evidence: ['proof:attempt'] }]
        : [];
    },
    gaps() {
      calls++;
      return [];
    },
    roots() {
      calls++;
      return ['symptom'];
    },
  };
  return { graph, calls: () => calls, artifacts: { snapshot, cause: { graph } } };
}

describe('read-only cause tools', () => {
  it('mounts the three named public questions', () => {
    const names = traceToolpack(fixture().artifacts).map((tool) => tool.schema.name);
    expect(names).toEqual(expect.arrayContaining(['attention_list', 'root_cause', 'impact']));
  });

  it('returns the public reader finding and captured proof references, without payloads', async () => {
    const { artifacts } = fixture();
    const text = await callTraceTool(traceToolpack(artifacts), 'root_cause', { nodeId: 'symptom' });
    const result = JSON.parse(text);
    expect(result.mode).toBe('recorded-evidence');
    expect(result.finding.rootCause).toBe('root');
    expect(result.finding.path).toEqual(['symptom', 'root']);
    expect(text).not.toContain(SECRET);
  });

  it('serves impact separately and never relabels it as a physical provider cause', async () => {
    const { artifacts } = fixture();
    const text = await callTraceTool(traceToolpack(artifacts), 'impact', { nodeId: 'symptom' });
    const result = JSON.parse(text);
    expect(result.finding.nodes).toEqual(['affected']);
    expect(result.finding.confidence).toBe('complete');
    expect(result.finding).not.toHaveProperty('rootCause');
  });

  it('discovers attention through the same bounded graph', async () => {
    const { artifacts } = fixture();
    const result = JSON.parse(
      await callTraceTool(traceToolpack(artifacts), 'attention_list', { nodeIds: ['root'] }),
    );
    expect(result.finding.nodes[0].attention[0].evidence).toEqual(['proof:attempt']);
  });

  it('keeps a tiny total call limit, and reports incomplete instead of guessing', async () => {
    const { artifacts, calls } = fixture();
    const result = JSON.parse(
      await callTraceTool(traceToolpack(artifacts), 'root_cause', {
        nodeId: 'symptom',
        maxCalls: 1,
      }),
    );
    expect(calls()).toBeLessThanOrEqual(1);
    expect(result.finding.confidence).toBe('incomplete');
    expect(result.finding.rootCause).toBeUndefined();
    expect(result.finding.gaps.some((gap: { code: string }) => gap.code === 'call-limit')).toBe(
      true,
    );
  });

  it('refuses invalid direction options before any graph call', async () => {
    const { artifacts, calls } = fixture();
    const text = await callTraceTool(traceToolpack(artifacts), 'root_cause', {
      nodeId: 'symptom',
      backward: { timeoutMs: 50 },
    });
    expect(calls()).toBe(0);
    expect(text).not.toContain(SECRET);
  });

  it('turns a host rejection into a fixed gap without the exception message', async () => {
    const { artifacts } = fixture();
    artifacts.cause.graph.parents = () => {
      throw new Error(SECRET);
    };
    const text = await callTraceTool(traceToolpack(artifacts), 'root_cause', { nodeId: 'symptom' });
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text).finding.confidence).toBe('incomplete');
  });

  it('does not make a legacy record with absent capture look clean', async () => {
    const result = JSON.parse(await callTraceTool(traceToolpack({ snapshot }), 'attention_list'));
    expect(result.confidence ?? result.finding.confidence).toBe('incomplete');
    expect(JSON.stringify(result)).toContain('not-collected');
    expect(JSON.stringify(result)).not.toContain(SECRET);
  });

  it('names the local legacy projection size refusal instead of claiming capture was absent', async () => {
    const large = {
      ...snapshot,
      commitLog: Array.from({ length: 4097 }, () => ({
        runtimeStageId: 'oversized#0',
        trace: [],
        overwrite: {},
        updates: {},
      })),
    } as unknown as RuntimeSnapshot;
    const result = JSON.parse(
      await callTraceTool(traceToolpack({ snapshot: large }), 'attention_list'),
    );
    expect(result.confidence).toBe('incomplete');
    expect(result.gaps).toEqual([{ code: 'truncated', evidence: [] }]);
    expect(result.finding).toBeUndefined();
  });

  it.each([
    'not-checked',
    'not-collected',
    'no-match',
    'unavailable',
    'not-permitted',
    'stale',
    'unsupported',
  ] as const)(
    'preserves the recorded %s reason instead of inventing a check or flattening it',
    async (code) => {
      const { artifacts } = fixture();
      artifacts.cause.graph.gaps = () => [{ code, evidence: ['proof:missing'] }];
      const result = JSON.parse(
        await callTraceTool(traceToolpack(artifacts), 'root_cause', { nodeId: 'symptom' }),
      );
      expect(result.finding.rootCause).toBeUndefined();
      expect(result.finding.confidence).toBe('incomplete');
      expect(result.finding.gaps.some((gap: { code: string }) => gap.code === code)).toBe(true);
      expect(JSON.stringify(result)).not.toContain(SECRET);
    },
  );

  it('withholds an oversized proof with a named gap instead of clipping JSON', async () => {
    const { artifacts } = fixture();
    artifacts.cause.graph.attention = (id) =>
      id === 'root'
        ? [
            {
              kind: 'timeout',
              reason: 'TIMEOUT_RECORDED',
              evidence: Array.from({ length: 8 }, (_, i) => 'proof:' + 'x'.repeat(70) + i),
            },
          ]
        : [];
    const text = await callTraceTool(traceToolpack(artifacts), 'attention_list', {
      nodeIds: ['root'],
      maxChars: 512,
    });
    expect(text.length).toBeLessThanOrEqual(512);
    const result = JSON.parse(text);
    expect(result.confidence).toBe('incomplete');
    expect(result.gaps[0].code).toBe('truncated');
  });
});
