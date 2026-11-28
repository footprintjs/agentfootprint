import { commitValueAt } from 'foottrace';
import { describe, expect, it } from 'vitest';
import { Agent, allow, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, buildAccountFromView } from '../../src/answer-account/account.js';
import { validateDeclarations } from '../../src/answer-account/declarations.js';
import { bundleView } from '../../src/answer-account/bundleView.js';
import { recordAnswerAccountWithTools } from '../../src/answer-account/recordToolEvidence.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { REDACTION_MARKER_ID } from '../../src/redaction/marker.js';
import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

const declared = { tools: { lookup_data: { rowsAt: 'rows' } } };
const DECISION = 'agentfootprint.middleware.decision';
const START = 'agentfootprint.stream.tool_start';
const ITERATION_END = 'agentfootprint.agent.iteration_end';
const END = 'agentfootprint.stream.tool_end';
const BUDGET = 128 * 1024;

async function record(
  rows: number,
  delivery: 'inline' | 'deferred',
  covered = false,
  commitValues?: 'full' | 'delta',
  earlierRewrite = false,
) {
  const data = (count: number, text: string) => ({
    datasets: {
      disks: { ref: 'art_0000000000000000000001', rows: count, sourceField: 'disks', text },
    },
  });
  const builder = Agent.create({
    model: 'mock',
    observerDelivery: delivery,
    ...(commitValues && { commitValues }),
    ...(covered && { redact: { keys: ['userMessage'] } }),
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'shared-id', name: 'lookup_data', args: {} }] },
        { content: 'The lookup completed.' },
      ],
    }),
  }).tool(
    defineTool({
      name: 'lookup_data',
      description: 'Read a fixture.',
      inputSchema: { type: 'object' },
      execute: () =>
        commitValues
          ? data(200, 'original-sentinel')
          : { rows: ['original-a', 'original-b', 'original-c'] },
    }),
  );
  if (commitValues) {
    builder.toolMiddleware({
      name: 'last-unchanged',
      onToolCall: () => allow(),
      onToolResult: () => allow(),
    });
  }
  builder.toolMiddleware({
    name: 'projection-rule',
    onToolResult: () =>
      allow(
        commitValues ? data(rows, 'served-sentinel') : { rows: rows ? ['served-sentinel'] : [] },
        'Synthetic rewrite',
      ),
  });
  if (commitValues) {
    builder.toolMiddleware({
      name: 'first-rule',
      onToolCall: () => allow(),
      onToolResult: () =>
        earlierRewrite ? allow(data(1, 'earlier-sentinel'), 'Superseded rewrite') : allow(),
    });
  }
  const runner = builder.build();
  const observed = recordAnswerAccountWithTools(runner, BUDGET);
  try {
    await runner.run('Read the fixture.');
  } finally {
    observed.recording.stop();
  }
  return { source: observed.recording.toRecording(), bundle: observed.toSnapshot()! };
}

type State = {
  middlewareDecisions: Record<string, unknown>[];
  history: Record<string, unknown>[];
};
type Snapshot = NonNullable<
  ReturnType<Parameters<typeof recordAnswerAccountWithTools>[0]['getLastSnapshot']>
>;

function replay(
  events: readonly AgentfootprintEvent[],
  snapshot: Snapshot | undefined,
  failedPolicy = false,
) {
  const attachers: Parameters<Parameters<typeof recordAnswerAccountWithTools>[0]['attach']>[0][] =
    [];
  let listener: ((event: AgentfootprintEvent) => void) | undefined;
  const observed = recordAnswerAccountWithTools(
    {
      attach(recorder) {
        attachers.push(recorder);
        return () => {};
      },
      on(pattern, callback) {
        if (pattern === '*' && listener === undefined) listener = callback;
        return () => {};
      },
      getCommitCount: () => 0,
      getLastSnapshot: () => {
        if (failedPolicy) throw new Error('Final serving policy unavailable');
        return snapshot;
      },
      getSpec: () =>
        ({} as ReturnType<Parameters<typeof recordAnswerAccountWithTools>[0]['getSpec']>),
    },
    BUDGET,
  );
  // Replay only accepted emissions from an actual native run. The lifecycle
  // callbacks establish the seal boundary, with no provider or writer involved.
  const hooks = attachers.find((row) => row.id === 'agentfootprint:answer-account-observation')!;
  hooks.onRunStart?.({} as never);
  for (const event of events) listener!(event);
  hooks.onCommit?.({} as never);
  hooks.onRunEnd?.({} as never);
  if (failedPolicy)
    expect(() => observed.recording.stop()).toThrow('Final serving policy unavailable');
  else observed.recording.stop();
  return observed.toSnapshot()!;
}

describe('one bounded in-memory rewritten result', () => {
  it.each([
    ['inline', 1],
    ['inline', 0],
    ['deferred', 1],
    ['deferred', 0],
  ] as const)(
    'matches the whole stored account and pointers in %s with %i served rows',
    async (delivery, rows) => {
      const { source, bundle } = await record(rows, delivery);
      const account = accountForAnswer(source, declared);
      const fact = account.facts.calls[0]!;
      expect(fact).toMatchObject({
        rows,
        view: 'model-result',
        rewrittenBy: 'projection-rule',
        emptiness: rows > 0 ? 'non-empty' : 'undeclared-empty',
      });
      expect(fact.pointers).toContainEqual({
        kind: 'state',
        key: 'middlewareDecisions',
        path: '/0/middleware',
      });
      const end = source.events.find((e) => e.type === END)!;
      const state = (source.snapshot as { sharedState: State }).sharedState;
      const history = state.history.find((m) => m.role === 'tool')!;
      expect(readCallOccurrenceKey(state.middlewareDecisions[0]!)).toBe(
        readCallOccurrenceKey(end.payload),
      );
      expect(readCallOccurrenceKey(history)).toBe(readCallOccurrenceKey(end.payload));
      const shown = showLeaves(account, source, declared);
      expect(Object.values(shown)).toContainEqual({ rows, at: '/modelResult/rows' });
      expect(bundle.gaps).toEqual([]);
      const encoded = JSON.stringify(bundle);
      const view = bundleView(JSON.parse(encoded));
      expect(view).toBeDefined();
      const projected = buildAccountFromView(view!, validateDeclarations(declared));
      expect(JSON.stringify(projected)).toBe(JSON.stringify(account));
      expect(showLeaves(projected, source, declared)).toEqual(shown);
      expect(encoded).not.toContain('original-a');
      expect(encoded).not.toContain('served-sentinel');
      expect(encoded).not.toContain('Synthetic rewrite');
    },
  );

  it.each([
    ['inline', 'full'],
    ['inline', 'delta'],
    ['deferred', 'full'],
    ['deferred', 'delta'],
  ] as const)('preserves the winning and served addresses in %s / %s', async (delivery, mode) => {
    const { source, bundle } = await record(200, delivery, false, mode);
    const state = (source.snapshot as Snapshot).sharedState as State;
    const winner = state.middlewareDecisions.findIndex((row) => row.changed === true);
    expect(winner).toBeGreaterThan(0);
    expect(state.middlewareDecisions[winner - 1]).toMatchObject({
      moment: 'after-tool',
      changed: false,
    });
    expect(state.middlewareDecisions[winner + 1]).toMatchObject({
      moment: 'after-tool',
      changed: false,
    });
    expect(state.middlewareDecisions.filter((row) => row.changed)).toHaveLength(1);

    const declarations = { tools: { lookup_data: { rowsAt: 'disks' } } };
    const reference = accountForAnswer(source, declarations);
    expect(reference.facts.calls[0]).toMatchObject({
      view: 'model-result',
      rows: 200,
      rewrittenBy: 'projection-rule',
    });
    expect(reference.facts.calls[0]!.pointers).toContainEqual({
      kind: 'state',
      key: 'middlewareDecisions',
      path: `/${winner}/middleware`,
    });
    expect(Object.values(showLeaves(reference, source, declarations))).toContainEqual({
      rows: 200,
      at: '/modelResult/datasets/disks/rows',
    });
    expect(Object.values(showLeaves(reference, source, declarations))).toContainEqual({
      withheld: 'not-shown-here',
    });
    expect(accountForAnswer(source).facts.calls[0]).toMatchObject({
      emptiness: 'unknown',
      view: 'model-result',
    });
    expect(accountForAnswer(source).facts.calls[0]?.rows).toBeUndefined();
    expect(bundle.gaps).toEqual([]);
    const view = bundleView(JSON.parse(JSON.stringify(bundle)));
    expect(view).toBeDefined();
    for (const decl of [undefined, declarations]) {
      const whole = accountForAnswer(source, decl);
      const projected = buildAccountFromView(view!, validateDeclarations(decl));
      expect(projected).toEqual(whole);
      expect(showLeaves(projected, source, decl)).toEqual(showLeaves(whole, source, decl));
    }
  });

  it('credits the final changed decision after an earlier replacement', async () => {
    const { source, bundle } = await record(200, 'inline', false, 'delta', true);
    expect(bundle.gaps).toEqual([]);
    const state = (source.snapshot as Snapshot).sharedState as State;
    expect(state.middlewareDecisions.filter((row) => row.changed)).toHaveLength(2);
    const declarations = { tools: { lookup_data: { rowsAt: 'disks' } } };
    const account = buildAccountFromView(bundleView(bundle)!, validateDeclarations(declarations));
    expect(account.facts.calls[0]).toMatchObject({ rewrittenBy: 'projection-rule', rows: 200 });
    expect(account).toEqual(accountForAnswer(source, declarations));
  });

  it.each([
    'decision filtered',
    'foreign decision',
    'committed row missing',
    'committed key differs',
    'duplicate terminal',
    'native start missing',
    'native tool name missing',
    'terminal tool name differs',
    'terminal call ID differs',
    'the decision and both ledgers agree on a different provider ID',
    'terminal stage differs',
    'accepted and committed iterations differ from native iteration',
    'explicit start iteration differs',
    'explicit terminal iteration differs',
    'native iteration end missing',
    'native iteration end duplicated',
    'competing decision',
    'later blocked decision',
    'later unreadable decision',
    'record-only model projection',
    'history different',
    'earlier commit coordinate',
    'duplicate stage commit',
    'inherited rather than written history',
    'untracked write witness',
    'same shape but different committed result',
    'wrong log owner',
    'removed commit',
    'oversized retained commit',
    'completion before terminal',
    'unreturned history',
  ] as const)('withholds the pair and its provisional data when %s', async (missing) => {
    const { source } = await record(1, 'inline');
    let events = [...source.events];
    const snapshot = JSON.parse(JSON.stringify(source.snapshot)) as Snapshot & {
      sharedState: State;
    };
    const state = snapshot.sharedState;
    const decision = source.events.find((e) => e.type === DECISION)!;
    const end = source.events.find((e) => e.type === END)!;
    const start = source.events.find((e) => e.type === START)!;
    const iterationEnd = source.events.find(
      (e) => e.type === ITERATION_END && e.meta.runtimeStageId === end.meta.runtimeStageId,
    )!;
    const history = state.history.find((m) => m.role === 'tool')!;
    switch (missing) {
      case 'decision filtered':
        events = events.filter((e) => e !== decision);
        break;
      case 'foreign decision':
        events[events.indexOf(decision)] = {
          ...decision,
          meta: { ...decision.meta, runId: 'other-run' },
        } as AgentfootprintEvent;
        break;
      case 'committed row missing':
        state.middlewareDecisions = [];
        break;
      case 'committed key differs':
        state.middlewareDecisions[0]!.callOccurrenceKey = [9, 8, 7, 6, 0];
        break;
      case 'duplicate terminal':
        events.splice(events.indexOf(end), 0, end);
        break;
      case 'native start missing':
        events = events.filter((e) => e !== start);
        break;
      case 'native tool name missing':
        events[events.indexOf(start)] = {
          ...start,
          payload: { ...start.payload, toolName: undefined },
        } as AgentfootprintEvent;
        break;
      case 'terminal tool name differs':
        events[events.indexOf(end)] = {
          ...end,
          payload: { ...end.payload, toolName: 'different_tool' },
        } as AgentfootprintEvent;
        break;
      case 'terminal call ID differs':
        events[events.indexOf(end)] = {
          ...end,
          payload: { ...end.payload, toolCallId: 'different-id' },
        };
        break;
      case 'the decision and both ledgers agree on a different provider ID': {
        const wrongId = 'same-occurrence-wrong-provider-id';
        events[events.indexOf(decision)] = {
          ...decision,
          payload: { ...decision.payload, toolCallId: wrongId },
        } as AgentfootprintEvent;
        state.middlewareDecisions[0]!.toolCallId = wrongId;
        const commit = snapshot.commitLog.find(
          (row) => row.runtimeStageId === end.meta.runtimeStageId,
        )!;
        commit.overwrite.middlewareDecisions = state.middlewareDecisions;
        commit.trace = [
          ...commit.trace.filter(({ path }) => path !== 'middlewareDecisions'),
          { path: 'middlewareDecisions', verb: 'set' },
        ];
        break;
      }
      case 'terminal stage differs':
        events[events.indexOf(end)] = {
          ...end,
          meta: { ...end.meta, runtimeStageId: 'other-stage#99' },
        };
        break;
      case 'accepted and committed iterations differ from native iteration':
        events[events.indexOf(decision)] = {
          ...decision,
          payload: { ...decision.payload, iteration: 99 },
        } as AgentfootprintEvent;
        state.middlewareDecisions[0]!.iteration = 99;
        break;
      case 'explicit start iteration differs':
        events[events.indexOf(start)] = {
          ...start,
          payload: { ...start.payload, iteration: 99 },
        } as AgentfootprintEvent;
        break;
      case 'explicit terminal iteration differs':
        events[events.indexOf(end)] = {
          ...end,
          payload: { ...end.payload, iteration: 99 },
        } as AgentfootprintEvent;
        break;
      case 'native iteration end missing':
        events = events.filter((e) => e !== iterationEnd);
        break;
      case 'native iteration end duplicated':
        events.splice(events.indexOf(iterationEnd), 0, iterationEnd);
        break;
      case 'competing decision':
        state.middlewareDecisions.push({ ...state.middlewareDecisions[0]!, changed: true });
        break;
      case 'later blocked decision':
        state.middlewareDecisions.push({ ...state.middlewareDecisions[0]!, outcome: 'deny' });
        break;
      case 'later unreadable decision':
        state.middlewareDecisions.push({ ...state.middlewareDecisions[0]!, outcome: undefined });
        break;
      case 'record-only model projection':
        if (end.type !== END) throw new Error('missing tool end');
        events[events.indexOf(end)] = {
          ...end,
          payload: { ...end.payload, modelResult: end.payload.result },
        };
        break;
      case 'history different':
        history.content = '{"rows":[]}';
        break;
      case 'earlier commit coordinate':
        events[events.indexOf(end)] = {
          ...end,
          meta: {
            ...end.meta,
            sourcePosition: {
              ...end.meta.sourcePosition!,
              committedThroughIdx: end.meta.sourcePosition!.committedThroughIdx - 1,
            },
          },
        };
        break;
      case 'duplicate stage commit': {
        const commit = snapshot.commitLog.find(
          (row) => row.runtimeStageId === end.meta.runtimeStageId,
        )!;
        snapshot.commitLog.push({ ...commit, idx: snapshot.commitLog.length });
        break;
      }
      case 'inherited rather than written history': {
        const index = snapshot.commitLog.findIndex(
          (row) => row.runtimeStageId === end.meta.runtimeStageId,
        );
        const commit = snapshot.commitLog[index]!;
        const previous = snapshot.commitLog[index - 1]!;
        previous.overwrite.history = commitValueAt(snapshot.commitLog, index, 'history');
        previous.trace = [
          ...previous.trace.filter(({ path }) => path !== 'history'),
          { path: 'history', verb: 'set' },
        ];
        commit.trace = commit.trace.filter(({ path }) => path !== 'history');
        break;
      }
      case 'untracked write witness': {
        const commit = snapshot.commitLog.find(
          (row) => row.runtimeStageId === end.meta.runtimeStageId,
        )!;
        commit.untrackedSources = ['silent'];
        break;
      }
      case 'same shape but different committed result':
        if (end.type !== END) throw new Error('missing tool end');
        events[events.indexOf(end)] = {
          ...end,
          payload: { ...end.payload, modelResult: { rows: ['different-value-same-count'] } },
        };
        break;
      case 'wrong log owner':
        Object.assign(snapshot, {
          logAddress: { ...snapshot.logAddress, logRunId: 'different-log' },
        });
        break;
      case 'removed commit':
        snapshot.commitLog.splice(
          snapshot.commitLog.findIndex((row) => row.runtimeStageId === end.meta.runtimeStageId),
          1,
        );
        break;
      case 'oversized retained commit': {
        const commit = snapshot.commitLog.find(
          (row) => row.runtimeStageId === end.meta.runtimeStageId,
        )!;
        const rows = commit.overwrite.history as unknown[];
        commit.overwrite.history = [...rows, { role: 'user', content: 'x'.repeat(BUDGET) }];
        break;
      }
      case 'completion before terminal':
        events.splice(events.indexOf(iterationEnd), 1);
        events.splice(events.indexOf(end), 0, iterationEnd);
        break;
      case 'unreturned history':
        history.toolResultExecution = 'returned-unserved';
        break;
    }
    const bundle = replay(events, snapshot);
    expect(bundle.gaps).toContain('tool-results');
    expect(bundleView(bundle)).toBeUndefined();
    expect(bundle.events.some(({ toolResult }) => toolResult?.view === 'model-result')).toBe(false);
    expect(bundle.events.find(({ event }) => event.type === DECISION)?.event.payload ?? {}).toEqual(
      {},
    );
    expect(bundle.state).toBeUndefined();
  });

  it('uses the owning commit when final history has dropped the result', async () => {
    const { source } = await record(200, 'deferred', false, 'delta');
    const snapshot = structuredClone(source.snapshot) as Snapshot & { sharedState: State };
    snapshot.sharedState.history = snapshot.sharedState.history.filter(
      (row) => row.role !== 'tool',
    );
    const withoutHistory = { ...source, snapshot };
    const bundle = replay(source.events, snapshot);
    expect(bundle.gaps).toEqual([]);
    const view = bundleView(bundle);
    expect(view).toBeDefined();
    const declarations = { tools: { lookup_data: { rowsAt: 'disks' } } };
    const whole = accountForAnswer(withoutHistory, declarations);
    const projected = buildAccountFromView(view!, validateDeclarations(declarations));
    expect(projected).toEqual(whole);
    expect(showLeaves(projected, withoutHistory, declarations)).toEqual(
      showLeaves(whole, withoutHistory, declarations),
    );
  });

  it.each(['result', 'attribution', 'both', 'late', 'unresolved', 'failed'] as const)(
    'erases provisional evidence when the final policy is %s',
    async (policy) => {
      const samples = await Promise.all([record(0, 'inline'), record(1, 'inline')]);
      const cases = samples.map(({ source }, variant) => {
        const snapshot = structuredClone(source.snapshot) as Snapshot & { sharedState: State };
        const events = source.events.map((event) => {
          if (event.type === DECISION && variant === 1) {
            return {
              ...event,
              payload: { ...event.payload, middleware: 'different-concealed-name' },
            };
          }
          if (event.type === END && (policy === 'result' || policy === 'both')) {
            return { ...event, payload: { ...event.payload, modelResult: 'REDACTED' } };
          }
          return event;
        });
        if (policy === 'attribution' || policy === 'both') {
          snapshot.sharedState.middlewareDecisions[0]!.middleware = '[REDACTED]';
        }
        if (policy === 'unresolved' || policy === 'failed') {
          return replay(events, undefined, policy === 'failed');
        }
        Object.assign(snapshot, {
          recorders: [...(snapshot.recorders ?? []), { id: REDACTION_MARKER_ID }],
        });
        return replay(events, snapshot);
      });
      expect(JSON.stringify(cases[0])).toBe(JSON.stringify(cases[1]));
      expect(cases[0]).toEqual({
        version: 1,
        gaps: ['redaction'],
        firstRetainedIndex: 0,
        events: [],
      });
      expect(cases.map(bundleView)).toEqual([undefined, undefined]);
    },
  );

  it('bounds the two transient input copies together', async () => {
    const { source } = await record(1, 'inline');
    const events = source.events.map((event) =>
      event.type === END
        ? {
            ...event,
            payload: {
              ...event.payload,
              result: { rows: ['original-overflow'.repeat(5_000)] },
              modelResult: { rows: ['served-overflow'.repeat(5_000)] },
            },
          }
        : event,
    );
    const bundle = replay(events, source.snapshot as Snapshot);
    expect(bundle.gaps).toContain('budget');
    expect(bundle.events.every((row) => row.toolResult === undefined)).toBe(true);
    expect(bundleView(bundle)).toBeUndefined();
  });

  it('returns the same constant marker for both covered results', async () => {
    const empty = await record(0, 'inline', true);
    const found = await record(1, 'inline', true);
    expect(JSON.stringify(found.bundle)).toBe(JSON.stringify(empty.bundle));
    expect(found.bundle.gaps).toEqual(['redaction']);
    expect(found.bundle.events).toEqual([]);
    expect(bundleView(found.bundle)).toBeUndefined();
  });
});
