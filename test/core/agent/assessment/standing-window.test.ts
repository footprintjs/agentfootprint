import { flowChart } from 'footprintjs';
import { describe, expect, it } from 'vitest';
import {
  absent,
  Agent,
  allow,
  coverage,
  defineTool,
  deny,
  isPaused,
  pauseHere,
  slidingWindow,
  summarizeOldest,
  type AgentOptions,
  type ToolMiddleware,
  type WindowStrategy,
} from '../../../../src/index.js';
import { mock } from '../../../../src/llm-providers.js';
import {
  defineMemory,
  InMemoryStore,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type MemoryDefinition,
} from '../../../../src/doors/memory.js';
import {
  accountForAnswer,
  assessAnswer,
  recordRun,
  type Recording,
} from '../../../../src/observe.js';
import { assessmentDataOf } from '../../../../src/core/agent/assessment/compose.js';
import type { AssessmentReason } from '../../../../src/core/agent/assessment/types.js';
import type { AnswerAssessedPayload } from '../../../../src/events/payloads/answer.js';
import type { AgentTurnEndPayload } from '../../../../src/events/payloads/agent.js';
import { readCallOccurrenceKey } from '../../../../src/lib/callOccurrence.js';
import { observeStanding } from './standing-surfaces.js';

const DONE = 'Done.';
const QUESTION = { message: 'Go.' };
const SUMMARY = 'Synthetic summary output.';
const WINDOW_MATERIAL = 'Retained synthetic fixture material. '.repeat(35);
const PRIVATE_NOTICE = 'This result is private.';
const WITHHELD = `${DONE}\n\n---\n\nNot sure — a result was kept out by a rule.`;
const DROP_REASON = 'result-dropped-from-window';
const dropClause = (count: number) =>
  `${count} ${
    count === 1 ? 'result from this turn was' : 'results from this turn were'
  } dropped from the conversation before the answer`;
const withheldWithDrop = (answer = DONE) =>
  `${answer}\n\n---\n\nNot sure — a result was kept out by a rule; ${dropClause(1)}.`;
const call = (name: string, id: string, args: Record<string, unknown> = {}) => ({
  content: '',
  toolCalls: [{ name, id, args }],
});
const batch = (...calls: ReturnType<typeof call>[]) => ({
  content: '',
  toolCalls: calls.flatMap(({ toolCalls }) => toolCalls),
});
const tool = (name: string, execute: () => unknown) =>
  defineTool({
    name,
    description: `Read ${name}.`,
    inputSchema: { type: 'object', properties: {} },
    execute,
  });

const filler = (output = 'ok') => tool('filler', () => output);
const approval = () => tool('ask_approval', () => pauseHere({ question: 'Approve?' }));
const gap = () => coverage([{ ok: true }], { checked: ['shelf B'], notChecked: ['shelf C'] });
const noMatch = () => absent({ what: 'order 77', checked: ['the live store'] });
const pending = () => ({ content: 'Queued as job 4242.', effects: [], status: 'pending' });
const rows = () => [{ order: 42 }];
const throws = () => {
  throw new Error('backend down');
};
const denyLookup: ToolMiddleware = {
  name: 'only-filler',
  onToolResult: (entry) => (entry.toolName === 'lookup' ? deny(PRIVATE_NOTICE) : allow()),
};

type Reply = string | ReturnType<typeof call>;
type Options = Pick<
  AgentOptions,
  'observerDelivery' | 'reactMode' | 'checkColumnTypes' | 'maxIterations'
>;
type Tool = ReturnType<typeof defineTool>;
const windowDoors = ['act-sliding', 'compaction', 'direct-summarize'] as const;
type WindowDoor = (typeof windowDoors)[number];

interface Shape {
  readonly execute?: () => unknown;
  readonly tools?: readonly Tool[];
  readonly replies?: readonly Reply[];
  readonly rule?: ToolMiddleware;
  readonly options?: Options;
  readonly defaultPins?: true;
  readonly windowPressure?: true;
  readonly memory?: MemoryDefinition;
  readonly answerLayerOff?: true;
  readonly windowStrategy?: WindowStrategy;
}

function build(shape: Shape, evicts: boolean | WindowDoor) {
  const replies = shape.replies ?? [call('lookup', 'c1'), call('filler', 'c2'), DONE];
  const historyAtRequest: string[][] = [];
  const summaryAtRequest: boolean[] = [];
  let i = 0;
  const provider = mock({
    chunkDelayMs: 0,
    respond(request) {
      historyAtRequest.push(
        request.messages.flatMap((entry) =>
          entry.role === 'tool' && entry.toolCallId !== undefined ? [entry.toolCallId] : [],
        ),
      );
      summaryAtRequest.push(request.messages.some(({ content }) => content.includes(SUMMARY)));
      const reply = replies[i++];
      if (reply === undefined) throw new Error('Unexpected additional model request.');
      if (!shape.windowPressure) return reply;
      // Cross the compaction threshold after the original result reaches the model.
      const usage = { input: 100 * i, output: 5 };
      return typeof reply === 'string' ? { content: reply, usage } : { ...reply, usage };
    },
  });
  const builder = Agent.create({
    provider,
    model: 'mock',
    ...(evicts && !shape.defaultPins && { keepLastToolResults: false as const }),
    ...shape.options,
  }).tools([
    ...(shape.tools ?? [tool('lookup', shape.execute ?? rows)]),
    filler(shape.windowPressure ? WINDOW_MATERIAL : undefined),
  ]);
  builder.answerLayer(shape.answerLayerOff ? false : { standingLine: true });
  if (evicts === true)
    builder.window(
      shape.windowStrategy ?? slidingWindow({ keepRecentTurns: shape.defaultPins ? 2 : 1 }),
    );
  if (evicts === 'act-sliding') builder.act({ window: slidingWindow({ keepRecentTurns: 1 }) });
  if (evicts === 'compaction' || evicts === 'direct-summarize') {
    const options = {
      thresholdTokens: 140,
      keepRecentTurns: 1,
      model: 'fixture-summarizer',
      summarizer: mock({ reply: SUMMARY }),
    };
    if (evicts === 'compaction') builder.compaction(options);
    else builder.window(summarizeOldest(options));
  }
  if (shape.rule !== undefined) builder.toolMiddleware(shape.rule);
  if (shape.memory !== undefined) builder.memory(shape.memory);
  return { agent: builder.build(), historyAtRequest, summaryAtRequest };
}

async function read(agent: Agent, drive = () => agent.run(QUESTION), mounted = false) {
  const recorder = recordRun(agent);
  const events: AnswerAssessedPayload[] = [];
  const turns: AgentTurnEndPayload[] = [];
  const offAssessed = agent.on('agentfootprint.answer.assessed', ({ payload }) =>
    events.push(payload),
  );
  const offEnd = agent.on('agentfootprint.agent.turn_end', ({ meta, payload }) => {
    if (meta?.rootTurn) turns.push(payload);
  });
  try {
    const returned = await drive();
    await agent.drainObservers();
    if (!mounted) expect(events).toHaveLength(1);
    expect(turns).toHaveLength(1);
    const { turn, iteration, ...event } = events.at(-1)!;
    const recording = JSON.parse(JSON.stringify(recorder.toRecording())) as Recording;
    const saved = assessAnswer(recording);
    expect(assessmentDataOf(saved)).toEqual(event);
    expect(turns[0]?.answerAssessment).toEqual(event);
    expect(turns[0]?.finalContent).toBe(returned);
    return { returned, event, saved, recording };
  } finally {
    offAssessed();
    offEnd();
    recorder.stop();
  }
}

interface WindowCase extends Shape {
  readonly name: string;
  readonly reason: AssessmentReason;
  readonly wording?: string;
}

const cases: readonly WindowCase[] = [
  { name: 'declared coverage gap', reason: 'coverage-gap', execute: gap },
  { name: 'declared absence', reason: 'declared-absent', execute: noMatch },
  {
    name: 'missing declared column',
    reason: 'missing-column',
    tools: [
      defineTool({
        name: 'lun_map',
        description: 'The LUN mappings.',
        inputSchema: { type: 'object', properties: {} },
        resultColumns: { logical_unit_number: 'number' },
        execute: () => [{ other: 1 }],
      }),
    ],
    options: { checkColumnTypes: 'warn' },
    replies: [call('lun_map', 'c1'), call('filler', 'c2'), DONE],
  },
  { name: 'withheld native return', reason: 'result-withheld', rule: denyLookup },
  {
    name: 'throw from execute',
    reason: 'call-not-completed',
    execute: throws,
    wording: 'Not sure — a call failed.',
  },
  {
    name: 'pre-dispatch refusal',
    reason: 'call-not-completed',
    wording: 'Not sure — a call was refused.',
    rule: {
      name: 'block-lookup',
      onToolCall: (entry) => (entry.toolName === 'lookup' ? deny('Not allowed.') : allow()),
    },
  },
  { name: 'pending work', reason: 'work-not-finished', execute: pending },
  { name: 'undeclared empty list', reason: 'empty-undeclared', execute: () => [] },
  {
    name: 'unsupported argument',
    reason: 'unsupported-argument',
    tools: [
      tool('fabric_inventory', () => 'device 20:00 is online'),
      defineTool({
        name: 'backup_status',
        description: 'Reads the backup record.',
        inputSchema: {
          type: 'object',
          properties: { machine: { type: 'string' } },
          required: ['machine'],
        },
        argumentsFrom: ['fabric_inventory'],
        execute: () => 'a record',
      }),
    ],
    replies: [call('backup_status', 'c1', { machine: 'made-up-host' }), call('filler', 'c2'), DONE],
  },
];

describe('the window keeps no authority over recorded call evidence', () => {
  it.each(cases)('$name ($reason) survives history eviction', async (shape) => {
    const retained = build(shape, false);
    const evicted = build(shape, true);
    try {
      const before = await read(retained.agent);
      const after = await read(evicted.agent);
      expect(retained.historyAtRequest.at(-1)).toEqual(['c1', 'c2']);
      expect(evicted.historyAtRequest.at(-1)).toEqual(['c2']);
      expect(before.event.reasons).toEqual([shape.reason]);
      const withheldOrSynthetic =
        shape.reason === 'result-withheld' || shape.reason === 'call-not-completed';
      expect([...after.event.reasons].sort()).toEqual(
        (withheldOrSynthetic ? [shape.reason] : [shape.reason, DROP_REASON]).sort(),
      );
      if (withheldOrSynthetic) expect(after.returned).toBe(before.returned);
      else expect(after.returned).toContain(dropClause(1));
      if (shape.wording !== undefined) {
        expect(after.returned).toBe(`${DONE}\n\n---\n\n${shape.wording}`);
        for (const { recording } of [before, after]) {
          expect(accountForAnswer(recording).facts.limitsBlock.value).toBe(shape.wording);
        }
      }
      if (shape.reason === 'result-withheld') expect(after.returned).toBe(WITHHELD);
    } finally {
      await retained.agent.shutdown();
      await evicted.agent.shutdown();
    }
  });
});

const doorCases: readonly (Shape & { name: string; reason?: AssessmentReason })[] = [
  ...cases,
  { name: 'clean control' },
];

it.each(windowDoors)('discloses visible current-turn results lost through %s', async (door) => {
  const calls = [
    call('lookup', 'c1'),
    ...Array.from({ length: 4 }, (_, index) => call('filler', `c${index + 2}`)),
  ];
  const shape: Shape = {
    options: { reactMode: 'dynamic' },
    windowPressure: true,
    replies: [...calls.map((reply) => ({ ...reply, content: WINDOW_MATERIAL })), DONE],
  };
  const retained = build(shape, false);
  const evicted = build(shape, door);
  const drive = (agent: Agent) => agent.run({ message: WINDOW_MATERIAL });
  try {
    const before = await read(retained.agent, () => drive(retained.agent));
    const after = await read(evicted.agent, () => drive(evicted.agent));
    const delivered = evicted.historyAtRequest.at(-1)!;
    const lost = retained.historyAtRequest.at(-1)!.filter((id) => !delivered.includes(id));
    expect(lost).toContain('c1');
    expect(delivered).toContain('c5');
    expect(before.event.standing).toBe('consistent');
    expect(before.returned).not.toContain('dropped from the conversation');
    expect(after.event.standing).toBe('not-sure');
    const warning = dropClause(lost.length);
    expect(after.returned).toContain(warning);
    expect(accountForAnswer(after.recording).facts.limitsBlock.value).toContain(warning);
  } finally {
    await retained.agent.shutdown();
    await evicted.agent.shutdown();
  }
});

it('keeps unarmed answer bytes even when the configured window drops a result', async () => {
  const shape: Shape = { answerLayerOff: true };
  const retained = build(shape, false);
  const evicted = build(shape, true);
  try {
    expect(await retained.agent.run(QUESTION)).toBe(DONE);
    expect(await evicted.agent.run(QUESTION)).toBe(DONE);
    expect(evicted.historyAtRequest.at(-1)).toEqual(['c2']);
    expect(evicted.agent.getLastSnapshot()?.sharedState).not.toHaveProperty('libraryResultLimits');
  } finally {
    await retained.agent.shutdown();
    await evicted.agent.shutdown();
  }
});

it('does not count a strategy report for a result kept in the applied window', async () => {
  const strategy = slidingWindow({ keepRecentTurns: 1 });
  const control = build({}, false);
  const kept = build(
    {
      windowStrategy: {
        name: strategy.name,
        async plan(input) {
          const result = await strategy.plan(input);
          if (result === undefined || result.window === undefined) return result;
          return {
            ...result,
            window: input.history,
            rebase: { headCount: input.history.length, keptTailCount: 0 },
          };
        },
      },
    },
    true,
  );
  try {
    const before = await read(control.agent);
    const after = await read(kept.agent);
    expect(kept.historyAtRequest.at(-1)).toEqual(['c1', 'c2']);
    expect(after.returned).toBe(before.returned);
    expect(after.event).toEqual(before.event);
    expect(kept.agent.getLastSnapshot()?.sharedState).not.toHaveProperty('libraryResultLimits');
  } finally {
    await control.agent.shutdown();
    await kept.agent.shutdown();
  }
});

describe.each(windowDoors)('standing through %s', (door) => {
  it.each(doorCases)('retains the verdict for $name', async (fixture) => {
    const first = fixture.replies?.[0] ?? call('lookup', 'c1');
    if (typeof first === 'string') throw new Error('Expected the first fixture call.');
    const calls = [
      first,
      ...Array.from({ length: 4 }, (_, index) => call('filler', `c${index + 2}`)),
    ];
    const shape: Shape = {
      ...fixture,
      options: { ...fixture.options, reactMode: 'dynamic' },
      windowPressure: true,
      replies: [...calls.map((reply) => ({ ...reply, content: WINDOW_MATERIAL })), DONE],
    };
    const retained = build(shape, false);
    const evicted = build(shape, door);
    const input = { message: WINDOW_MATERIAL };
    try {
      const before = await read(retained.agent, () => retained.agent.run(input));
      const after = await read(evicted.agent, () => evicted.agent.run(input));
      expect(retained.historyAtRequest.at(-1)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5']);
      expect(evicted.historyAtRequest[1]).toContain('c1');
      expect(evicted.historyAtRequest.at(-1)).not.toContain('c1');
      expect(evicted.historyAtRequest.at(-1)).toContain('c5');
      expect(retained.summaryAtRequest.at(-1)).toBe(false);
      expect(evicted.summaryAtRequest.at(-1)).toBe(door !== 'act-sliding');
      const savedFirstResult = (agent: Agent) =>
        agent
          .getLastSnapshot()
          ?.sharedState.history.some(
            ({ role, toolCallId }) => role === 'tool' && toolCallId === 'c1',
          );
      expect(savedFirstResult(retained.agent)).toBe(true);
      expect(savedFirstResult(evicted.agent)).toBe(false);
      expect(before.event.reasons).toEqual(fixture.reason === undefined ? [] : [fixture.reason]);
      expect([...after.event.reasons].sort()).toEqual(
        [...before.event.reasons, DROP_REASON].sort(),
      );
      if (fixture.reason === undefined) expect(before.event.standing).toBe('consistent');
      const delivered = evicted.historyAtRequest.at(-1)!;
      const withheldOrSynthetic =
        fixture.reason === 'result-withheld' || fixture.reason === 'call-not-completed';
      const visible = withheldOrSynthetic ? ['c2', 'c3', 'c4'] : ['c1', 'c2', 'c3', 'c4'];
      const lost = visible.filter((id) => !delivered.includes(id));
      expect(after.event.standing).toBe('not-sure');
      expect(after.returned).toContain(dropClause(lost.length));
    } finally {
      await retained.agent.shutdown();
      await evicted.agent.shutdown();
    }
  });
});

const hidden = [
  { name: 'declared absence', execute: noMatch },
  { name: 'declared coverage gap', execute: gap },
  { name: 'pending work', execute: pending },
  { name: 'order 42', execute: () => [{ order: 42, total: 9 }] },
  { name: 'order 17', execute: () => [{ order: 17, total: 3 }] },
  { name: 'empty list', execute: () => [] },
  { name: 'long text', execute: () => 'x'.repeat(20000) },
];

function pausedShape(execute: () => unknown, finalAnswer = DONE): Shape {
  return {
    tools: [tool('lookup', execute), approval()],
    replies: [call('lookup', 'c1'), call('ask_approval', 'c2'), call('filler', 'c3'), finalAnswer],
    rule: denyLookup,
  };
}

async function safeCheckpoint(agent: Agent) {
  const paused = await agent.run(QUESTION);
  if (!isPaused(paused)) throw new Error('Expected the fixture Agent to pause.');
  return JSON.parse(JSON.stringify(paused.checkpoint)) as typeof paused.checkpoint;
}

function publicAnswerBytes(proof: Awaited<ReturnType<typeof observeStanding>>) {
  const { durationMs, ...turnEnd } = proof.turnEnd;
  return {
    returned: JSON.stringify(proof.returned),
    textSse: proof.sse,
    agUiAssistantText: proof.aguiText,
    turnEnd: JSON.stringify(turnEnd),
    assessed: JSON.stringify({
      ...proof.eventAssessment,
      turn: proof.turn,
      iteration: proof.iteration,
    }),
    savedAssessment: JSON.stringify(proof.saved),
  };
}

describe('anonymous withholding when the tool result leaves history', () => {
  it.each([
    { pauses: false, finalAnswer: DONE },
    { pauses: true, finalAnswer: DONE },
    { pauses: false, finalAnswer: 'The order is 42.' },
    { pauses: true, finalAnswer: 'The order is 42.' },
  ])(
    'seven hidden results give the same public bytes (pauses=$pauses, answer=$finalAnswer)',
    async ({ pauses, finalAnswer }) => {
      let reference: ReturnType<typeof publicAnswerBytes> | undefined;
      for (const { execute, name } of hidden) {
        const { agent, historyAtRequest } = build(
          pauses
            ? pausedShape(execute, finalAnswer)
            : {
                execute,
                rule: denyLookup,
                replies: [call('lookup', 'c1'), call('filler', 'c2'), finalAnswer],
              },
          true,
        );
        try {
          const checkpoint = pauses ? await safeCheckpoint(agent) : undefined;
          const proof = await observeStanding(
            agent,
            QUESTION,
            checkpoint === undefined
              ? undefined
              : {
                  resume: { checkpoint, answer: { approved: true } },
                },
          );
          expect(historyAtRequest.at(-1)).not.toContain('c1');
          expect(proof.returned).toBe(
            pauses
              ? withheldWithDrop(finalAnswer)
              : `${finalAnswer}\n\n---\n\nNot sure — a result was kept out by a rule.`,
          );
          expect(proof.sse).toBe(proof.returned);
          expect(proof.aguiText).toBe(proof.returned);
          expect(proof.turnEnd.finalContent).toBe(proof.returned);
          expect(proof.eventAssessment.reasons).toEqual(
            pauses ? ['result-withheld', DROP_REASON] : ['result-withheld'],
          );
          expect(proof.turnEnd.answerAssessment).toEqual(proof.eventAssessment);
          expect(assessmentDataOf(proof.saved)).toEqual(proof.eventAssessment);
          expect(proof.saved.reasons[0]).toMatchObject({
            reason: 'result-withheld',
            source: { kind: 'run' },
            witness: [],
          });
          if (pauses) expect(proof.saved.reasons[1]?.witness).toHaveLength(1);
          const current = publicAnswerBytes(proof);
          reference ??= current;
          expect(current, name).toEqual(reference);
        } finally {
          await agent.shutdown();
        }
      }
    },
  );

  it.each([false, true])(
    'a fresh executor resumes from a JSON checkpoint (evicts=%s)',
    async (evicts) => {
      const shape = pausedShape(rows);
      const first = build(shape, evicts);
      const resumed = build({ ...shape, replies: [call('filler', 'c3'), DONE] }, evicts);
      try {
        const checkpoint = await safeCheckpoint(first.agent);
        const proof = await read(resumed.agent, () =>
          resumed.agent.resume(checkpoint, { approved: true }),
        );
        expect(resumed.historyAtRequest.at(-1)?.includes('c1')).toBe(!evicts);
        expect(proof.event.reasons).toEqual(
          evicts ? ['result-withheld', DROP_REASON] : ['result-withheld'],
        );
        expect(proof.returned).toBe(evicts ? withheldWithDrop() : WITHHELD);
      } finally {
        await first.agent.shutdown();
        await resumed.agent.shutdown();
      }
    },
  );
});

describe('recorded settlement across the coordinator window axes', () => {
  it.each(
    (['classic', 'dynamic', 'dynamic-grouped'] as const).flatMap((reactMode) =>
      (['inline', 'deferred'] as const).map((observerDelivery) => ({
        reactMode,
        observerDelivery,
      })),
    ),
  )('withholding survives $reactMode with $observerDelivery observers', async (options) => {
    const { agent, historyAtRequest } = build({ rule: denyLookup, options }, true);
    try {
      const proof = await read(agent);
      expect(historyAtRequest.at(-1)).toEqual(['c2']);
      expect(proof.event.reasons).toEqual(['result-withheld']);
      expect(proof.returned).toBe(WITHHELD);
    } finally {
      await agent.shutdown();
    }
  });

  it.each([
    { name: 'two results', first: [call('lookup', 'c1'), call('lookup', 'c2')], visible: false },
    {
      name: 'one batch member',
      first: [batch(call('lookup', 'c1'), call('filler', 'c2'))],
      visible: true,
    },
  ])(
    'only one anonymous reason is visible for $name with or without eviction',
    async ({ first, visible }) => {
      for (const evicts of [false, true]) {
        const { agent, historyAtRequest } = build(
          {
            rule: denyLookup,
            replies: [...first, call('filler', 'c3'), DONE],
          },
          evicts,
        );
        try {
          const proof = await read(agent);
          expect(historyAtRequest.at(-1)).toEqual(evicts ? ['c3'] : ['c1', 'c2', 'c3']);
          const lost = evicts && visible;
          expect(proof.event.reasons).toEqual(
            lost ? ['result-withheld', DROP_REASON] : ['result-withheld'],
          );
          expect(proof.saved.reasons[0]).toMatchObject({
            reason: 'result-withheld',
            source: { kind: 'run' },
            witness: [],
          });
          if (lost) expect(proof.saved.reasons[1]?.witness).toHaveLength(1);
          expect(proof.returned).toBe(lost ? withheldWithDrop() : WITHHELD);
        } finally {
          await agent.shutdown();
        }
      }
    },
  );

  it.each([
    { name: 'a public summary', replacement: 'Result on file.', reasons: [] },
    { name: 'a pending job', replacement: pending(), reasons: ['work-not-finished'] },
    {
      name: 'a reported failure',
      replacement: { content: 'No public result.', effects: [], status: 'failure' },
      reasons: ['call-not-completed'],
    },
  ])(
    'follows a rewrite to $name with and without the call in history',
    async ({ replacement, reasons }) => {
      const shape = {
        execute: gap,
        rule: {
          name: 'summarize-lookup',
          onToolResult: (entry) =>
            entry.toolName === 'lookup' ? allow(replacement, 'Use the public summary.') : allow(),
        },
      } satisfies Shape;
      const retained = build(shape, false);
      const evicted = build(shape, true);
      try {
        const before = await read(retained.agent);
        const after = await read(evicted.agent);
        expect(retained.historyAtRequest.at(-1)).toEqual(['c1', 'c2']);
        expect(evicted.historyAtRequest.at(-1)).toEqual(['c2']);
        expect(before.event.reasons).toEqual(reasons);
        expect([...after.event.reasons].sort()).toEqual([...reasons, DROP_REASON].sort());
        expect(after.returned).toContain(dropClause(1));
      } finally {
        await retained.agent.shutdown();
        await evicted.agent.shutdown();
      }
    },
  );

  it.each([false, true])(
    'clears a prior failure only with arguments linking it to the later completion (evicts=%s)',
    async (evicts) => {
      let calls = 0;
      const { agent } = build(
        {
          execute: () => (calls++ === 0 ? throws() : rows()),
          replies: [call('lookup', 'c1'), call('lookup', 'c2'), DONE],
        },
        evicts,
      );
      try {
        const proof = await read(agent);
        const history = agent.getLastSnapshot()!.sharedState.history;
        expect(history.some((entry) => entry.toolCalls?.some(({ id }) => id === 'c1'))).toBe(
          !evicts,
        );
        expect(calls).toBe(2);
        expect(proof.event.reasons).toEqual(evicts ? ['call-not-completed'] : []);
        if (evicts) expect(proof.returned).toContain('Not sure — a call failed.');
      } finally {
        await agent.shutdown();
      }
    },
  );

  it('writes one entry and one settlement append for each of 31 calls', async () => {
    const script = Array.from({ length: 31 }, (_, index) =>
      call(index % 3 === 0 ? 'lookup' : 'filler', `c${index}`),
    );
    const { agent } = build(
      {
        rule: denyLookup,
        replies: [...script, DONE],
        options: { maxIterations: 40 },
      },
      true,
    );
    try {
      const proof = await read(agent);
      expect(proof.event.reasons).toEqual(['result-withheld', 'result-dropped-from-window']);
      const { commitLog, sharedState } = agent.getLastSnapshot()!;
      const writes = commitLog.flatMap(({ trace }) => trace);
      const drops = (sharedState.libraryResultLimits ?? []).filter(
        ({ kind, turn }) => kind === DROP_REASON && turn === sharedState.turnNumber,
      );
      expect(drops).toHaveLength(20);
      expect(new Set(drops.map(readCallOccurrenceKey)).size).toBe(20);
      expect(
        writes.filter(({ path }) => path === 'libraryResultLimits').map(({ verb }) => verb),
      ).toEqual(['set', ...Array<string>(19).fill('append')]);
      for (const [list, complete] of [
        ['enteredToolCalls', 'enteredToolCallsComplete'],
        ['settledToolCalls', 'settledToolCallsComplete'],
      ] as const) {
        expect
          .soft(
            writes.filter(({ path }) => path === list).map(({ verb }) => verb),
            list,
          )
          .toEqual(['set', ...script.map(() => 'append')]);
        expect
          .soft(
            writes.filter(({ path }) => path === complete).map(({ verb }) => verb),
            complete,
          )
          .toEqual(['set']);
      }
      expect.soft(sharedState.enteredToolCalls).toHaveLength(31);
      expect.soft(sharedState.settledToolCalls).toHaveLength(31);
      const entered = Array.isArray(sharedState.enteredToolCalls)
        ? sharedState.enteredToolCalls.map(readCallOccurrenceKey)
        : [];
      const settled = sharedState.settledToolCalls?.map(readCallOccurrenceKey) ?? [];
      expect.soft(new Set(entered).size).toBe(31);
      expect.soft(settled).toEqual(entered);
      expect.soft(sharedState.enteredToolCallsComplete).toBe(true);
      expect.soft(sharedState.settledToolCallsComplete).toBe(true);
    } finally {
      await agent.shutdown();
    }
  });

  it.each([
    { reason: 'coverage-gap', execute: gap },
    { reason: 'call-not-completed', execute: throws },
    { reason: 'work-not-finished', execute: pending },
    { reason: 'result-withheld', execute: rows },
  ] as const)(
    'default pins preserve $reason after the earlier lookup leaves history',
    async ({ reason, execute }) => {
      const canRecover = reason === 'call-not-completed' || reason === 'work-not-finished';
      async function run(evicts: boolean) {
        let calls = 0;
        const rule: ToolMiddleware | undefined =
          reason === 'result-withheld'
            ? {
                name: 'archive-first',
                onToolResult: (entry) =>
                  entry.toolName === 'lookup' && entry.toolCallId === 'c1'
                    ? deny(PRIVATE_NOTICE)
                    : allow(),
              }
            : undefined;
        const { agent, historyAtRequest } = build(
          {
            tools: [
              tool('lookup', () => (calls++ === 0 ? execute() : [{ order: 7 }])),
              tool('other', () => 'fine'),
            ],
            replies: [
              call('lookup', 'c1'),
              call('lookup', 'c2'),
              call('filler', 'c3'),
              call('other', 'c4'),
              call('filler', 'c5'),
              call('other', 'c6'),
              DONE,
            ],
            ...(rule !== undefined && { rule }),
            defaultPins: true,
          },
          evicts,
        );
        try {
          const proof = await read(agent);
          expect(historyAtRequest.at(-1)?.includes('c1')).toBe(!evicts);
          expect(historyAtRequest.at(-1)).toContain('c2');
          const reasons = !evicts && canRecover ? [] : [reason];
          expect([...proof.event.reasons].sort()).toEqual(
            (evicts ? [...reasons, DROP_REASON] : reasons).sort(),
          );
          if (evicts) {
            const kept = historyAtRequest.at(-1)!;
            const visible =
              reason === 'result-withheld' || reason === 'call-not-completed'
                ? ['c3', 'c4', 'c5']
                : ['c1', 'c3', 'c4', 'c5'];
            expect(proof.returned).toContain(
              dropClause(visible.filter((id) => !kept.includes(id)).length),
            );
          }
        } finally {
          await agent.shutdown();
        }
      }
      await run(false);
      await run(true);
    },
  );

  it.each([false, true])(
    'mounted withholding belongs only to the nested Agent (evicts=%s)',
    async (evicts) => {
      let denied = 0;
      const inner = build(
        {
          rule: {
            name: 'nested-rule',
            onToolResult: (entry) => {
              if (entry.toolName !== 'lookup') return allow();
              denied++;
              return deny(PRIVATE_NOTICE);
            },
          },
        },
        evicts,
      ).agent;
      const chart = flowChart('Seed', () => undefined, 'seed')
        .addSubFlowChartNext('specialist', inner.getSpec(), 'Specialist', {
          inputMapper: () => ({ message: 'Check.', identity: { conversationId: 'm' } }),
          outputMapper: () => ({ formatted: 'done' }),
        })
        .build();
      const memory = {
        ...defineMemory({
          id: 'm',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 2 },
          store: new InMemoryStore(),
          readOnly: true,
        }),
        read: chart as unknown as MemoryDefinition['read'],
      };
      const outer = build({ memory, replies: [call('filler', 'p1'), DONE] }, evicts).agent;
      try {
        const proof = await read(outer, () => outer.run(QUESTION), true);
        expect(denied).toBeGreaterThan(0);
        expect(proof.event.reasons).toEqual([]);
        expect(proof.returned).not.toContain('a result was kept out by a rule');
      } finally {
        await outer.shutdown();
        await inner.shutdown();
      }
    },
  );
});
