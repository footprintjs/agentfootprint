/** The adapter consumes the native writer's entries; records remain under their served policy. */
import { narrative } from 'footprintjs/recorders';
import type { RedactionPolicy } from 'footprintjs';
import { commitValueAt, findReadSources, isCommitBundle, stateAt } from 'foottrace';
import type { CommitBundle } from 'foottrace';
import { describe, expect, it, vi } from 'vitest';

import { Agent, askHuman, defineTool, isPaused, slidingWindow } from '../../../src/index.js';
import { mock } from '../../../src/doors/providers.js';
import { recordRun } from '../../../src/doors/observe.js';
import { conversationRedaction } from '../../../src/doors/security.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../../src/memory/index.js';
import type { MemoryEntry } from '../../../src/memory/entry/index.js';
import type { LLMMessage, LLMProvider } from '../../../src/provider-contract/types.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';
import { identity, sdkFixture, sdkStore } from './agentcore-event-payload.fixtures.js';
import type { Choice, Selector } from './agentcore-event-payload.fixtures.js';
import { locationsOf, withoutAnswerBoundary } from '../../redaction/fixture.js';

type Fixture = ReturnType<typeof sdkFixture>;
type Snapshot = NonNullable<ReturnType<Agent['getLastSnapshot']>>;

/** An explicit application projection of the two message roles written by prepareFinal. */
function selectMessage(value: MemoryEntry): Choice {
  const message = value.value as LLMMessage;
  if (message.role !== 'user' && message.role !== 'assistant') {
    throw new Error('The fixture only projects native user/assistant entries');
  }
  return { kind: 'conversational', role: message.role, text: message.content };
}

function builder(
  fixture: Fixture,
  eventPayload: Selector | undefined,
  options: {
    provider?: LLMProvider;
    reply?: string;
    commitValues?: 'full' | 'delta';
    observerDelivery?: 'inline' | 'deferred';
    redact?: RedactionPolicy;
  } = {},
) {
  const { provider, reply, ...recordOptions } = options;
  return Agent.create({
    provider: provider ?? mock({ reply: reply ?? 'Native answer.', chunkDelayMs: 0 }),
    model: 'mock',
    maxIterations: 8,
    ...recordOptions,
  }).memory(
    defineMemory({
      id: 'chat',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: sdkStore(fixture, eventPayload),
    }),
  );
}

function written(fixture: Fixture) {
  return fixture.creates().map(({ input }) => {
    const payload = input.payload as [
      { blob: string },
      { conversational?: { content: { text: string }; role: string } }?,
    ];
    return {
      entry: JSON.parse(payload[0].blob) as MemoryEntry<LLMMessage>,
      conversation: payload[1]?.conversational,
    };
  });
}

/** Read THIS native writer's committed input, not a later reset of the parent's turn payload. */
function turnMessages(snapshot: Snapshot): unknown {
  const writers = new Map<
    string,
    {
      index: number;
      history: CommitBundle[];
      initialState?: Record<string, unknown>;
    }
  >();
  for (const result of Object.values(snapshot.subflowResults ?? {})) {
    const context = (
      result as {
        treeContext?: { history: unknown[]; initialState?: Record<string, unknown> };
      }
    ).treeContext;
    if (!context) continue;
    const history = context.history;
    if (!history.every(isCommitBundle)) throw new Error('Unreadable native subflow log');
    history.forEach((bundle, index) => {
      if (/sf-memory-write-chat\/write-messages#\d+$/.test(bundle.runtimeStageId)) {
        // Live and JSON snapshots both expose path and execution aliases of this same result.
        const previous = writers.get(bundle.runtimeStageId);
        if (previous) expect(previous.history).toEqual(history);
        else
          writers.set(bundle.runtimeStageId, {
            index,
            history,
            initialState: context.initialState,
          });
      }
    });
  }
  expect([...writers.keys()], 'one actual native writeMessages execution').toHaveLength(1);
  const writer = [...writers.values()][0];
  const sources = findReadSources(writer.history, writer.index, 'newMessages');
  expect(sources.during, 'the writer input has no concurrent replacement').toEqual([]);
  const input = stateAt(writer, sources.before);
  expect(input.skipped).toBeUndefined();
  expect(input.basis).toBe('initial+log');
  return input.state.newMessages;
}

async function record(agent: Agent, go: () => Promise<unknown>) {
  agent.attach(narrative());
  const events: AgentfootprintEvent[] = [];
  const off = agent.on('*', (event) => events.push(event));
  const recorder = recordRun(agent);
  try {
    const result = await go();
    const snapshot = agent.getLastSnapshot()!;
    const saved = JSON.parse(JSON.stringify(recorder.toRecording())) as {
      snapshot: Snapshot;
      events: AgentfootprintEvent[];
      structure: unknown;
    };
    return { result, snapshot, saved, events };
  } finally {
    recorder.stop();
    off();
  }
}

describe('AgentCore event payload — native writeMessages and saved native records', () => {
  it.each([
    ['full', 'inline'],
    ['full', 'deferred'],
    ['delta', 'inline'],
    ['delta', 'deferred'],
  ] as const)(
    'uses actual writer entries under %s commits and %s observers',
    async (commitValues, observerDelivery) => {
      const fixture = sdkFixture();
      const select = vi.fn(selectMessage);
      const agent = builder(fixture, select, { commitValues, observerDelivery }).build();
      const run = await record(agent, () => agent.run({ message: 'Native question.', identity }));
      const rows = written(fixture);
      expect(run.result).toBe('Native answer.');
      expect(select).toHaveBeenCalledTimes(2);
      expect(fixture.creates()).toHaveLength(2);
      expect(rows.map(({ entry }) => entry.id)).toEqual(['msg-1-0', 'msg-1-1']);
      expect(rows.map(({ entry }) => entry.value)).toEqual([
        { role: 'user', content: 'Native question.' },
        { role: 'assistant', content: 'Native answer.' },
      ]);
      for (const row of rows) {
        expect(row.entry.source).toEqual({ turn: 1, identity });
        expect(row.entry.version).toBe(1);
        expect(row.conversation).toEqual({
          content: { text: row.entry.value.content },
          role: row.entry.value.role.toUpperCase(),
        });
      }
      expect(run.snapshot.commitValues).toBe(commitValues);
      expect(turnMessages(run.snapshot)).toEqual(rows.map(({ entry }) => entry.value));
      expect(turnMessages(run.saved.snapshot)).toEqual(turnMessages(run.snapshot));
      expect(run.saved.events.map(({ type }) => type)).toEqual(run.events.map(({ type }) => type));
      expect(run.saved.structure).toBeDefined();
      const recorderRows = run.saved.snapshot.recorders ?? [];
      const lines = recorderRows.find(({ id }) => id.startsWith('combined-narrative'))?.data as
        | { runtimeStageId?: string }[]
        | undefined;
      expect(
        lines?.some(({ runtimeStageId }) =>
          /sf-memory-write-chat\/write-messages#\d+$/.test(runtimeStageId ?? ''),
        ),
      ).toBe(true);
      expect(JSON.stringify(run.saved)).not.toContain('eventPayload');
    },
  );

  it('restores a JSON conversation checkpoint and projects only the fresh native turn', async () => {
    const fixture = sdkFixture();
    const firstSelect = vi.fn(selectMessage);
    const first = builder(fixture, firstSelect).build();
    await first.run({ message: 'First question.', identity });
    const checkpoint = JSON.parse(JSON.stringify(first.checkpoint()));
    expect(
      checkpoint.history.some((message: LLMMessage) => message.content === 'First question.'),
    ).toBe(true);
    const firstBodies = structuredClone(fixture.creates());
    const nextSelect = vi.fn(selectMessage);
    const next = builder(fixture, nextSelect, { reply: 'Fresh answer.' }).build();
    const run = await record(next, () =>
      next.run({ message: 'Fresh question.', identity, continueFrom: checkpoint }),
    );
    expect(firstSelect).toHaveBeenCalledTimes(2);
    expect(nextSelect).toHaveBeenCalledTimes(2);
    expect(fixture.creates().slice(0, 2)).toEqual(firstBodies);
    const fresh = written(fixture).slice(2);
    expect(fresh.map(({ entry }) => entry.id)).toEqual(['msg-2-0', 'msg-2-1']);
    expect(fresh.map(({ entry }) => entry.value.content)).toEqual([
      'Fresh question.',
      'Fresh answer.',
    ]);
    expect(turnMessages(run.saved.snapshot)).toEqual(fresh.map(({ entry }) => entry.value));
  });

  it('a serialized pause writes nothing until a fresh instance resumes into the native writer', async () => {
    const fixture = sdkFixture();
    const select = vi.fn(selectMessage);
    const approval = defineTool({
      name: 'approve',
      description: 'Ask for approval.',
      inputSchema: { type: 'object', properties: {} },
      execute: () => askHuman({ question: 'Continue?' }),
    });
    const first = builder(fixture, select, {
      provider: mock({
        replies: [{ toolCalls: [{ id: 'approval', name: 'approve', args: {} }] }],
        chunkDelayMs: 0,
      }),
      observerDelivery: 'deferred',
    })
      .tool(approval)
      .build();
    const paused = await first.run({ message: 'Remember after approval.', identity });
    expect(isPaused(paused)).toBe(true);
    if (!isPaused(paused)) throw new Error('Expected a native pause');
    expect(select).not.toHaveBeenCalled();
    expect(fixture.creates()).toHaveLength(0);
    const fresh = builder(fixture, select, {
      reply: 'Resumed answer.',
      observerDelivery: 'deferred',
    })
      .tool(approval)
      .build();
    const run = await record(fresh, () =>
      fresh.resume(JSON.parse(JSON.stringify(paused.checkpoint)), 'approved'),
    );
    expect(String(run.result)).toContain('Resumed answer.');
    expect(select).toHaveBeenCalledTimes(2);
    expect(written(fixture).map(({ entry }) => entry.value.content)).toEqual([
      'Remember after approval.',
      run.result,
    ]);
    expect(run.events.map(({ type }) => type)).toContain('agentfootprint.pause.resume');
    expect(turnMessages(run.saved.snapshot)).toEqual(
      written(fixture).map(({ entry }) => entry.value),
    );
  });
});

/** Same normalization as the existing observer-delivery harness, limited to timing and run ids. */
function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /ms$/i.test(key) && typeof item === 'number'
          ? 0
          : key === 'runId' || key === 'correlationId'
          ? '<run>'
          : stable(item),
      ]),
    );
  }
  return value;
}

describe('AgentCore event payload — private backend values follow the existing served-record policy', () => {
  it.each(['inline', 'deferred'] as const)(
    'keeps paired private content equal on served values/counts/positions (%s)',
    async (observerDelivery) => {
      const drive = async (secret: string, redact: boolean, conversational = true) => {
        const fixture = sdkFixture();
        const select = vi.fn(selectMessage);
        const agent = builder(fixture, conversational ? select : undefined, {
          observerDelivery,
          reply: `Answer ${secret}`,
          ...(redact && { redact: conversationRedaction() }),
        }).build();
        const run = await record(agent, () =>
          agent.run({ message: `Remember ${secret}`, identity }),
        );
        return { fixture, select, ...run };
      };
      const control = await drive('PRIVATE-NATIVE-A', false);
      expect(JSON.stringify(control.saved)).toContain('PRIVATE-NATIVE-A');
      const left = await drive('PRIVATE-NATIVE-A', true);
      const right = await drive('PRIVATE-NATIVE-B', true);
      const blob = await drive('PRIVATE-NATIVE-A', true, false);
      for (const run of [left, right]) {
        expect(run.select).toHaveBeenCalledTimes(2);
        expect(run.fixture.creates()).toHaveLength(2);
        expect(JSON.stringify(written(run.fixture))).toContain(
          run === left ? 'PRIVATE-NATIVE-A' : 'PRIVATE-NATIVE-B',
        );
      }
      expect(blob.select).not.toHaveBeenCalled();
      // The policy's documented limit is the chart's bare-string return on run.exit.
      // Reuse its existing exact exclusion; any private value elsewhere still fails.
      for (const run of [left, right, blob]) {
        const secret = run === right ? 'PRIVATE-NATIVE-B' : 'PRIVATE-NATIVE-A';
        const rawLocations = locationsOf(run.saved, secret);
        expect(
          locationsOf(withoutAnswerBoundary(run.saved), secret),
          `private values outside the named return boundary; all locations: ${JSON.stringify(
            rawLocations,
          )}`,
        ).toEqual([]);
        expect(locationsOf(run.events, secret)).toEqual([]);
        expect(locationsOf(withoutAnswerBoundary(run.snapshot), secret)).toEqual([]);
        // Pin that enabling projection adds no exposure, including at the named limit.
        expect(rawLocations).toEqual(locationsOf(blob.saved, 'PRIVATE-NATIVE-A'));
      }
      const positions = (events: AgentfootprintEvent[]) =>
        events.map(({ type, meta }) => [type, meta.runtimeStageId]);
      expect(positions(left.events)).toEqual(positions(right.events));
      expect(positions(left.events)).toEqual(positions(blob.events));
      expect(JSON.stringify(turnMessages(left.saved.snapshot))).toBe(
        JSON.stringify(turnMessages(right.saved.snapshot)),
      );
      const publicValues = (events: AgentfootprintEvent[]) =>
        stable(
          events
            .filter(
              ({ type }) =>
                type.startsWith('agentfootprint.memory.') ||
                type === 'agentfootprint.agent.turn_end' ||
                type === 'agentfootprint.stream.token',
            )
            .map(({ type, payload, meta }) => ({
              type,
              payload,
              runtimeStageId: meta.runtimeStageId,
            })),
        );
      expect(JSON.stringify(publicValues(left.events))).toBe(
        JSON.stringify(publicValues(right.events)),
      );
      expect(JSON.stringify(publicValues(left.events))).toBe(
        JSON.stringify(publicValues(blob.events)),
      );
    },
  );
});

describe('AgentCore event payload — window changes do not reconstruct the writer input', () => {
  it.each([1, 99])(
    'projects the native final pair with a window retaining %s turns',
    async (keepRecentTurns) => {
      const fixture = sdkFixture();
      const select = vi.fn(selectMessage);
      const outputs: string[] = [];
      const lookup = defineTool({
        name: 'lookup',
        description: 'Return a scripted observation.',
        inputSchema: { type: 'object', properties: {} },
        execute: () => {
          const output = `INTERMEDIATE-${outputs.length} ${'x'.repeat(400)}`;
          outputs.push(output);
          return output;
        },
      });
      const replies = [0, 1, 2, 3].map((index) => ({
        content: '',
        toolCalls: [{ id: `lookup-${index}`, name: 'lookup', args: {} }],
      }));
      const agent = builder(fixture, select, {
        provider: mock({ replies: [...replies, { content: 'Window answer.' }], chunkDelayMs: 0 }),
        commitValues: 'delta',
      })
        .tool(lookup)
        .window(slidingWindow({ keepRecentTurns }))
        .build();
      const question = `Keep this request ${'b'.repeat(400)}`;
      const run = await record(agent, () => agent.run({ message: question, identity }));
      expect(select).toHaveBeenCalledTimes(2);
      const rows = written(fixture);
      expect(rows.map(({ entry }) => entry.value.content)).toEqual([question, run.result]);
      expect(rows.map(({ conversation }) => conversation?.content.text)).toEqual([
        question,
        run.result,
      ]);
      expect(JSON.stringify(rows)).not.toContain('INTERMEDIATE-');
      expect(turnMessages(run.saved.snapshot)).toEqual(rows.map(({ entry }) => entry.value));
      const evicted = run.events.filter(({ type }) => type === 'agentfootprint.context.evicted');
      if (keepRecentTurns === 1) {
        expect(evicted.length).toBeGreaterThan(0);
        const history = (run.snapshot.sharedState as { history: LLMMessage[] }).history;
        const removed = outputs.filter(
          (output) => !history.some(({ content }) => content === output),
        );
        expect(removed.length).toBeGreaterThan(0);
        const recorded = run.saved.snapshot.commitLog.flatMap(
          (_, index) =>
            (commitValueAt(run.saved.snapshot.commitLog, index, 'history') as
              | LLMMessage[]
              | undefined) ?? [],
        );
        for (const output of removed)
          expect(recorded.some(({ content }) => content === output)).toBe(true);
      } else {
        expect(evicted).toHaveLength(0);
      }
    },
  );
});
