import { describe, expect, it } from 'vitest';
import { Agent, allow, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, buildAccountFromView } from '../../src/answer-account/account.js';
import { validateDeclarations } from '../../src/answer-account/declarations.js';
import { bundleView } from '../../src/answer-account/bundleView.js';
import { recordAnswerAccountWithTools } from '../../src/answer-account/recordToolEvidence.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import { readCallOccurrenceKey } from '../../src/lib/callOccurrence.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import type { Recording } from '../../src/recorders/observability/recordRun.js';

const declared = { tools: { lookup_data: { rowsAt: 'rows' } } };
const DECISION = 'agentfootprint.middleware.decision';
const START = 'agentfootprint.stream.tool_start';
const ITERATION_END = 'agentfootprint.agent.iteration_end';
const END = 'agentfootprint.stream.tool_end';
const BUDGET = 128 * 1024;

async function record(rows: number, delivery: 'inline' | 'deferred', covered = false) {
  const runner = Agent.create({
    model: 'mock',
    observerDelivery: delivery,
    ...(covered && { redact: { keys: ['userMessage'] } }),
    provider: mock({
      replies: [
        { toolCalls: [{ id: 'shared-id', name: 'lookup_data', args: {} }] },
        { content: 'The lookup completed.' },
      ],
    }),
  })
    .tool(
      defineTool({
        name: 'lookup_data',
        description: 'Read a fixture.',
        inputSchema: { type: 'object' },
        execute: () => ({ rows: ['original-a', 'original-b', 'original-c'] }),
      }),
    )
    .toolMiddleware({
      name: 'projection-rule',
      onToolResult: () => allow({ rows: rows ? ['served-sentinel'] : [] }, 'Synthetic rewrite'),
    })
    .build();
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

function replay(events: readonly AgentfootprintEvent[], snapshot: Snapshot) {
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
      getLastSnapshot: () => snapshot,
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
  observed.recording.stop();
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
    'decision filtered',
    'foreign decision',
    'committed row missing',
    'committed key differs',
    'duplicate terminal',
    'native start missing',
    'native tool name missing',
    'terminal tool name differs',
    'terminal call ID differs',
    'terminal stage differs',
    'accepted and committed iterations differ from native iteration',
    'explicit start iteration differs',
    'explicit terminal iteration differs',
    'native iteration end missing',
    'native iteration end duplicated',
    'competing decision',
    'later blocked decision',
    'record-only model projection',
    'history different',
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
