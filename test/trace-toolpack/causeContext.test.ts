import { afterEach, describe, expect, it, vi } from 'vitest';
import { FlowChartExecutor, flowChart, type RuntimeSnapshot } from 'footprintjs';

import { unconfiguredArtifacts } from '../../src/artifacts/capability.js';
import { unconfiguredCredentialProvider } from '../../src/identity/types.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { defineTool, type ToolExecutionContext } from '../../src/tools/tools.js';
import { askInner } from '../../src/trace-toolpack/innerDescent.js';
import { lazyTraceToolpack } from '../../src/trace-toolpack/lazyToolpack.js';
import { openSubflow } from '../../src/trace-toolpack/subflowRecords.js';
import {
  buildSelfExplainToolProvider,
  SelfExplainBinding,
} from '../../src/trace-toolpack/selfExplain.js';
import * as pack from '../../src/trace-toolpack/traceToolpack.js';
import type { TraceToolpackArtifacts } from '../../src/trace-toolpack/types.js';
import { innerRunStore } from '../../src/core/innerRunRecords.js';

const snapshot = (): RuntimeSnapshot =>
  ({ commitLog: [], executionTree: undefined, sharedState: {}, commitValues: 'full' } as never);

function context(signal?: AbortSignal): ToolExecutionContext {
  return {
    toolCallId: 'context-test',
    iteration: 1,
    ...(signal === undefined ? {} : { signal }),
    credentials: unconfiguredCredentialProvider(),
    hasCredentials: false,
    artifacts: unconfiguredArtifacts(),
    hasArtifacts: false,
    progress: () => undefined,
    teardownScopes: [],
    onTeardown: () => undefined,
  };
}

afterEach(() => vi.restoreAllMocks());

describe('trace context survives eager, lazy and inner dispatch', () => {
  it('callTraceTool preserves the exact provided context instead of replacing it offline', async () => {
    const ctx = context(new AbortController().signal);
    let seen: ToolExecutionContext | undefined;
    const tool = defineTool({
      name: 'context_probe',
      description: 'A local context probe.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: (_args, execution) => {
        seen = execution;
        return 'ok';
      },
    });
    expect(await pack.callTraceTool([tool], 'context_probe', {}, ctx)).toBe('ok');
    expect(seen).toBe(ctx);
  });

  it('callTraceTool without a context keeps the offline capability boundary', async () => {
    const tool = defineTool({
      name: 'offline_probe',
      description: 'A local offline probe.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false },
      execute: (_args, execution) =>
        JSON.stringify({
          artifacts: execution.hasArtifacts,
          credentials: execution.hasCredentials,
        }),
    });
    expect(await pack.callTraceTool([tool], 'offline_probe')).toBe(
      '{"artifacts":false,"credentials":false}',
    );
  });

  it('lazy dispatch forwards the current invocation context', async () => {
    const ctx = context(new AbortController().signal);
    const dispatch = vi.spyOn(pack, 'callTraceTool').mockResolvedValue('ok');
    const tools = lazyTraceToolpack(() => ({ snapshot: snapshot() }));
    const overview = tools.find((tool) => tool.schema.name === 'run_overview')!;
    expect(await overview.execute({}, ctx)).toBe('ok');
    expect(dispatch.mock.calls[0]?.[3]).toBe(ctx);
  });

  it('does not reuse another cause capability for an identical snapshot object', async () => {
    const shared = snapshot();
    const graph = () => ({
      parents: () => ({ edges: [], complete: true }),
      children: () => ({ edges: [], complete: true }),
      attention: () => [],
      gaps: () => [],
    });
    const first = { graph: graph() },
      second = { graph: graph() };
    let current: TraceToolpackArtifacts = { snapshot: shared, cause: first };
    vi.spyOn(pack, 'traceToolpack').mockImplementation((artifacts) => [
      defineTool({
        name: 'run_overview',
        description: 'A source capability probe.',
        inputSchema: { type: 'object', properties: {}, additionalProperties: false },
        execute: () => (artifacts.cause === first ? 'first' : 'second'),
      }),
    ]);
    const tool = lazyTraceToolpack(() => current)[0]!;
    expect(await tool.execute({}, context())).toBe('first');
    current = { snapshot: shared, cause: second };
    expect(await tool.execute({}, context())).toBe('second');
  });

  it.each(['attention_list', 'root_cause', 'impact'] as const)(
    'routes inner %s before legacy questions and forwards the exact context',
    async (cause) => {
      const ctx = context(new AbortController().signal);
      const call = vi.fn(async () => 'ok');
      await askInner([], { cause, nodeId: 'opaque-node', find: 'ignored' }, call, ctx);
      expect(call).toHaveBeenCalledWith(
        [],
        cause,
        cause === 'attention_list' ? {} : { nodeId: 'opaque-node' },
        ctx,
      );
    },
  );

  it('lets the existing inner tool schema refuse a missing cause node id', async () => {
    const ctx = context();
    const call = vi.fn(async () => 'schema refusal');
    expect(await askInner([], { cause: 'root_cause' }, call, ctx)).toBe('schema refusal');
    expect(call).toHaveBeenCalledWith([], 'root_cause', {}, ctx);
  });

  it('retains legacy inner routing with the provided context', async () => {
    const ctx = context();
    for (const [question, name, args] of [
      [{ find: 'needle' }, 'find_in_trace', { query: 'needle' }],
      [{ variable: 'total' }, 'backtrack', { variable: 'total' }],
      [
        { runtimeStageId: 'step#1', key: 'total' },
        'get_value',
        { runtimeStageId: 'step#1', key: 'total' },
      ],
      [{ runtimeStageId: 'step#1' }, 'trace_node', { runtimeStageId: 'step#1' }],
      [{ key: 'total' }, 'who_wrote', { key: 'total' }],
      [{}, 'run_overview', {}],
    ] as const) {
      const call = vi.fn(async () => 'ok');
      await askInner([], question, call, ctx);
      expect(call).toHaveBeenCalledWith([], name, args, ctx);
    }
  });
});

describe('opened subflow metadata remains captured evidence', () => {
  it('keeps the child address and run-wide captured discriminants', () => {
    const childAddress = { logRunId: 'recorded-log', drillPath: ['mount#1'] };
    const outer = {
      ...snapshot(),
      runId: 'recorded-run',
      writeProvenance: 'reads-prefix',
      logAddress: { logRunId: 'recorded-log', drillPath: [] },
      subflowResults: {
        'mount#1': { treeContext: { history: [], globalContext: {}, logAddress: childAddress } },
      },
    } as unknown as RuntimeSnapshot;
    const opened = openSubflow(outer, 'mount#1');
    expect(typeof opened).not.toBe('string');
    expect(opened).toMatchObject({
      runId: 'recorded-run',
      writeProvenance: 'reads-prefix',
      logAddress: childAddress,
    });
  });

  it('does not use the parent address or synthesize missing capture metadata', () => {
    const outer = {
      ...snapshot(),
      logAddress: { logRunId: 'parent-log', drillPath: [] },
      subflowResults: { 'mount#1': { treeContext: { history: [], globalContext: {} } } },
    } as unknown as RuntimeSnapshot;
    const opened = openSubflow(outer, 'mount#1');
    expect(typeof opened).not.toBe('string');
    expect(opened).not.toHaveProperty('logAddress');
    expect(opened).not.toHaveProperty('runId');
    expect(opened).not.toHaveProperty('writeProvenance');
    expect(opened).not.toHaveProperty('cause');
  });

  it('does not invoke accessors while copying optional capture metadata', () => {
    let reads = 0;
    const getter = {
      get() {
        reads++;
        throw new Error('PRIVATE_METADATA');
      },
    };
    const treeContext = Object.defineProperty(
      { history: [], globalContext: {} },
      'logAddress',
      getter,
    );
    const outer = Object.defineProperties(
      {
        ...snapshot(),
        subflowResults: { 'mount#1': { treeContext } },
      },
      { runId: getter, writeProvenance: getter },
    ) as unknown as RuntimeSnapshot;
    const opened = openSubflow(outer, 'mount#1');
    expect(reads).toBe(0);
    expect(opened).not.toHaveProperty('logAddress');
    expect(opened).not.toHaveProperty('runId');
    expect(opened).not.toHaveProperty('writeProvenance');
  });
});

describe('cause questions through the real inner entry points', () => {
  it('keeps cancellation and parent capabilities out of nested subflow and retained-run reads', async () => {
    const leaf = flowChart<{ value: number }>(
      'Leaf',
      (scope) => {
        scope.value = 3;
      },
      'leaf',
    ).build();
    const middle = flowChart<{ value: number }>(
      'Middle',
      (scope) => {
        scope.value = 2;
      },
      'middle',
    )
      .addSubFlowChartNext('nested', leaf, 'Nested', {
        inputMapper: () => ({}),
        outputMapper: (out) => ({ value: out.value }),
      })
      .build();
    const chart = flowChart<{ value: number }>(
      'Outer',
      (scope) => {
        scope.value = 1;
      },
      'outer',
    )
      .addSubFlowChartNext('child', middle, 'Child', {
        inputMapper: () => ({}),
        outputMapper: (out) => ({ value: out.value }),
      })
      .build();
    const executor = new FlowChartExecutor(chart);
    await executor.run();
    const outer = executor.getSnapshot();
    const nestedMount = Object.keys(outer.subflowResults ?? {}).find((id) =>
      id.startsWith('child/nested#'),
    )!;
    expect(nestedMount).toBeDefined();
    const graphRead = vi.fn(() => {
      throw new Error('PRIVATE_PARENT_GRAPH');
    });
    const store = innerRunStore(1);
    store.keep({
      toolCallId: 'retained-child',
      toolName: 'child-chart',
      outcome: 'ok',
      steps: 3,
      recording: { snapshot: outer },
    });
    const tools = pack.traceToolpack({
      snapshot: outer,
      innerRuns: store,
      cause: {
        graph: { parents: graphRead, children: graphRead, attention: graphRead, gaps: graphRead },
      },
    });
    const aborted = new AbortController();
    aborted.abort();
    for (const [name, args] of [
      ['inspect_subflow', { mount: nestedMount, cause: 'attention_list' }],
      ['inspect_tool_run', { toolCallId: 'retained-child', cause: 'attention_list' }],
    ] as const) {
      const cancelled = await pack.callTraceTool(tools, name, args, context(aborted.signal));
      expect(cancelled).toContain('"code":"cancelled"');
      const result = await pack.callTraceTool(tools, name, args, context());
      expect(result).toContain('"tool":"attention_list"');
      expect(result).not.toContain('PRIVATE_PARENT_GRAPH');
    }
    expect(graphRead).not.toHaveBeenCalled();
  });
});

describe('delegated self explanation shares caller cancellation', () => {
  it('forwards the caller signal into the nested mock debugger request', async () => {
    const controller = new AbortController();
    const seen: Array<AbortSignal | undefined> = [];
    const binding = new SelfExplainBinding();
    binding.bindTo(() => snapshot());
    binding.recorder().onRunEnd?.({} as never);
    const provider = buildSelfExplainToolProvider(binding, {
      delegate: {
        provider: mock({
          respond: (request) => {
            seen.push(request.signal);
            return 'Recorded evidence only.';
          },
        }),
        model: 'mock',
      },
    });
    const tools = await provider.list({ activeSkillId: 'self-explain' } as never);
    const tool = tools.find((candidate) => candidate.schema.name === 'explain_run')!;
    await tool.execute({ question: 'Why?' }, context(controller.signal));
    expect(seen).toHaveLength(1);
    expect(seen[0]).toBe(controller.signal);
  });
});
