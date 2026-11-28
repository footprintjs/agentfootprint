import { describe, expect, it } from 'vitest';
import { Agent, defineTool } from '../../src/index.js';
import { mock } from '../../src/llm-providers.js';
import { accountForAnswer, buildAccountFromView } from '../../src/answer-account/account.js';
import { bundleView } from '../../src/answer-account/bundleView.js';
import { validateDeclarations } from '../../src/answer-account/declarations.js';
import { recordAnswerAccountWithTools } from '../../src/answer-account/recordToolEvidence.js';
import { showLeaves } from '../../src/answer-account/shown.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { REDACTION_MARKER_ID } from '../../src/redaction/marker.js';
import type { RecordableRunner, Recording } from '../../src/recorders/observability/recordRun.js';

const DECLARED = 'agentfootprint.findings.declared';
const ARGUMENT = 'agentfootprint.findings.argument';
const START = 'agentfootprint.stream.tool_start';
const END = 'agentfootprint.stream.tool_end';
const ITERATION_END = 'agentfootprint.agent.iteration_end';
const BUDGET = 256 * 1024;
const RAW_FINDINGS_TEXT = 'Private proposition for projection test';
type Snapshot = ReturnType<RecordableRunner['getLastSnapshot']>;

async function original(
  delivery: 'inline' | 'deferred' = 'inline',
  commitValues: 'full' | 'delta' = 'delta',
  findings = true,
) {
  const builder = Agent.create({
    model: 'mock',
    observerDelivery: delivery,
    commitValues,
    provider: mock({
      replies: [
        {
          toolCalls: [
            {
              id: 'sample',
              name: 'lookup',
              args: { _findings: { basis: 'direct', proposition: RAW_FINDINGS_TEXT } },
            },
          ],
        },
        { content: 'The lookup completed.' },
      ],
    }),
  }).tool(
    defineTool({
      name: 'lookup',
      description: 'Read a deterministic fixture.',
      inputSchema: { type: 'object' },
      execute: () => [1],
    }),
  );
  if (findings) builder.findings();
  const agent = builder.build();
  const recorder = recordAnswerAccountWithTools(agent, BUDGET);
  try {
    await agent.run('Read the fixture.');
  } finally {
    recorder.recording.stop();
    await agent.shutdown();
  }
  return { source: recorder.recording.toRecording(), bundle: recorder.toSnapshot()! };
}

function replay(input: Recording, budget = BUDGET, readFails = false) {
  const attachers: Parameters<RecordableRunner['attach']>[0][] = [];
  let listener: ((event: AgentfootprintEvent) => void) | undefined;
  const recorder = recordAnswerAccountWithTools(
    {
      attach(recorder) {
        attachers.push(recorder);
        return () => {};
      },
      on(pattern, onEvent) {
        if (pattern === '*' && listener === undefined) listener = onEvent;
        return () => {};
      },
      getLastSnapshot: () => {
        if (readFails) throw new Error('Serving unavailable');
        return input.snapshot as Snapshot;
      },
      getCommitCount: () => 0,
      getSpec: () => ({} as ReturnType<RecordableRunner['getSpec']>),
    },
    budget,
  );
  const hooks = attachers.find((row) => row.id === 'agentfootprint:answer-account-observation')!;
  hooks.onRunStart?.({} as never);
  for (const event of input.events) listener!(event);
  hooks.onCommit?.({} as never);
  hooks.onRunEnd?.({} as never);
  if (readFails) expect(() => recorder.recording.stop()).toThrow('Serving unavailable');
  else recorder.recording.stop();
  return recorder.toSnapshot()!;
}

function expectationPointer(input: Recording) {
  const account = accountForAnswer(input);
  const pointers = account.rows
    .flatMap((row) => row.lines)
    .flatMap((line) => line.pointers)
    .filter((pointer) => pointer.kind === 'event' && pointer.type === DECLARED);
  return { account, pointers };
}

function missing(input: Recording) {
  const bundle = replay(input);
  expect(bundle.gaps).toContain('missing-expectation-evidence');
  expect(bundleView(bundle)).toBeUndefined();
  expect(
    bundle.events.filter(({ event }) => event.type === DECLARED).map(({ event }) => event.payload),
  ).toEqual(bundle.events.filter(({ event }) => event.type === DECLARED).map(() => ({})));
}

describe('bounded native call expectation', () => {
  it.each([
    ['inline', 'full'],
    ['inline', 'delta'],
    ['deferred', 'full'],
    ['deferred', 'delta'],
  ] as const)('reads an unrated timely declaration in %s / %s', async (delivery, mode) => {
    const { source, bundle } = await original(delivery, mode);
    const declaration = source.events.findIndex((event) => event.type === DECLARED);
    const start = source.events.findIndex((event) => event.type === START);
    const end = source.events.findIndex((event) => event.type === END);
    const completion = source.events.find(
      (event) =>
        event.type === ITERATION_END &&
        event.meta.runtimeStageId === source.events[start]!.meta.runtimeStageId,
    );
    expect(declaration).toBeGreaterThanOrEqual(0);
    expect(declaration).toBeLessThan(start);
    expect(source.events[start]!.payload).not.toHaveProperty('iteration');
    expect(source.events[end]!.payload).not.toHaveProperty('iteration');
    expect(completion?.payload).toMatchObject({ iterIndex: 1 });
    const { account, pointers } = expectationPointer(source);
    expect(account.facts.calls[0]?.expectation).toEqual({ basis: 'direct' });
    expect(pointers).toEqual([expect.objectContaining({ index: declaration, path: '/basis' })]);
    expect(bundle.gaps).toEqual([]);
    const ledger = (source.snapshot as Snapshot)?.sharedState?.findingsLedger;
    expect(JSON.stringify(ledger)).toContain(RAW_FINDINGS_TEXT);
    expect(JSON.stringify(bundle)).not.toContain(RAW_FINDINGS_TEXT);
    expect(bundle.state?.findingsLedger).toEqual(ledger?.map(() => null));
    const view = bundleView(JSON.parse(JSON.stringify(bundle)));
    expect(view).toBeDefined();
    const projected = buildAccountFromView(view!, validateDeclarations(undefined));
    expect(projected).toEqual(account);
    expect(showLeaves(projected, source)).toEqual(showLeaves(account, source));
  });

  it('keeps the unarmed default and treats argument evidence as a separate family', async () => {
    const { source, bundle } = await original('inline', 'delta', false);
    expect(accountForAnswer(source).facts.calls[0]?.expectation).toBeUndefined();
    expect(bundle.gaps).toEqual([]);
    const start = source.events.find((ev) => ev.type === START)!;
    const argument = { ...start, type: ARGUMENT, payload: { ...start.payload, basis: 'direct' } };
    const withArgument = { ...source, events: [...source.events, argument] } as Recording;
    const retained = replay(withArgument);
    expect(retained.gaps).toContain('unsupported-evidence');
    expect(retained.events.at(-1)?.event.payload).toEqual({});
    expect(accountForAnswer(withArgument).facts.calls[0]?.expectation).toBeUndefined();
  });

  it.each([
    'stage',
    'prefix',
    'iteration',
    'provider',
    'invocation',
    'run',
    'key',
    'missing',
  ] as const)('withholds the evidence on a %s mismatch', async (axis) => {
    const { source } = await original();
    const events = [...source.events];
    const index = events.findIndex(({ type }) => type === DECLARED);
    const declaration = events[index]!;
    if (axis === 'missing') {
      events.splice(index, 1);
    } else {
      const meta = { ...declaration.meta, sourcePosition: { ...declaration.meta.sourcePosition! } };
      const payload = { ...declaration.payload } as Record<string, unknown>;
      switch (axis) {
        case 'stage':
          meta.runtimeStageId = 'other-stage#0';
          break;
        case 'prefix':
          meta.sourcePosition.committedThroughIdx -= 1;
          break;
        case 'iteration':
          payload.iteration = 99;
          break;
        case 'provider':
          payload.toolCallId = 'other-provider-id';
          break;
        case 'invocation':
          meta.sourcePosition.drillPath = ['other-visit#0'];
          break;
        case 'run':
          meta.runId = 'other-run';
          break;
        case 'key':
          delete payload.callOccurrenceKey;
          break;
      }
      events[index] = { ...declaration, meta, payload } as AgentfootprintEvent;
    }
    const changed = { ...source, events };
    const whole = accountForAnswer(changed).facts.calls[0]?.expectation;
    expect(whole).toEqual(
      ['run', 'key', 'missing'].includes(axis) ? undefined : { basis: 'direct' },
    );
    missing(changed);
  });

  it.each([
    ['between', false, false, 'lone'],
    ['after', false, false, 'lone'],
    ['after', false, false, 'twice'],
    ['between', true, false, 'lone'],
    ['after', true, false, 'lone'],
    ['after', true, true, 'lone'],
  ] as const)(
    'preserves timely authority for %s, original %j, conflict %j, copy %s',
    async (position, keepFirst, conflict, count) => {
      const { source } = await original();
      const declaration = source.events.find(({ type }) => type === DECLARED)!;
      const events = source.events.filter((event) => keepFirst || event !== declaration);
      const marker = events.findIndex(
        ({ type }) => type === (position === 'between' ? START : END),
      );
      const repeat = conflict
        ? ({
            ...declaration,
            payload: { ...declaration.payload, basis: 'exploratory' },
          } as AgentfootprintEvent)
        : declaration;
      events.splice(marker + 1, 0, ...(count === 'twice' ? [repeat, repeat] : [repeat]));
      const changed = { ...source, events };
      const { account, pointers } = expectationPointer(changed);
      expect(account.facts.calls[0]?.expectation).toEqual({ basis: 'direct' });
      if (!keepFirst || conflict) {
        missing(changed);
        return;
      }
      const bundle = replay(changed);
      expect(bundle.gaps).toEqual([]);
      expect(bundle.events[marker + 1]?.event.payload).toEqual({});
      expect(pointers).toEqual([
        expect.objectContaining({ index: source.events.indexOf(declaration), path: '/basis' }),
      ]);
      const projected = buildAccountFromView(bundleView(bundle)!, validateDeclarations(undefined));
      expect(projected).toEqual(account);
    },
  );

  it.each([
    'timely-identical',
    'earlier-conflict',
    'unproved-late-prefix',
    'unproved-late-rating',
  ] as const)('keeps only witnessed repeats: %s', async (scenario) => {
    const { source } = await original();
    const events = [...source.events];
    const at = events.findIndex(({ type }) => type === DECLARED);
    const first = events[at]!;
    if (scenario === 'earlier-conflict') {
      const rival = { ...first, payload: { ...first.payload, basis: 'exploratory' } };
      events.splice(at, 0, rival as AgentfootprintEvent);
      expect(accountForAnswer({ ...source, events }).facts.calls[0]?.expectation).toEqual({
        basis: 'exploratory',
      });
      missing({ ...source, events });
    } else if (scenario === 'unproved-late-prefix' || scenario === 'unproved-late-rating') {
      const after = events.findIndex(({ type }) => type === END) + 1;
      const prefix = first.meta.sourcePosition!;
      const rival = {
        ...first,
        meta: {
          ...first.meta,
          sourcePosition: {
            ...prefix,
            committedThroughIdx: prefix.committedThroughIdx - 1,
          },
        },
      };
      events.splice(
        after,
        0,
        scenario === 'unproved-late-prefix'
          ? rival
          : ({ ...first, payload: { ...first.payload, expect: 'high' } } as AgentfootprintEvent),
      );
      missing({ ...source, events });
    } else {
      events.splice(at + 1, 0, first);
      const observed = replay({ ...source, events });
      expect(observed.gaps).toEqual([]);
      expect(observed.events[at]?.event.payload).toMatchObject({ basis: 'direct' });
      expect(observed.events[at + 1]?.event.payload).toEqual({});
    }
  });

  it('does not substitute a declaration from a different occurrence with the same provider ID', async () => {
    const { source } = await original();
    const events = [...source.events];
    const index = events.findIndex(({ type }) => type === DECLARED);
    const declaration = events[index]!;
    events[index] = {
      ...declaration,
      payload: { ...declaration.payload, callOccurrenceKey: [0, 1, 2, 3, 4] },
    } as AgentfootprintEvent;
    expect(accountForAnswer({ ...source, events }).facts.calls[0]?.expectation).toBeUndefined();
    missing({ ...source, events });
  });

  it('keeps the existing byte limit on provisional declarations', async () => {
    const { source } = await original();
    const events = source.events.map((event) =>
      event.type === DECLARED
        ? { ...event, payload: { ...event.payload, toolCallId: 'x'.repeat(BUDGET) } }
        : event,
    );
    const observed = replay({ ...source, events });
    expect(observed.gaps).toContain('budget');
    expect(bundleView(observed)).toBeUndefined();
    expect(
      observed.events.every(
        ({ event }) => event.type !== DECLARED || Object.keys(event.payload).length === 0,
      ),
    ).toBe(true);
  });

  it.each(['basis', 'expect', 'callOccurrenceKey', 'whole'] as const)(
    'withheld %s takes priority over provisional evidence',
    async (field) => {
      const { source } = await original();
      const snapshot = { ...(source.snapshot as object), recorders: [{ id: REDACTION_MARKER_ID }] };
      const events = source.events.map((event) =>
        event.type === DECLARED
          ? {
              ...event,
              payload: field === 'whole' ? 'REDACTED' : { ...event.payload, [field]: 'REDACTED' },
            }
          : event,
      ) as readonly AgentfootprintEvent[];
      const input = { ...source, snapshot, events };
      expect(accountForAnswer(input).facts.calls[0]?.expectation).toBeUndefined();
      expect(replay(input)).toEqual({
        version: 1,
        gaps: ['redaction'],
        firstRetainedIndex: 0,
        events: [],
      });
    },
  );

  it.each(['late marker', 'unresolved', 'failed'] as const)(
    'keeps the same final bytes for different concealed declarations under %s',
    async (policy) => {
      const { source } = await original();
      const first = source.events.findIndex(({ type }) => type === DECLARED);
      const originalDeclaration = source.events[first]!;
      const different = {
        ...originalDeclaration,
        payload: { ...originalDeclaration.payload, basis: 'exploratory', expect: 'high' },
      } as AgentfootprintEvent;
      const withDifferent = [...source.events];
      withDifferent[first] = different;
      withDifferent.splice(first, 0, different);
      const snapshot =
        policy === 'late marker'
          ? { ...(source.snapshot as object), recorders: [{ id: REDACTION_MARKER_ID }] }
          : undefined;
      const firstBundle = replay({ ...source, snapshot }, BUDGET, policy === 'failed');
      const secondBundle = replay(
        { ...source, events: withDifferent, snapshot },
        BUDGET,
        policy === 'failed',
      );
      expect(firstBundle).toEqual({
        version: 1,
        gaps: ['redaction'],
        firstRetainedIndex: 0,
        events: [],
      });
      expect(JSON.stringify(secondBundle)).toBe(JSON.stringify(firstBundle));
      expect(bundleView(secondBundle)).toBeUndefined();
    },
  );
});
