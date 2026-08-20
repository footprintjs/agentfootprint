/**
 * The window keeps the evidence, not just the task — `'last-tool-result'`.
 *
 * ## The measured failure
 *
 * From a context-gap audit over real recorded runs of a consumer integration.
 * An agent drove a screen through tools. A `whats_here` result (~5,800 chars)
 * carried the list of valid ids it had to act on. Under
 * `slidingWindow({ keepRecentTurns: 2 })` that result survived about two
 * iterations — segmentation makes each assistant/tool_result PAIR one turn, so
 * two kept turns are two tool rounds. The 9.55.0 anchor kept the REQUEST
 * undroppable, so the model still knew what it had been asked to do and no
 * longer had the evidence to do it. Reproduced across five runs: it assembled
 * a plausible id out of an entity name it remembered plus the shape of an id
 * it had used earlier ("aix-lab-01" + "-single-path"), and was refused. In one
 * archived run the final answer to the person named a host that appears in no
 * tool result at all.
 *
 * ## The rule, as shipped
 *
 * For each tool the agent is using, the window keeps that tool's most recent
 * result — up to `keepLastToolResults` (default 2) beyond the recent-turns
 * window — until the agent calls that tool again or the person asks something
 * new. It lives in the shared refusal engine, so every strategy inherits it,
 * including one a consumer wrote.
 */

import { describe, expect, it } from 'vitest';

import { Agent, slidingWindow, summarizeOldest, tokenBudget } from '../../src/index.js';
import { defineTool } from '../../src/core/tools.js';
import type { LLMMessage, LLMProvider, LLMResponse } from '../../src/adapters/types.js';
import {
  answeredCallIds,
  planRemoval,
  refusalFor,
  segmentTurns,
  type RemovalGuards,
} from '../../src/core/agent/window/turns.js';
import { toolResultPinsOf } from '../../src/core/agent/window/lastToolResult.js';
import { currentRequestIndexOf } from '../../src/core/agent/window/currentRequest.js';
import { removalFacts } from '../../src/core/agent/window/removal.js';
import type { WindowStrategy, WindowStrategyInput } from '../../src/core/agent/window/strategy.js';
import type { WindowRecord } from '../../src/core/agent/window/types.js';
import { buildWindowStage } from '../../src/core/agent/stages/window.js';
import type { CompactionMeterHandle } from '../../src/recorders/core/CompactionMeter.js';

// ─────────────────────────────────────────────────────────────────
// Fixtures
// ─────────────────────────────────────────────────────────────────

const TASK = 'Walk the whole floor and tell me which rack is hottest.';
const HOLDS = 'HOLDS: aix-lab-01-rack-a, aix-lab-01-rack-b, aix-lab-02-rack-a';

const user = (content: string): LLMMessage => ({ role: 'user', content });
const asks = (calls: { id: string; name: string }[]): LLMMessage => ({
  role: 'assistant',
  content: '',
  toolCalls: calls.map((c) => ({ id: c.id, name: c.name, args: {} })),
});
const answers = (id: string, name: string, content = 'ok'): LLMMessage => ({
  role: 'tool',
  content,
  toolCallId: id,
  toolName: name,
});
/** One ReAct round: the call and its answer, which segment as ONE turn. */
const round = (id: string, name: string, content = 'ok'): LLMMessage[] => [
  asks([{ id, name }]),
  answers(id, name, content),
];

function guardsFor(history: readonly LLMMessage[], limit: number): RemovalGuards {
  const turns = segmentTurns(history);
  const anchor = currentRequestIndexOf(history, TASK);
  const pins = toolResultPinsOf(turns, history, anchor);
  return {
    answeredCallIds: answeredCallIds(history),
    ...(anchor >= 0 && { currentRequestIndex: anchor }),
    ...(limit > 0 && pins.length > 0 && { toolResultPins: pins, keepLastToolResults: limit }),
  };
}

function inputFor(
  history: readonly LLMMessage[],
  iteration: number,
  limit: number,
): WindowStrategyInput {
  const turns = segmentTurns(history);
  const guards = guardsFor(history, limit);
  const origins = history.map((_, i) => ({ stageId: `tool-calls#${i}`, bornAtMs: 0 }));
  return {
    history,
    turns,
    measured: { input: 999_999, output: 10 },
    iteration,
    runId: 'run-1',
    agentModel: 'm',
    providerName: 'mock',
    signal: undefined,
    now: () => 1_000,
    planRemoval: (keep, isExistingSummary) => planRemoval(turns, keep, guards, isExistingSummary),
    removalFacts: (indices, at) => removalFacts(origins, indices, at),
  };
}

/** The meter the stage reads, with nothing to say. */
function fakeMeter(): CompactionMeterHandle {
  return {
    id: 'fake',
    lastCall: () => ({ input: 999_999, output: 10, iteration: 1 } as never),
    unmeteredSinceLastGood: () => 0,
    origins: () => [],
    rebaseForWindowChange: () => {},
    clear: () => {},
    onWrite: () => {},
    onEmit: () => {},
  };
}

/** Just enough scope for the stage: the keys it reads, writes and emits on. */
function fakeScope(history: readonly LLMMessage[]): {
  history: readonly LLMMessage[];
  iteration: number;
  userMessage: string;
  compactions: WindowRecord[];
  $emit: (name: string, payload?: unknown) => void;
} {
  return {
    history: [...history],
    iteration: 1,
    userMessage: TASK,
    compactions: [],
    $emit: () => {},
  };
}

// ─────────────────────────────────────────────────────────────────
// Unit — which turns are candidates
// ─────────────────────────────────────────────────────────────────

describe('toolResultPinsOf', () => {
  it('the LAST result per tool, newest first, ignoring everything at/before the anchor', () => {
    const history: LLMMessage[] = [
      ...round('old', 'whats_here', 'STALE'),
      user(TASK),
      ...round('a', 'whats_here', HOLDS),
      ...round('b', 'move'),
      ...round('c', 'move'),
    ];
    const turns = segmentTurns(history);
    const anchor = currentRequestIndexOf(history, TASK);
    const pins = toolResultPinsOf(turns, history, anchor);
    expect(pins.map((p) => p.toolName)).toEqual(['move', 'whats_here']);
    // The newest `move` round, not the older one.
    expect(pins[0]!.turnIndex).toBe(turns.length - 1);
    // The pre-anchor `whats_here` is not a candidate at all.
    expect(pins.every((p) => p.messageIndex > anchor)).toBe(true);
    // `chars` is the whole TURN — the call and its result leave together.
    expect(pins[1]!.chars).toBe(HOLDS.length);
  });

  it('a name absent on the result is recovered from the assistant call', () => {
    const history: LLMMessage[] = [
      user(TASK),
      asks([{ id: 'x', name: 'whats_here' }]),
      { role: 'tool', content: HOLDS, toolCallId: 'x' },
    ];
    const pins = toolResultPinsOf(segmentTurns(history), history, 0);
    expect(pins.map((p) => p.toolName)).toEqual(['whats_here']);
  });

  it('a result nothing can name is NOT pinned — never an invented "unknown"', () => {
    const history: LLMMessage[] = [
      user(TASK),
      { role: 'tool', content: 'orphan', toolCallId: 'nobody-asked' },
    ];
    expect(toolResultPinsOf(segmentTurns(history), history, 0)).toEqual([]);
  });

  it('three tools answered in ONE batch is ONE pin — one turn, one slot', () => {
    const history: LLMMessage[] = [
      user(TASK),
      asks([
        { id: '1', name: 'a' },
        { id: '2', name: 'b' },
        { id: '3', name: 'c' },
      ]),
      answers('1', 'a'),
      answers('2', 'b'),
      answers('3', 'c'),
      ...round('later', 'd'),
    ];
    const pins = toolResultPinsOf(segmentTurns(history), history, 0);
    // `d` plus the batch turn, once — not `d` plus three.
    expect(pins).toHaveLength(2);
    expect(pins[1]!.turnIndex).toBe(1);
  });
});

// ─────────────────────────────────────────────────────────────────
// Unit — refusal precedence and the ceiling
// ─────────────────────────────────────────────────────────────────

describe('refusalFor precedence', () => {
  const turn = segmentTurns([asks([{ id: 'u', name: 'look' }])])[0]!;

  it('a pinned turn also holding an unanswered call reports the unanswered call', () => {
    expect(
      refusalFor(turn, {
        answeredCallIds: new Set<string>(),
        pinnedTurnIndexes: new Set([0]),
      }),
    ).toBe('unresolved-tool-call');
  });

  it('a pinned turn also holding the request reports the request', () => {
    expect(
      refusalFor(turn, {
        answeredCallIds: new Set(['u']),
        currentRequestIndex: 0,
        pinnedTurnIndexes: new Set([0]),
      }),
    ).toBe('current-request');
  });

  it('with nothing else to say, it reports the pin', () => {
    expect(
      refusalFor(turn, { answeredCallIds: new Set(['u']), pinnedTurnIndexes: new Set([0]) }),
    ).toBe('last-tool-result');
  });
});

describe('the ceiling', () => {
  /** Five tools, each stale (last spoke long ago), plus recent traffic. */
  const fiveTools: LLMMessage[] = [
    user(TASK),
    ...round('t1', 'tool_one'),
    ...round('t2', 'tool_two'),
    ...round('t3', 'tool_three'),
    ...round('t4', 'tool_four'),
    ...round('t5', 'tool_five'),
    ...round('t6', 'tool_five'),
    ...round('t7', 'tool_five'),
  ];

  it('spends newest-first and reports what it turned away', () => {
    const turns = segmentTurns(fiveTools);
    const guards = guardsFor(fiveTools, 2);
    const plan = planRemoval(turns, 2, guards);
    const pinned = plan.refusals.filter((r) => r.reason === 'last-tool-result');
    expect(plan.observations?.limit).toBe(2);
    // Five tools, one of them answering inside the keep window (free), so
    // four contest two slots.
    expect(plan.observations!.pinned).toHaveLength(2);
    expect(plan.observations!.yielded).toBeGreaterThan(0);
    expect(pinned.length).toBeLessThanOrEqual(2);
    // The two admitted are the NEWEST of the contested ones.
    const admitted = plan.observations!.pinned.map((p) => p.turnIndex);
    expect(admitted).toEqual([...admitted].sort((a, b) => b - a));
  });

  it('a pin already inside keepRecentTurns is FREE — it spends no slot', () => {
    // The actuator answers in every recent turn; the observer last spoke long
    // ago. With one slot, the observer is the one that gets it.
    const history: LLMMessage[] = [
      user(TASK),
      ...round('o', 'observer', HOLDS),
      ...round('a1', 'actuator'),
      ...round('a2', 'actuator'),
      ...round('a3', 'actuator'),
    ];
    const plan = planRemoval(segmentTurns(history), 2, guardsFor(history, 1));
    expect(plan.observations!.pinned.map((p) => p.toolName)).toEqual(['observer']);
    expect(plan.observations!.yielded).toBe(0);
  });

  it('limit 0 plans exactly as it did before the pin existed', () => {
    const withPin = planRemoval(segmentTurns(fiveTools), 2, guardsFor(fiveTools, 0));
    expect(withPin.observations).toBeUndefined();
    expect(withPin.refusals.map((r) => r.reason)).not.toContain('last-tool-result');
  });
});

// ─────────────────────────────────────────────────────────────────
// Scenario — the audit replay, and contiguity
// ─────────────────────────────────────────────────────────────────

describe('the audited run', () => {
  it('the holds survive 30 iterations of actuator traffic', async () => {
    let history: LLMMessage[] = [user(TASK), ...round('w', 'whats_here', HOLDS)];
    const strategy = slidingWindow({ keepRecentTurns: 2 });
    const records: WindowRecord[] = [];
    for (let iteration = 2; iteration <= 30; iteration++) {
      const res = await strategy.plan(inputFor(history, iteration, 2));
      if (res !== undefined) {
        records.push(res.record);
        if (res.window !== undefined) history = [...res.window];
      }
      history = [...history, ...round(`m${iteration}`, 'move')];
    }
    // The holds are STILL THERE at iteration 30.
    expect(history.some((m) => m.content === HOLDS)).toBe(true);
    // And the record says why, from the boundary the drop would have taken it.
    const pinning = records.filter((r) => r.refusals.some((f) => f.reason === 'last-tool-result'));
    expect(pinning.length).toBeGreaterThan(0);
    // The window is still bounded — it did not stop dropping.
    expect(records.filter((r) => r.removedMessageCount > 0).length).toBeGreaterThanOrEqual(20);
    expect(history.length).toBeLessThanOrEqual(12);
  });

  it('without the pin, the holds are gone — the defect, reproduced', async () => {
    let history: LLMMessage[] = [user(TASK), ...round('w', 'whats_here', HOLDS)];
    const strategy = slidingWindow({ keepRecentTurns: 2 });
    for (let iteration = 2; iteration <= 30; iteration++) {
      const res = await strategy.plan(inputFor(history, iteration, 0));
      if (res?.window !== undefined) history = [...res.window];
      history = [...history, ...round(`m${iteration}`, 'move')];
    }
    expect(history.some((m) => m.content === HOLDS)).toBe(false);
  });

  it('superseding: the pin moves when the tool answers again', async () => {
    const before: LLMMessage[] = [
      user(TASK),
      ...round('w1', 'whats_here', HOLDS),
      ...round('m1', 'move'),
      ...round('m2', 'move'),
      ...round('m3', 'move'),
    ];
    const pinnedBefore = planRemoval(
      segmentTurns(before),
      2,
      guardsFor(before, 2),
    ).observations!.pinned.find((p) => p.toolName === 'whats_here')!;
    expect(pinnedBefore.turnIndex).toBe(1);

    const after: LLMMessage[] = [...before, ...round('w2', 'whats_here', 'FRESH HOLDS')];
    const afterTurns = segmentTurns(after);
    // The pin has MOVED to the fresh result…
    const pins = toolResultPinsOf(afterTurns, after, currentRequestIndexOf(after, TASK));
    expect(pins.find((p) => p.toolName === 'whats_here')!.turnIndex).toBe(afterTurns.length - 1);
    // …and the old turn is an ordinary candidate again: nothing contests a
    // slot, because both pins are inside the keep window and cost nothing.
    const plan = planRemoval(afterTurns, 2, guardsFor(after, 2));
    expect(plan.observations).toBeUndefined();
    expect(plan.refusals.map((r) => r.reason)).not.toContain('last-tool-result');
    expect(plan.from).toBe(1);
  });

  it('contiguity works BOTH ways: stop before the pin, then step over it', () => {
    // request(0) · a(1) · b(2) · c(3) · PIN(4) · d(5) · keep(6,7)
    const history: LLMMessage[] = [
      user(TASK),
      ...round('a', 'x'),
      ...round('b', 'x'),
      ...round('c', 'x'),
      ...round('pin', 'observer', HOLDS),
      ...round('d', 'x'),
      ...round('e', 'x'),
      ...round('f', 'x'),
    ];
    const first = planRemoval(segmentTurns(history), 2, guardsFor(history, 2));
    // Turn 0 refuses (the request), 1..3 go, and the pin ends the span.
    expect([first.from, first.to]).toEqual([1, 3]);

    // Next boundary, with 1..3 gone: request(0) · PIN(1) · d(2) · …
    const next: LLMMessage[] = [
      user(TASK),
      ...round('pin', 'observer', HOLDS),
      ...round('d', 'x'),
      ...round('e', 'x'),
      ...round('f', 'x'),
    ];
    const second = planRemoval(segmentTurns(next), 2, guardsFor(next, 2));
    // The pin is STEPPED OVER — a blocker before `from` never ends a span.
    expect(second.from).toBe(2);
  });
});

// ─────────────────────────────────────────────────────────────────
// Scenario — the stand-down, and the wedge it closes
// ─────────────────────────────────────────────────────────────────

describe('the stand-down', () => {
  function summarizer(): LLMProvider {
    return {
      name: 'sum',
      complete: async (): Promise<LLMResponse> => ({
        content: 'EARLIER: the agent moved around.',
        toolCalls: [],
        usage: { input: 10, output: 5 },
        stopReason: 'end_turn',
      }),
    };
  }

  it('summarizeOldest with a lone summary in front of a pin removes NOTHING forever', async () => {
    // The wedge, red-proved at the mechanic: `[summary, pinned, …keep]` plans
    // `from = to = 0`, breaks at the pin, and the only-existing-summary
    // short-circuit turns that into "remove nothing". The stage's stand-down
    // is what stops it repeating; here the mechanic is asked directly, with
    // no stage, so the non-progress is visible.
    const history: LLMMessage[] = [
      { role: 'user', content: '[compacted history] EARLIER: things happened.' },
      ...round('pin', 'observer', HOLDS),
      ...round('a', 'x'),
      ...round('b', 'x'),
    ];
    const isSummary = (t: { messages: readonly LLMMessage[] }): boolean =>
      t.messages[0]!.content.startsWith('[compacted history]');
    const plan = planRemoval(segmentTurns(history), 2, guardsFor(history, 2), isSummary);
    expect(plan.from).toBe(-1);
    expect(plan.refusals.map((r) => r.reason)).toContain('last-tool-result');

    // With the pin released — which is what the stand-down does — the summary
    // is the whole span again, and the plan reaches the same verdict for a
    // DIFFERENT reason. One more turn and it folds.
    const released = planRemoval(segmentTurns(history), 2, guardsFor(history, 0), isSummary);
    expect(released.refusals.map((r) => r.reason)).not.toContain('last-tool-result');
  });

  it('the STAGE stands down on the third blocked boundary, and files the fact', async () => {
    // Driven at the stage, because that is where the rule lives and because
    // the non-progress it guards against has to be produced deliberately: a
    // window whose ONLY candidate is a pinned turn removes nothing, for ever,
    // with no shipped strategy able to do anything about it.
    const history: LLMMessage[] = [
      ...round('pin', 'observer', HOLDS),
      ...round('a', 'move'),
      ...round('b', 'move'),
    ];
    // A strategy that honours whatever the refusal engine allows, and files
    // it. No trigger, no budget, no summarizer — just the plan.
    const obedient: WindowStrategy = {
      name: 'obedient',
      plan: async (input) => {
        const plan = input.planRemoval(2);
        const removed =
          plan.from === -1
            ? 0
            : input.turns[plan.to]!.start +
              input.turns[plan.to]!.length -
              input.turns[plan.from]!.start;
        return {
          record: {
            strategy: 'obedient',
            iteration: input.iteration,
            removedStageIds: [],
            removedMessageCount: removed,
            windowCharsBefore: 0,
            windowCharsAfter: 0,
            refusals: plan.refusals,
          },
          evictions: [],
        };
      },
    };
    const stage = buildWindowStage({
      strategy: obedient,
      meter: fakeMeter(),
      agentModel: 'm',
      providerName: 'mock',
      now: () => 1_000,
    });

    const scope = fakeScope(history);
    for (let iteration = 1; iteration <= 3; iteration++) {
      scope.iteration = iteration;
      await stage(scope as never);
    }
    const records = scope.compactions;
    expect(records).toHaveLength(3);
    // Two boundaries blocked by the pin…
    expect(records[0]!.removedMessageCount).toBe(0);
    expect(records[1]!.removedMessageCount).toBe(0);
    expect(records[0]!.refusals.map((r) => r.reason)).toContain('last-tool-result');
    expect(records[1]!.refusals.map((r) => r.reason)).toContain('last-tool-result');
    // …and the third stands down, ON THE RECORD, and progress follows.
    expect(records[2]!.observations).toEqual({
      pinned: [],
      yielded: 0,
      limit: 2,
      standDown: true,
    });
    expect(records[2]!.refusals.map((r) => r.reason)).not.toContain('last-tool-result');
    expect(records[2]!.removedMessageCount).toBeGreaterThan(0);
  });

  it('a real run never lets the pin block three boundaries running', async () => {
    // A tiny keep window and a pin that never moves: the model calls one
    // observer once, then talks without tools, so the pin is stuck.
    let call = 0;
    const provider: LLMProvider = {
      name: 'mock',
      complete: async (): Promise<LLMResponse> => {
        call++;
        if (call === 1) {
          return {
            content: '',
            toolCalls: [{ id: 'o1', name: 'observer', args: {} }],
            usage: { input: 90_000, output: 5 },
            stopReason: 'end_turn',
          };
        }
        if (call < 9) {
          return {
            content: '',
            toolCalls: [{ id: `a${call}`, name: 'observer', args: {} }],
            usage: { input: 90_000, output: 5 },
            stopReason: 'end_turn',
          };
        }
        return {
          content: 'done',
          toolCalls: [],
          usage: { input: 90_000, output: 5 },
          stopReason: 'end_turn',
        };
      },
    };
    const observer = defineTool({
      name: 'observer',
      description: 'look',
      inputSchema: { type: 'object', properties: {} },
      execute: () => HOLDS,
    } as never);
    const agent = Agent.create({ provider, model: 'm', maxIterations: 12 })
      .tool(observer as never)
      .window(
        summarizeOldest({
          thresholdTokens: 10,
          keepRecentTurns: 1,
          summarizer: summarizer(),
          model: 'cheap',
        }),
      )
      .build();
    await agent.run({ message: TASK });
    const records = ((agent.getLastSnapshot()?.sharedState as { compactions?: WindowRecord[] })
      ?.compactions ?? []) as WindowRecord[];
    // Whatever happened, the pin never blocked three boundaries running.
    let streak = 0;
    for (const r of records) {
      const blocked =
        r.removedMessageCount === 0 && r.refusals.some((f) => f.reason === 'last-tool-result');
      streak = blocked ? streak + 1 : 0;
      expect(streak).toBeLessThanOrEqual(2);
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Integration — the dial, the record, and byte-identity
// ─────────────────────────────────────────────────────────────────

describe('the dial', () => {
  const observer = defineTool({
    name: 'whats_here',
    description: 'what is on screen',
    inputSchema: { type: 'object', properties: {} },
    execute: () => `${HOLDS} ${'x'.repeat(600)}`,
  } as never);
  const actuator = defineTool({
    name: 'move',
    description: 'move the view',
    inputSchema: { type: 'object', properties: {} },
    execute: () => 'moved',
  } as never);

  /** whats_here once, then nothing but the actuator — the audited shape. */
  function screenScript(rounds: number): LLMProvider {
    let call = 0;
    return {
      name: 'mock',
      complete: async (): Promise<LLMResponse> => {
        call++;
        if (call > rounds) {
          return {
            content: 'the hottest rack is aix-lab-01-rack-a',
            toolCalls: [],
            usage: { input: 90_000, output: 5 },
            stopReason: 'end_turn',
          };
        }
        const name = call === 1 ? 'whats_here' : 'move';
        return {
          content: '',
          toolCalls: [{ id: `c${call}`, name, args: {} }],
          usage: { input: 90_000, output: 5 },
          stopReason: 'end_turn',
        };
      },
    };
  }

  function buildAgent(keepLastToolResults?: number | false): Agent {
    return Agent.create({
      provider: screenScript(10),
      model: 'm',
      maxIterations: 14,
      ...(keepLastToolResults !== undefined && { keepLastToolResults }),
    })
      .tool(observer as never)
      .tool(actuator as never)
      .window(slidingWindow({ keepRecentTurns: 2 }))
      .build();
  }

  function stateOf(agent: Agent): {
    history: readonly LLMMessage[];
    records: readonly WindowRecord[];
  } {
    const s = agent.getLastSnapshot()?.sharedState as
      | { history?: readonly LLMMessage[]; compactions?: readonly WindowRecord[] }
      | undefined;
    return { history: s?.history ?? [], records: s?.compactions ?? [] };
  }

  it('ON by default: the observation survives, and the record names the cost', async () => {
    const agent = buildAgent();
    await agent.run({ message: TASK });
    const { history, records } = stateOf(agent);
    expect(history.some((m) => m.content.startsWith(HOLDS))).toBe(true);

    const pinned = records.find((r) => (r.observations?.pinned.length ?? 0) > 0);
    expect(pinned).toBeDefined();
    expect(pinned!.observations!.limit).toBe(2);
    expect(pinned!.observations!.pinned[0]!.chars).toBeGreaterThan(0);
    expect(records.some((r) => r.refusals.some((f) => f.reason === 'last-tool-result'))).toBe(true);
    // The record survives the boundary it is committed across.
    expect(structuredClone(pinned!.observations)).toEqual(pinned!.observations);
  });

  it('OFF reproduces the pre-9.57.0 window — and 0 is the same as false', async () => {
    const off = buildAgent(false);
    await off.run({ message: TASK });
    const zero = buildAgent(0);
    await zero.run({ message: TASK });

    for (const agent of [off, zero]) {
      const { history, records } = stateOf(agent);
      expect(history.some((m) => m.content.startsWith(HOLDS))).toBe(false);
      for (const r of records) expect('observations' in r).toBe(false);
      expect(records.some((r) => r.refusals.some((f) => f.reason === 'last-tool-result'))).toBe(
        false,
      );
    }
    // The two off-switches produce the same window and the same refusals.
    expect(stateOf(off).history.map((m) => m.content)).toEqual(
      stateOf(zero).history.map((m) => m.content),
    );
    expect(stateOf(off).records.map((r) => r.refusals.map((f) => f.reason))).toEqual(
      stateOf(zero).records.map((r) => r.refusals.map((f) => f.reason)),
    );
  });

  it('an agent with no window strategy is byte-identical either way', async () => {
    const make = (keepLastToolResults?: number | false): Agent =>
      Agent.create({
        provider: screenScript(4),
        model: 'm',
        maxIterations: 8,
        ...(keepLastToolResults !== undefined && { keepLastToolResults }),
      })
        .tool(observer as never)
        .tool(actuator as never)
        .build();
    const plain = make();
    const dialled = make(5);
    const a = await plain.run({ message: TASK });
    const b = await dialled.run({ message: TASK });
    expect(a.output).toBe(b.output);
    expect(stateOf(plain).history.map((m) => m.content)).toEqual(
      stateOf(dialled).history.map((m) => m.content),
    );
    expect(stateOf(plain).records).toEqual([]);
    expect(stateOf(dialled).records).toEqual([]);
  });

  it('refuses a value that is not a whole number or false', () => {
    for (const bad of [-1, 1.5, 'two', null]) {
      expect(() =>
        Agent.create({
          provider: screenScript(1),
          model: 'm',
          keepLastToolResults: bad as never,
        }).build(),
      ).toThrow(/keepLastToolResults/);
    }
  });

  it('a new user turn releases the whole previous loop', () => {
    // Turn two of a conversation: everything before the new request is
    // ordinary history, so nothing from turn one is pinnable.
    const history: LLMMessage[] = [
      user('what is on screen?'),
      ...round('w', 'whats_here', HOLDS),
      ...round('m', 'move'),
      user(TASK),
    ];
    const plan = planRemoval(segmentTurns(history), 1, guardsFor(history, 2));
    expect(plan.refusals.map((r) => r.reason)).not.toContain('last-tool-result');
    expect(plan.observations).toBeUndefined();
  });

  it('tokenBudget with an unreachable threshold declines rather than livelocks', async () => {
    const history: LLMMessage[] = [
      user(TASK),
      ...round('w', 'whats_here', HOLDS),
      ...round('p', 'pan', 'panned'),
      ...round('m1', 'move'),
      ...round('m2', 'move'),
    ];
    const res = await tokenBudget({ thresholdTokens: 1, keepRecentTurns: 2 }).plan(
      inputFor(history, 4, 2),
    );
    expect(res).toBeDefined();
    expect((res!.record as { overBudget?: boolean }).overBudget).toBe(true);
    expect(res!.record.refusals.map((r) => r.reason)).toContain('last-tool-result');
  });
});
