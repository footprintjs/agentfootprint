import type { CauseGraph } from 'foottrace/cause';
import type { RuntimeSnapshot } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import { causeLimits } from '../../src/trace-toolpack/causeLimits.js';
import { callTraceTool, traceToolpack } from '../../src/trace-toolpack/traceToolpack.js';

const snapshot = {
  commitLog: [],
  executionTree: undefined,
  sharedState: {},
} as unknown as RuntimeSnapshot;

describe('cause work policy', () => {
  it('uses a deterministic 80% backward cap, and leaves impact unrestricted within the total', () => {
    const limits = causeLimits();
    expect(limits.backward).toEqual({ maxNodes: 20, maxEdges: 80, maxCalls: 80 });
    expect(limits.impact).toBeUndefined();
  });

  it('keeps the remaining default dimensions when one backward dimension is overridden', () => {
    expect(causeLimits({ backward: { maxDepth: 2 } }).backward).toEqual({
      maxNodes: 20,
      maxEdges: 80,
      maxCalls: 80,
      maxDepth: 2,
    });
  });

  it.each([1, 2, 3])('never invents a zero allowance or extra work for total %i', (total) => {
    const limits = causeLimits({ maxNodes: total, maxEdges: total, maxCalls: total });
    expect(limits.backward.maxCalls).toBeGreaterThanOrEqual(1);
    expect(limits.backward.maxCalls).toBeLessThanOrEqual(total);
    expect(limits.maxCalls).toBe(total);
  });

  it('rejects a directional deadline and refuses accessors without executing them', () => {
    expect(() => causeLimits({ backward: { timeoutMs: 2 } } as never)).toThrow();
    let reads = 0;
    const backward = Object.defineProperty({}, 'maxCalls', {
      enumerable: true,
      get: () => {
        reads++;
        return 1;
      },
    });
    expect(() => causeLimits({ backward })).toThrow();
    expect(reads).toBe(0);
  });

  it('reserves capacity for a small impact when backward ancestry is wide', async () => {
    let calls = 0;
    const edge = (nodeId: string) => ({
      nodeId,
      kind: 'data' as const,
      attribution: 'per-write' as const,
      evidence: ['edge:proof'],
    });
    const graph: CauseGraph = {
      parents(id) {
        calls++;
        const n = Number(id.slice(1));
        return { edges: id.startsWith('a') && n < 60 ? [edge(`a${n + 1}`)] : [], complete: true };
      },
      children(id) {
        calls++;
        return { edges: id === 'a0' ? [edge('affected')] : [], complete: true };
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
    const result = JSON.parse(
      await callTraceTool(
        traceToolpack({ snapshot, cause: { graph } }, { cause: { maxDepth: 20 } }),
        'root_cause',
        { nodeId: 'a0' },
      ),
    );
    expect(result.finding.confidence).toBe('incomplete');
    expect(result.finding.rootCause).toBeUndefined();
    expect(result.finding.impact.confidence).toBe('complete');
    expect(result.finding.impact.nodes).toEqual(['affected']);
    expect(calls).toBeLessThanOrEqual(100);
  });

  it('bounds a never-settling graph call and aborts the same query signal', async () => {
    let aborted = false;
    let calls = 0;
    let callsAtAbort = 0;
    const graph: CauseGraph = {
      gaps(_id, context) {
        calls++;
        context.signal.addEventListener(
          'abort',
          () => {
            aborted = true;
            callsAtAbort = calls;
          },
          { once: true },
        );
        return new Promise(() => {});
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
    };
    const tools = traceToolpack({ snapshot, cause: { graph } }, { cause: { timeoutMs: 20 } });
    await callTraceTool(tools, 'attention_list', { nodeIds: [] });
    const result = JSON.parse(await callTraceTool(tools, 'root_cause', { nodeId: 'root' }));
    expect(aborted).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBe(callsAtAbort);
    expect(result.finding.confidence).toBe('incomplete');
    expect(result.finding.gaps.some((gap: { code: string }) => gap.code === 'timeout')).toBe(true);
  });
});
