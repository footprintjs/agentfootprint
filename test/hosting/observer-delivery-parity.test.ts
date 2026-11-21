/**
 * Ordered typed events across native observer delivery modes, generated from
 * real Agent and composition fixtures. A heartbeat bounds deliberately open
 * text streams so the original regression reports a failure and releases its
 * subscriptions.
 */
import { FlowChartExecutor, flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import {
  absent,
  Agent,
  allow,
  Conditional,
  defineTool,
  deny,
  graph,
  isPaused,
  LLMCall,
  Loop,
  Parallel,
  Sequence,
  slidingWindow,
  workflow,
  type AgentOptions,
} from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { conversationRedaction } from '../../src/doors/security.js';
import { EventDispatcher } from '../../src/events/dispatcher.js';
import type {
  AgentfootprintEvent,
  AgentfootprintEventMap,
  AgentfootprintEventType,
} from '../../src/events/registry.js';
import { encodeSSE } from '../../src/hosting/stream.js';
import { swarm } from '../../src/patterns/index.js';
import type { LLMProvider } from '../../src/provider-contract/types.js';
import { compositionRecorder } from '../../src/recorders/core/CompositionRecorder.js';
import { isDeferredPayloadSummary } from '../../src/recorders/core/deferredPayload.js';
import { errorBridge } from '../../src/recorders/core/ErrorBridge.js';
import {
  approval,
  call,
  mountReport,
  readWithHeartbeat,
  REPORT,
  reportBuilder,
  TURN_END,
  WARNING,
} from './fixtures/streamReport.js';

type Delivery = 'inline' | 'deferred' | 'ref' | 'summary';

function deliveryOptions(
  delivery: Delivery,
): Pick<AgentOptions, 'observerDelivery' | 'observerDeliveryOptions'> {
  return delivery === 'ref' || delivery === 'summary'
    ? { observerDelivery: 'deferred', observerDeliveryOptions: { capture: delivery } }
    : { observerDelivery: delivery };
}

const INCIDENT_QUESTION = 'Any open incidents for billing and payments?';
const INCIDENT_ANSWER = { summary: 'Fixture answer.', negatives: [] };
const incidentAnswerSchema = {
  type: 'object',
  properties: {
    summary: { type: 'string' },
    negatives: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          kind: { type: 'string', enum: ['none', 'not-found', 'complete'] },
          about: { type: ['string', 'number'] },
          restsOn: { type: 'array', items: { type: 'string' } },
        },
        required: ['kind', 'restsOn'],
        additionalProperties: false,
      },
    },
  },
  required: ['summary', 'negatives'],
  additionalProperties: false,
};

const READ_INCIDENTS = 'read_incidents';
const readIncidents = defineTool({
  name: READ_INCIDENTS,
  description: 'Read a synthetic incident archive.',
  inputSchema: { type: 'object', properties: { service: { type: 'string' } } },
  effects: 'read',
  search: {
    source: { what: 'incident store', said: ['incident store'] },
    subject: { what: 'incidents', said: ['incidents'] },
    arguments: [{ name: 'service', role: 'population' }],
    complete: 'within-arguments',
  },
  execute: ({ service }) =>
    service === 'billing'
      ? [{ incident: 'test incident' }]
      : { content: 'Service payments does not exist.', effects: [], status: 'denied' },
});

function incidentAgent(delivery: Delivery, { negatives = true, pause = false, turns = 1 } = {}) {
  const incidentCall = (id: string, service: string) => ({
    toolCalls: [{ id, name: READ_INCIDENTS, args: { service } }],
  });
  const builder = Agent.create({
    provider: mock({
      replies: Array.from({ length: turns }, () => [
        incidentCall('billing-call', 'billing'),
        incidentCall('payments-call', 'payments'),
        ...(pause ? [call('ask_approval', 'approval-call')] : []),
        JSON.stringify(INCIDENT_ANSWER),
      ]).flat(),
      chunkDelayMs: 0,
    }),
    model: 'mock',
    ...deliveryOptions(delivery),
  })
    .tool(readIncidents)
    .tool(approval)
    .toolMiddleware({ name: 'rule', onToolResult: () => allow() })
    .resultsLayer()
    .outputSchema(
      {
        parse(input: unknown) {
          const value = input as { summary?: unknown; negatives?: unknown } | null;
          if (typeof value?.summary !== 'string' || !Array.isArray(value.negatives)) {
            throw new Error('Expected a summary and a list of negative claims');
          }
          return input;
        },
      },
      { jsonSchema: incidentAnswerSchema },
    );
  if (negatives) builder.negativeClaims({ field: 'negatives', tools: [READ_INCIDENTS] });
  if (turns > 1) builder.window(slidingWindow({ keepRecentTurns: 1 }));
  return builder.build();
}

async function captureTextLeg<T>(
  agent: Agent,
  act: () => Promise<T>,
  composition?: EventDispatcher,
) {
  const events: AgentfootprintEvent[] = [];
  const collect = (event: AgentfootprintEvent) => events.push(event);
  const unsubscribe = agent.on('*', collect);
  const unsubscribeComposition = composition?.on('*', collect);
  const finishReading = readWithHeartbeat(agent, { format: 'text' });
  try {
    const outcome = await act();
    expect(await agent.drainObservers({ timeoutMs: 500 })).toMatchObject({ pending: 0 });
    return { outcome, events, stream: await finishReading() };
  } finally {
    await finishReading();
    unsubscribeComposition?.();
    unsubscribe();
  }
}

const eventTypes = (events: readonly AgentfootprintEvent[]) => events.map((event) => event.type);
function eventsOfType<Type extends AgentfootprintEventType>(
  events: readonly AgentfootprintEvent[],
  type: Type,
): AgentfootprintEventMap[Type][] {
  return events.filter((event): event is AgentfootprintEventMap[Type] => event.type === type);
}

const turnEnds = (events: readonly AgentfootprintEvent[]) => eventsOfType(events, TURN_END);

describe('typed observer delivery parity — coordinator incident case', () => {
  it.each([
    { delivery: 'inline', negatives: true },
    { delivery: 'deferred', negatives: true },
    { delivery: 'ref', negatives: true },
    { delivery: 'deferred', negatives: false },
  ] as const)('$delivery with negative claims $negatives', async ({ delivery, negatives }) => {
    const control = incidentAgent('inline', { negatives });
    const agent = incidentAgent(delivery, { negatives });
    const baseline = await captureTextLeg(control, () => control.runTyped(INCIDENT_QUESTION));
    const actual = await captureTextLeg(agent, () => agent.runTyped(INCIDENT_QUESTION));
    expect(actual.outcome).toEqual(INCIDENT_ANSWER);
    expect(actual.stream.closed, 'text SSE must close after the native observer queue drains').toBe(
      true,
    );
    expect(actual.stream.chunks).toEqual(baseline.stream.chunks);
    expect(actual.stream.chunks.join('')).toBe(JSON.stringify(INCIDENT_ANSWER));
    expect(eventTypes(actual.events)).toEqual(eventTypes(baseline.events));
    const ends = turnEnds(actual.events);
    expect(ends).toHaveLength(1);
    expect(ends[0]?.meta.rootTurn).toBe(true);
    expect(ends[0]?.payload.answerNegatives !== undefined).toBe(negatives);
    const negativesPayload = ends[0]?.payload.answerNegatives;
    if (negativesPayload !== undefined) {
      expect(negativesPayload.claims).toEqual([]);
      expect(negativesPayload.checks.length).toBeGreaterThan(0);
      expect
        .soft(() => structuredClone(negativesPayload.claims), 'answerNegatives.claims')
        .not.toThrow();
      for (let index = 0; index < negativesPayload.checks.length; index += 1) {
        expect
          .soft(
            () => structuredClone(negativesPayload.checks[index]?.tools),
            `answerNegatives.checks[${index}].tools`,
          )
          .not.toThrow();
      }
      expect(() => structuredClone(ends[0])).not.toThrow();
    }
  });
});

describe('typed observer delivery parity — Agent legs', () => {
  it.each([
    {
      name: 'plain Agent',
      build: (delivery: Delivery) =>
        Agent.create({
          provider: mock({ reply: REPORT, chunkDelayMs: 0 }),
          model: 'mock',
          ...deliveryOptions(delivery),
        }).build(),
      answer: REPORT,
    },
    {
      name: 'default standing-line report',
      build: (delivery: Delivery) =>
        reportBuilder(REPORT, false, deliveryOptions(delivery)).build(),
      answer: REPORT + WARNING,
    },
    {
      name: 'mounted typed Agent',
      build: (delivery: Delivery) =>
        mountReport(incidentAgent('inline'), deliveryOptions(delivery)),
      answer: REPORT + WARNING,
    },
  ])('keeps ordered typed events and text for $name', async ({ name, build, answer }) => {
    const run = async (delivery: Delivery) => {
      const agent = build(delivery);
      const leg = await captureTextLeg(agent, () => agent.run({ message: INCIDENT_QUESTION }));
      expect(leg.outcome).toBe(answer);
      expect(leg.stream.closed).toBe(true);
      expect(leg.stream.chunks.join('')).toBe(answer);
      const ends = turnEnds(leg.events);
      expect(ends.filter((event) => event.meta.rootTurn)).toHaveLength(1);
      if (name === 'default standing-line report') {
        expect(eventTypes(leg.events)).toContain('agentfootprint.answer.assessed');
      }
      if (name === 'mounted typed Agent') {
        const mounted = ends.filter((event) => event.meta.mountedTurn);
        expect(mounted).toHaveLength(1);
        expect(mounted[0]?.payload.answerNegatives?.checks.length).toBeGreaterThan(0);
      }
      return { types: eventTypes(leg.events), chunks: leg.stream.chunks };
    };
    expect(await run('deferred')).toEqual(await run('inline'));
  });

  it.each([
    { location: 'root', mounted: false },
    { location: 'mounted', mounted: true },
  ])('compares separate pause and resume legs for a $location typed Agent', async ({ mounted }) => {
    const run = async (delivery: Delivery) => {
      const typed = incidentAgent(mounted ? 'inline' : delivery, { pause: true });
      const agent = mounted ? mountReport(typed, deliveryOptions(delivery)) : typed;
      const first = await captureTextLeg(agent, () => agent.run({ message: INCIDENT_QUESTION }));
      if (!isPaused(first.outcome)) throw new Error('Expected the approval tool to pause');
      const { checkpoint } = first.outcome;
      expect(turnEnds(first.events)).toHaveLength(0);
      expect(eventTypes(first.events)).toContain('agentfootprint.pause.request');
      expect(first.stream).toEqual({ closed: false, chunks: [] });

      const second = await captureTextLeg(agent, () =>
        agent.resume(checkpoint, { approved: true }),
      );
      expect(eventTypes(second.events)).toContain('agentfootprint.pause.resume');
      const ends = turnEnds(second.events);
      expect(ends.filter((event) => event.meta.rootTurn)).toHaveLength(1);
      expect(ends.filter((event) => event.meta.mountedTurn)).toHaveLength(mounted ? 1 : 0);
      expect(second.stream.closed).toBe(true);
      expect(second.stream.chunks.join('')).toBe(
        mounted ? REPORT + WARNING : JSON.stringify(INCIDENT_ANSWER),
      );
      return {
        pause: eventTypes(first.events),
        resumed: eventTypes(second.events),
        chunks: second.stream.chunks,
      };
    };
    expect(await run('deferred')).toEqual(await run('inline'));
  });

  it('compares later turns of the same Agent, including history eviction', async () => {
    const run = async (delivery: Delivery) => {
      const agent = incidentAgent(delivery, { turns: 3 });
      const legs = [];
      for (const message of [
        INCIDENT_QUESTION,
        'Check the services again.',
        'Check one last time.',
      ]) {
        const leg = await captureTextLeg(agent, () =>
          agent.runTyped({
            message,
            continueFrom: agent.checkpoint(),
          }),
        );
        expect(leg.outcome).toEqual(INCIDENT_ANSWER);
        expect(turnEnds(leg.events)).toHaveLength(1);
        expect(leg.stream.closed).toBe(true);
        legs.push({ types: eventTypes(leg.events), chunks: leg.stream.chunks });
      }
      expect(legs[2]?.types).toContain('agentfootprint.context.evicted');
      return legs;
    };
    expect(await run('deferred')).toEqual(await run('inline'));
  });
});

const fixtureCall = (reply: string) =>
  LLMCall.create({
    provider: mock({ reply, chunkDelayMs: 0 }),
    model: 'mock',
  })
    .system('')
    .build();

const compositions = [
  { name: 'LLMCall', build: () => fixtureCall('One'), boundary: 'agentfootprint.stream.llm_end' },
  {
    name: 'Sequence',
    build: () =>
      Sequence.create().step('one', fixtureCall('One')).step('two', fixtureCall('Two')).build(),
    boundary: 'agentfootprint.composition.exit',
  },
  {
    name: 'Parallel',
    build: () =>
      Parallel.create()
        .branch('one', fixtureCall('One'))
        .branch('two', fixtureCall('Two'))
        .mergeWithFn((results) => Object.values(results).join(','))
        .build(),
    boundary: 'agentfootprint.composition.merge_end',
  },
  {
    name: 'Conditional',
    build: () =>
      Conditional.create()
        .when('chosen', () => true, fixtureCall('One'))
        .otherwise('other', fixtureCall('Two'))
        .build(),
    boundary: 'agentfootprint.composition.route_decided',
  },
  {
    name: 'Loop',
    build: () => Loop.create().repeat(fixtureCall('One')).times(2).build(),
    boundary: 'agentfootprint.composition.iteration_exit',
  },
  {
    name: 'Workflow',
    build: () => workflow(fixtureCall('One'), fixtureCall('Two')),
    boundary: 'agentfootprint.composition.exit',
  },
  {
    name: 'Graph',
    build: () =>
      graph({
        nodes: [
          { id: 'one', runner: fixtureCall('One') },
          { id: 'two', runner: fixtureCall('Two') },
        ],
        edges: [{ from: 'one', to: 'two' }],
      }),
    boundary: 'agentfootprint.composition.exit',
  },
  {
    name: 'Swarm',
    build: () =>
      swarm({
        agents: [
          { id: 'chosen', runner: fixtureCall('One') },
          { id: 'unused', runner: fixtureCall('Two') },
        ],
        route: () => 'chosen',
      }),
    boundary: 'agentfootprint.composition.iteration_exit',
  },
] as const;

describe('typed observer delivery parity — composition fixtures', () => {
  it.each(['inline', 'deferred'] as const)(
    'uses neutral wording for a composition failure under %s delivery',
    async (delivery) => {
      const failure = new Error('Unable to combine the member outputs', {
        cause: () => 'application callback',
      });
      const member = flowChart(
        'Reject the merge',
        () => {
          throw failure;
        },
        'merge',
      ).build();
      const chart = flowChart('Composition', () => undefined, 'composition')
        .addSubFlowChartNext('member', member, 'Member')
        .build();
      // Public composition runners attach their bridges inline. Use a native
      // composition here so the same bridge can receive a real clone summary.
      const executor = new FlowChartExecutor(chart);
      const dispatcher = new EventDispatcher();
      const events: AgentfootprintEvent[] = [];
      dispatcher.on('agentfootprint.error.fatal', (event) => events.push(event));
      const fatal = errorBridge({
        dispatcher,
        getRunContext: () => ({ runId: 'composition', runStartMs: 0, compositionPath: [] }),
        fallback: 'run',
      });
      const summaries: boolean[] = [];
      if (delivery === 'deferred') {
        executor.attachCombinedRecorder(fatal.preserveFailureForDeferredCapture());
      }
      executor.attachCombinedRecorder(fatal, { delivery });
      executor.attachFlowRecorder(
        {
          id: 'native-failure-delivery',
          onRunFailed: (event) => summaries.push(isDeferredPayloadSummary(event)),
        },
        { delivery },
      );
      await expect(executor.run()).rejects.toBe(failure);
      expect(summaries).toEqual([delivery === 'deferred']);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        payload: { error: 'The run failed: Unable to combine the member outputs', scope: 'run' },
      });
    },
  );

  it.each(compositions)('preserves ordered typed events for $name', async ({ build, boundary }) => {
    const run = async (delivery: Delivery) => {
      const agent = mountReport(build(), deliveryOptions(delivery));
      // Standalone compositions fix their built-in tier to inline. Mount the
      // same fixture into an Agent and attach its ordinary composition bridge
      // so both arms encounter the real Agent-owned observer queue.
      const dispatcher = new EventDispatcher();
      const detach = agent.attach(
        compositionRecorder({
          dispatcher,
          getRunContext: () => ({ runId: 'mounted-fixture', runStartMs: 0, compositionPath: [] }),
        }),
      );
      try {
        const leg = await captureTextLeg(
          agent,
          () => agent.run({ message: INCIDENT_QUESTION }),
          dispatcher,
        );
        expect(leg.outcome).toBe(REPORT + WARNING);
        expect(leg.stream.closed).toBe(true);
        expect(leg.stream.chunks.join('')).toBe(REPORT + WARNING);
        const mounted = leg.events.filter((event) => event.meta.subflowPath.includes('specialist'));
        expect(eventTypes(mounted)).toContain(boundary);
        expect(turnEnds(leg.events).filter((event) => event.meta.rootTurn)).toHaveLength(1);
        return { types: eventTypes(leg.events), chunks: leg.stream.chunks };
      } finally {
        detach();
      }
    };
    expect(await run('deferred')).toEqual(await run('inline'));
  });
});

describe('typed observer delivery parity — result and terminal controls', () => {
  it('preserves the standing line and its recorded tool display name', async () => {
    const run = async (delivery: Delivery) => {
      const name = 'load_attachment';
      const displayName = 'loading the attached data';
      const agent = Agent.create({
        provider: mock({ replies: [call(name), REPORT], chunkDelayMs: 0 }),
        model: 'mock',
        ...deliveryOptions(delivery),
      })
        .tool(
          defineTool({
            name,
            displayName,
            description: 'Load the attached file.',
            inputSchema: { type: 'object', properties: {} },
            execute: () => absent({ what: 'the file', checked: ['the attached files'] }),
          }),
        )
        .answerLayer({ standingLine: true })
        .build();

      const { events, outcome, stream } = await captureTextLeg(agent, () =>
        agent.run({ message: 'Read the attachment.' }),
      );
      const expected = `${REPORT}\n\n---\n\nNot sure — ${displayName} reported no matching results.`;
      expect(outcome).toBe(expected);
      expect(stream.closed).toBe(true);
      expect(stream.chunks.join('')).toBe(expected);
      const ends = turnEnds(events);
      expect(ends).toHaveLength(1);
      expect(ends[0]?.payload.standingLineNames).toEqual({ [name]: displayName });
      return { types: eventTypes(events), chunks: stream.chunks };
    };
    expect(await run('deferred')).toEqual(await run('inline'));
  });

  it('retains the tool and provider contracts when the raw result contains a function', async () => {
    const run = async (delivery: Delivery) => {
      const dispatch = call('read_raw_result', 'raw-call');
      const raw = { summary: 'fixture rows', callback: () => 42 };
      const observed: unknown[] = [];
      const providerSaw: (string | undefined)[] = [];
      const agent = Agent.create({
        provider: mock({
          chunkDelayMs: 0,
          respond: (request) => {
            const result = request.messages.find((message) => message.role === 'tool');
            if (result === undefined) return dispatch;
            providerSaw.push(result.content);
            return REPORT;
          },
        }),
        model: 'mock',
        ...deliveryOptions(delivery),
      })
        .tool(
          defineTool({
            name: 'read_raw_result',
            description: 'Read a synthetic result with an in-process callback.',
            inputSchema: { type: 'object', properties: {} },
            execute: () => raw,
          }),
        )
        .toolMiddleware({
          name: 'observe-raw',
          onToolResult: ({ result }) => {
            observed.push(result);
            return allow();
          },
        })
        .build();

      const finishFull = readWithHeartbeat(agent, {
        format: 'full',
        filter: (event) => event.type === 'agentfootprint.stream.tool_end',
      });
      const { events, outcome, stream } = await captureTextLeg(agent, () =>
        agent.run({ message: 'Read the fixture.' }),
      ).finally(() => finishFull());
      const full = await finishFull();
      expect(observed).toEqual([raw]);
      expect(providerSaw).toEqual(['{"summary":"fixture rows"}']);
      expect(outcome).toBe(REPORT);
      expect(stream.closed).toBe(true);
      expect(stream.chunks.join('')).toBe(REPORT);
      expect(turnEnds(events)).toHaveLength(1);
      const toolEnds = eventsOfType(events, 'agentfootprint.stream.tool_end');
      expect(toolEnds).toHaveLength(1);
      if (delivery === 'deferred') {
        expect(toolEnds[0]?.payload.result).toEqual({ summary: 'fixture rows' });
        expect(() => structuredClone(toolEnds[0])).not.toThrow();
      } else {
        expect(toolEnds[0]?.payload.result).toEqual(raw);
      }
      expect(full.closed).toBe(true);
      expect(full.chunks).toHaveLength(1);
      const frame = full.chunks[0];
      if (frame === undefined) throw new Error('Expected the tool result on full SSE');
      expect(frame).toContain('"result":{"summary":"fixture rows"}');
      const served = JSON.parse(
        frame.split('\n')[1]?.slice('data: '.length) ?? '',
      ) as (typeof toolEnds)[number];
      const { sourcePosition, ...meta } = served.meta;
      const { callOccurrenceKey } = served.payload;
      const normalized = {
        ...served,
        payload: {
          ...served.payload,
          durationMs: 0,
          ...(callOccurrenceKey !== undefined && {
            // The first four words hash the run namespace. Keep the occurrence ordinal.
            callOccurrenceKey: [0, 0, 0, 0, callOccurrenceKey[4]],
          }),
        },
        meta: {
          ...meta,
          wallClockMs: 0,
          runOffsetMs: 0,
          runId: 'fixture',
          ...(sourcePosition !== undefined && {
            sourcePosition: {
              ...sourcePosition,
              engineRunId: 'fixture',
              logRunId: 'fixture',
            },
          }),
        },
      };
      return {
        types: eventTypes(events),
        chunks: stream.chunks,
        toolFrame: encodeSSE(normalized.type, normalized),
      };
    };
    const deferred = await run('deferred');
    const inline = await run('inline');
    expect(await run('ref')).toEqual(inline);
    expect(deferred).toEqual(inline);
  });

  it.each(['provider failure', 'policy refusal', 'cancellation'] as const)(
    'preserves one native fatal terminal under redaction for %s',
    async (kind) => {
      const run = async (delivery: Delivery, privateValue: string) => {
        const abort = new AbortController();
        const provider: LLMProvider = {
          name: 'fixture-provider',
          complete: async () => {
            if (kind === 'cancellation') abort.abort(new Error(privateValue));
            throw abort.signal.reason ?? new Error(privateValue);
          },
        };
        const builder = Agent.create({
          provider:
            kind === 'policy refusal' ? mock({ reply: privateValue, chunkDelayMs: 0 }) : provider,
          model: 'mock',
          redact: conversationRedaction({ keys: ['error'] }),
          ...deliveryOptions(delivery),
        });
        if (kind === 'policy refusal') {
          builder.act({
            output: [{ name: 'refuse', onMessage: () => deny('Fixture policy refused.') }],
          });
        }
        const agent = builder.build();
        const nativeOrder: ('emit' | 'fatal')[] = [];
        const detach = agent.attach({
          id: 'fatal-order-witness',
          onEmit: () => void nativeOrder.push('emit'),
        });
        const unsubscribe = agent.on('agentfootprint.error.fatal', () => {
          nativeOrder.push('fatal');
        });
        const leg = await captureTextLeg(agent, () =>
          agent
            .run({ message: 'Check the fixture.' }, { signal: abort.signal })
            .catch((error: unknown) => ({ error, nativeOrderAtRejection: [...nativeOrder] })),
        ).finally(() => {
          unsubscribe();
          detach();
        });

        expect(leg.outcome).toMatchObject({ error: expect.any(Error) });
        const fatal = eventsOfType(leg.events, 'agentfootprint.error.fatal');
        expect(fatal).toHaveLength(1);
        expect(fatal[0]?.payload.scope).toBe('run');
        expect(nativeOrder.indexOf('fatal')).toBeGreaterThan(0);
        expect(nativeOrder.at(-1)).toBe('fatal');
        expect(leg.outcome).toMatchObject({ nativeOrderAtRejection: nativeOrder });
        expect(leg.stream).toEqual({ closed: true, chunks: [] });
        expect(turnEnds(leg.events)).toHaveLength(0);
        const types = eventTypes(leg.events);
        if (delivery === 'summary') {
          expect(types).not.toContain('agentfootprint.stream.llm_start');
        } else {
          expect(types.indexOf('agentfootprint.stream.llm_start')).toBeGreaterThanOrEqual(0);
          expect(types.indexOf('agentfootprint.error.fatal')).toBeGreaterThan(
            types.indexOf('agentfootprint.stream.llm_start'),
          );
        }
        expect(JSON.stringify(leg.events)).not.toContain(privateValue);
        return {
          types: eventTypes(leg.events),
          payload: fatal[0]?.payload,
          stage: fatal[0]?.meta.runtimeStageId,
        };
      };
      const inline = await run('inline', 'PRIVATE-TERMINAL-ALPHA');
      expect(await run('deferred', 'PRIVATE-TERMINAL-BRAVO')).toEqual(inline);
      expect(await run('ref', 'PRIVATE-TERMINAL-CHARLIE')).toEqual(inline);
      expect(await run('summary', 'PRIVATE-TERMINAL-DELTA')).toMatchObject({
        payload: inline.payload,
        stage: inline.stage,
      });
    },
  );
});
