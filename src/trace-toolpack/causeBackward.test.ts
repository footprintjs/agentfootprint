import {
  attentionList,
  createRecordGraph,
  explain,
  type CauseGraph,
  type CauseResult,
} from 'foottrace/cause';
import { describe, expect, it, vi } from 'vitest';
import { flowChart, FlowChartExecutor } from 'footprintjs';
import { callTraceTool, traceToolpack } from './traceToolpack.js';
import { traceCauseTools } from './causeTools.js';
import { causeLimits } from './causeLimits.js';
import { readStoredCauseArtifacts } from './storedCause.js';
import { openSubflow } from './subflowRecords.js';
import { innerRunStore } from '../core/innerRunRecords.js';
import { storedCauseFixture } from '../../test/trace-toolpack/storedCauseFixtures.js';

// Instrument only the transport: every query still executes the actual public reader.
vi.mock('foottrace/cause', async (original) => {
  const actual = await original<typeof import('foottrace/cause')>();
  return { ...actual, explain: vi.fn(actual.explain), attentionList: vi.fn(actual.attentionList) };
});

function fixture(complete = true) {
  const address = { logRunId: 'backward-output', drillPath: [] };
  const graph = createRecordGraph([
    {
      address,
      commitLog: ['source', 'middle', 'target'].map((key, idx, keys) => ({
        idx,
        stage: key,
        stageId: key,
        runtimeStageId: `${key}#${idx}`,
        trace: [{ path: key, verb: 'set', readKeys: idx ? [keys[idx - 1]!] : [] }],
        overwrite: { [key]: 'PRIVATE-RECORDED-VALUE' },
        updates: {},
        redactedPaths: [],
      })),
      reads: { 'source#0': [], 'middle#1': ['source'], 'target#2': ['middle'] },
      controlDeps: {},
      attention: {
        'source#0': [
          { kind: 'timeout', reason: 'TIMEOUT_RECORDED', evidence: ['proof:source-timeout'] },
        ],
      },
      complete,
    },
  ]);
  const ids = ['source', 'middle', 'target'].map((key, commitIdx) =>
    graph.nodeId(address, { runtimeStageId: `${key}#${commitIdx}`, commitIdx, key }),
  );
  return { graph, root: ids[0]!, middle: ids[1]!, target: ids[2]! };
}

async function root(
  graph: CauseGraph,
  nodeId: string,
  options: Parameters<typeof traceCauseTools>[1] = {},
) {
  return JSON.parse(
    await callTraceTool(traceCauseTools({ graph }, options), 'root_cause', { nodeId }),
  );
}

describe('host-owned backward output', () => {
  it('requests backward output in exactly one root query, and never in impact or attention', async () => {
    const { graph, target } = fixture();
    const tools = traceCauseTools(
      { graph },
      { includeBackward: true, maxCalls: 12, backward: { maxCalls: 7 } },
    );
    vi.mocked(explain).mockClear();
    await callTraceTool(tools, 'root_cause', { nodeId: target });
    expect(explain).toHaveBeenCalledTimes(1);
    expect(vi.mocked(explain).mock.calls[0]![2]).toMatchObject({
      includeBackward: true,
      maxCalls: 12,
      backward: { maxCalls: 7 },
    });
    vi.mocked(explain).mockClear();
    await callTraceTool(tools, 'impact', { nodeId: target });
    expect(explain).toHaveBeenCalledTimes(1);
    expect(vi.mocked(explain).mock.calls[0]![2]).not.toHaveProperty('includeBackward');
    vi.mocked(explain).mockClear();
    vi.mocked(attentionList).mockClear();
    await callTraceTool(tools, 'attention_list', { nodeIds: [target] });
    expect(explain).not.toHaveBeenCalled();
    expect(attentionList).toHaveBeenCalledTimes(1);
    expect(vi.mocked(attentionList).mock.calls[0]![1]).not.toHaveProperty('includeBackward');
  });

  it('omits output by default and with false, while true returns the public reader proof unchanged', async () => {
    const { graph, root: source, middle, target } = fixture();
    const before = await root(graph, target);
    expect(before.finding).not.toHaveProperty('backward');
    expect(await root(graph, target, { includeBackward: false })).toEqual(before);
    const response = await root(graph, target, { includeBackward: true });
    const limits = causeLimits({ includeBackward: true });
    const expected = await explain(graph, target, { ...limits, includeBackward: true });
    expect(response.finding).toEqual(expected);
    expect(response.finding.backward.nodes).toEqual([target, middle, source]);
    expect(
      response.finding.backward.edges.map(({ from, to }: { from: string; to: string }) => [
        from,
        to,
      ]),
    ).toEqual([
      [target, middle],
      [middle, source],
    ]);
    expect(
      response.finding.backward.edges.every(
        ({ evidence }: { evidence: string[] }) => evidence.length > 0,
      ),
    ).toBe(true);
    const { backward, ...unchanged } = response.finding as CauseResult;
    expect(backward).toBeDefined();
    expect(unchanged).toEqual(before.finding);
    expect(JSON.stringify(response)).not.toContain('PRIVATE-RECORDED-VALUE');
  });

  it('does not add graph reads, or change attention and impact responses', async () => {
    const original = fixture();
    let calls = 0;
    const graph: CauseGraph = {
      parents: (...args) => {
        calls++;
        return original.graph.parents(...args);
      },
      children: (...args) => {
        calls++;
        return original.graph.children(...args);
      },
      attention: (...args) => {
        calls++;
        return original.graph.attention(...args);
      },
      gaps: (...args) => {
        calls++;
        return original.graph.gaps(...args);
      },
    };
    await root(graph, original.target);
    const defaultCalls = calls;
    calls = 0;
    await root(graph, original.target, { includeBackward: true });
    expect(calls).toBe(defaultCalls);
    for (const operation of ['attention_list', 'impact'] as const) {
      const question =
        operation === 'impact' ? { nodeId: original.target } : { nodeIds: [original.root] };
      const baseline = await callTraceTool(traceCauseTools({ graph }), operation, question);
      const enabled = await callTraceTool(
        traceCauseTools({ graph }, { includeBackward: true }),
        operation,
        question,
      );
      expect(enabled).toBe(baseline);
    }
  });

  it.each([
    [{ maxNodes: 1 }, 'node-limit'],
    [{ backward: { maxDepth: 0 } }, 'depth-limit'],
    [{ backward: { maxEdges: 1 } }, 'edge-limit'],
    [{ maxCalls: 1 }, 'call-limit'],
  ] as const)('keeps the same total/directional work limit %j', async (options, code) => {
    const { graph, target } = fixture();
    const response = await root(graph, target, { ...options, includeBackward: true });
    expect(response.finding.rootCause).toBeUndefined();
    expect(response.finding.backward.confidence).toBe('incomplete');
    expect(response.finding.backward.gaps.some((gap: { code: string }) => gap.code === code)).toBe(
      true,
    );
  });

  it('withholds the full finding when backward output exceeds maxChars', async () => {
    const { graph, target } = fixture();
    const tools = traceCauseTools({ graph }, { includeBackward: true, maxChars: 512 });
    const text = await callTraceTool(tools, 'root_cause', { nodeId: target });
    expect(text.length).toBeLessThanOrEqual(512);
    const response = JSON.parse(text);
    expect(response.finding).toBeUndefined();
    expect(response.confidence).toBe('incomplete');
    expect(response.gaps).toEqual([{ code: 'truncated', evidence: [] }]);
  });

  it('keeps the existing single deadline when a graph read never settles', async () => {
    let signal: AbortSignal | undefined;
    let calls = 0;
    let callsAtAbort = 0;
    const graph: CauseGraph = {
      gaps(_id, context) {
        calls++;
        signal = context.signal;
        context.signal.addEventListener(
          'abort',
          () => {
            callsAtAbort = calls;
          },
          { once: true },
        );
        return new Promise(() => {});
      },
      parents: () => {
        calls++;
        return { edges: [], complete: true };
      },
      children: () => {
        calls++;
        return { edges: [], complete: true };
      },
      attention: () => {
        calls++;
        return [];
      },
    };
    const response = await root(graph, 'target', { includeBackward: true, timeoutMs: 20 });
    expect(signal?.aborted).toBe(true);
    expect(calls).toBeGreaterThan(0);
    expect(calls).toBe(callsAtAbort);
    expect(response.finding.rootCause).toBeUndefined();
    expect(
      response.finding.backward.gaps.some((gap: { code: string }) => gap.code === 'timeout'),
    ).toBe(true);
  });

  it('keeps uncollected evidence uncertain when backward output is requested', async () => {
    const { graph, target } = fixture(false);
    const response = await root(graph, target, { includeBackward: true });
    expect(response.finding.rootCause).toBeUndefined();
    expect(response.finding.backward.confidence).toBe('incomplete');
    expect(
      response.finding.backward.gaps.some((gap: { code: string }) => gap.code === 'not-collected'),
    ).toBe(true);
  });

  it.each([undefined, false, true])('retains the exact host boolean %s', (includeBackward) => {
    expect(causeLimits({ includeBackward }).includeBackward).toBe(includeBackward);
  });

  it.each([null, 'true', 1, [], {}])(
    'refuses non-boolean %j before querying',
    async (includeBackward) => {
      let calls = 0;
      const graph: CauseGraph = {
        parents: () => {
          calls++;
          return { edges: [], complete: true };
        },
        children: () => {
          calls++;
          return { edges: [], complete: true };
        },
        attention: () => {
          calls++;
          return [];
        },
        gaps: () => {
          calls++;
          return [];
        },
      };
      const response = await root(graph, 'target', { includeBackward } as never);
      expect(response.gaps).toEqual([{ code: 'invalid-data', evidence: [] }]);
      expect(calls).toBe(0);
    },
  );

  it('refuses an accessor without invoking it', async () => {
    let reads = 0;
    const options = Object.defineProperty({}, 'includeBackward', {
      get() {
        reads++;
        return true;
      },
    });
    expect(() => causeLimits(options)).toThrow('cause tools: invalid limits');
    expect(reads).toBe(0);
  });

  it('rejects a model flag through the schema and ignores one on direct execution', async () => {
    const { graph, target } = fixture();
    const tools = traceCauseTools({ graph });
    const refused = await callTraceTool(tools, 'root_cause', {
      nodeId: target,
      includeBackward: true,
    });
    expect(refused).toContain('includeBackward');
    const tool = tools.find((tool) => tool.schema.name === 'root_cause')!;
    const direct = JSON.parse(
      String(await tool.execute({ nodeId: target, includeBackward: true }, {} as never)),
    );
    expect(direct.finding).not.toHaveProperty('backward');
    const enabled = traceCauseTools({ graph }, { includeBackward: true }).find(
      (tool) => tool.schema.name === 'root_cause',
    )!;
    const held = JSON.parse(
      String(await enabled.execute({ nodeId: target, includeBackward: false }, {} as never)),
    );
    expect(held.finding.backward.nodes).toContain(target);
  });

  it('honors cancellation before any read and during an active public query', async () => {
    const original = fixture();
    const target = original.target;
    let calls = 0;
    let querySignal: AbortSignal | undefined;
    const graph: CauseGraph = {
      ...original.graph,
      gaps(_id, context) {
        calls++;
        querySignal = context.signal;
        return new Promise(() => {});
      },
    };
    const tool = traceCauseTools({ graph }, { includeBackward: true }).find(
      (tool) => tool.schema.name === 'root_cause',
    )!;
    const controller = new AbortController();
    controller.abort('PRIVATE-CANCEL-REASON');
    const early = String(
      await tool.execute({ nodeId: target }, { signal: controller.signal } as never),
    );
    expect(calls).toBe(0);
    expect(JSON.parse(early).gaps[0].code).toBe('cancelled');
    const active = new AbortController();
    const pending = tool.execute({ nodeId: target }, { signal: active.signal } as never);
    for (let i = 0; i < 20 && querySignal === undefined; i++)
      await new Promise((resolve) => setTimeout(resolve, 1));
    expect(querySignal).toBeDefined();
    active.abort('PRIVATE-CANCEL-REASON');
    const text = String(await pending);
    expect(querySignal!.aborted).toBe(true);
    expect(
      JSON.parse(text).finding.backward.gaps.some(
        (gap: { code: string }) => gap.code === 'cancelled',
      ),
    ).toBe(true);
    expect(calls).toBe(1);
    expect(early + text).not.toContain('PRIVATE-CANCEL-REASON');
  });

  it('passes through reopened saved evidence without upgrading its admission', async () => {
    const fixture = await storedCauseFixture({ readSources: true });
    const reopened = await readStoredCauseArtifacts(fixture.entries, { runId: fixture.runId });
    if (reopened.status !== 'ready') throw Error(`Fixture refused: ${reopened.reason}`);
    const bundle = fixture.snapshot.commitLog.find((entry) => entry.stageId === 'choose')!;
    const target = createRecordGraph([]).nodeId(fixture.snapshot.logAddress!, {
      runtimeStageId: bundle.runtimeStageId,
      commitIdx: fixture.snapshot.commitLog.indexOf(bundle),
    });
    const before = JSON.parse(
      await callTraceTool(traceCauseTools(reopened.cause), 'root_cause', { nodeId: target }),
    );
    const response = JSON.parse(
      await callTraceTool(
        traceCauseTools(reopened.cause, { includeBackward: true, maxChars: 16000 }),
        'root_cause',
        { nodeId: target },
      ),
    );
    const expected = await explain(reopened.cause.graph, target, {
      ...causeLimits(),
      includeBackward: true,
    });
    expect(response.finding).toEqual(expected);
    expect(response.finding.backward.nodes).toContain(target);
    expect(response.finding.backward.edges.length).toBeGreaterThan(0);
    expect(
      response.finding.backward.edges.every(
        ({ evidence }: { evidence: string[] }) => evidence.length > 0,
      ),
    ).toBe(true);
    expect(response.capture).toEqual(before.capture);
    expect(response.storage).toEqual(before.storage);
    expect(response.interpretation).toBe(before.interpretation);
    expect(response.capture.persistence).toBe('memory-only');
  });

  it('keeps child queries bounded and uncertain without inheriting the parent graph', async () => {
    const child = flowChart<{ value: number }>(
      'Child',
      (scope) => {
        scope.value = 1;
      },
      'write',
    ).build();
    const chart = flowChart<{ value: number }>(
      'Parent',
      (scope) => {
        scope.value = 0;
      },
      'parent',
    )
      .addSubFlowChartNext('child', child, 'Child', {
        inputMapper: () => ({}),
        outputMapper: (out) => ({ value: out.value }),
      })
      .build();
    const executor = new FlowChartExecutor(chart);
    await executor.run();
    const snapshot = executor.getSnapshot();
    const mount = Object.keys(snapshot.subflowResults!).find((id) => id.startsWith('child#'))!;
    const opened = openSubflow(snapshot, mount);
    if (typeof opened === 'string') throw Error('Child fixture was not retained');
    const selected = opened.commitLog.at(-1)!;
    const nodeId = createRecordGraph([]).nodeId(opened.logAddress!, {
      runtimeStageId: selected.runtimeStageId,
    });
    const parentRead = vi.fn(() => {
      throw Error('PRIVATE-PARENT-GRAPH');
    });
    const innerRuns = innerRunStore(1);
    innerRuns.keep({
      toolCallId: 'child-call',
      toolName: 'child',
      outcome: 'ok',
      steps: 1,
      recording: { snapshot: opened },
    });
    const tools = traceToolpack(
      {
        snapshot,
        innerRuns,
        cause: {
          graph: {
            parents: parentRead,
            children: parentRead,
            gaps: parentRead,
            attention: parentRead,
          },
        },
      },
      { cause: { includeBackward: true, maxCalls: 1 } },
    );
    for (const [name, args] of [
      ['inspect_subflow', { mount, cause: 'root_cause', nodeId }],
      ['inspect_tool_run', { toolCallId: 'child-call', cause: 'root_cause', nodeId }],
    ] as const) {
      const text = await callTraceTool(tools, name, args);
      expect(text).toContain('"backward"');
      const body = JSON.parse(text.split('\n').find((line) => line.startsWith('{"tool":'))!);
      expect(body.finding.backward.nodes).toEqual([nodeId]);
      expect(body.finding.backward.confidence).toBe('incomplete');
      expect(body.finding.rootCause).toBeUndefined();
      expect(body.interpretation).toContain('cannot prove a root cause');
      expect(text).not.toContain('PRIVATE-PARENT-GRAPH');
    }
    expect(parentRead).not.toHaveBeenCalled();
  });
});
