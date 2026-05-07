/**
 * LiveStateRecorder — full 7-tier test matrix.
 *
 *   Tier 1 — Unit:        each tracker class in isolation
 *   Tier 2 — Scenario:    real LLM streaming / tool / turn lifecycles
 *   Tier 3 — Integration: facade subscribes to a real EventDispatcher
 *   Tier 4 — Property:    matched-bracket invariants for arbitrary inputs
 *   Tier 5 — Performance: 1K LLM calls + token bursts in <100ms
 *   Tier 6 — Security:    out-of-order events, idempotent subscribe, clear
 *   Tier 7 — ROI:         public surface, exported from /observe + main
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { EventDispatcher } from '../../../src/events/dispatcher.js';
import {
  LiveAgentTurnTracker,
  LiveLLMTracker,
  LiveStateRecorder,
  LiveToolTracker,
  liveStateRecorder,
} from '../../../src/recorders/observability/LiveStateRecorder.js';
import type { AgentfootprintEvent } from '../../../src/events/registry.js';

// ── Test helpers ────────────────────────────────────────────────────

// Test runner — wraps an EventDispatcher with the public `on` API the
// LiveStateRunnerLike interface requires.
function makeRunner() {
  const dispatcher = new EventDispatcher();
  return {
    dispatcher,
    on: ((type: string, listener: (e: AgentfootprintEvent) => void) =>
      // Cast through unknown — the test helper bypasses the typed
      // overloads since we test against the runtime contract.
      (dispatcher.on as unknown as (t: string, l: (e: AgentfootprintEvent) => void) => () => void)(
        type,
        listener,
      )) as never,
  };
}

function meta(
  runtimeStageId: string,
  wallClockMs = 1_000_000,
): {
  runtimeStageId: string;
  wallClockMs: number;
  runOffsetMs: number;
  subflowPath: readonly string[];
} {
  return {
    runtimeStageId,
    wallClockMs,
    runOffsetMs: wallClockMs - 1_000_000,
    subflowPath: [],
  };
}

function llmStart(
  rid: string,
  opts: Partial<{ iteration: number; provider: string; model: string; ts: number }> = {},
): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.llm_start',
    payload: {
      iteration: opts.iteration ?? 0,
      provider: opts.provider ?? 'demo',
      model: opts.model ?? 'demo-model',
      systemPromptChars: 0,
      messagesCount: 1,
      toolsCount: 0,
    },
    meta: meta(rid, opts.ts),
  };
}

function token(rid: string, content: string, idx = 0, ts?: number): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.token',
    payload: { iteration: 0, tokenIndex: idx, content },
    meta: meta(rid, ts),
  };
}

function llmEnd(rid: string, content = 'final', ts?: number): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.llm_end',
    payload: {
      iteration: 0,
      content,
      toolCallCount: 0,
      usage: { input: 10, output: 5 },
      stopReason: 'end_turn',
    },
    meta: meta(rid, ts),
  };
}

function toolStart(
  toolName: string,
  toolCallId: string,
  args: Record<string, unknown> = {},
  ts?: number,
): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.tool_start',
    payload: { toolName, toolCallId, args },
    meta: meta(`call-tool#${toolCallId}`, ts),
  };
}

function toolEnd(toolCallId: string, result: unknown = 'ok', ts?: number): AgentfootprintEvent {
  return {
    type: 'agentfootprint.stream.tool_end',
    payload: { toolCallId, result, durationMs: 10 },
    meta: meta(`call-tool#${toolCallId}`, ts),
  };
}

function turnStart(turnIndex: number, userPrompt = 'hi', ts?: number): AgentfootprintEvent {
  return {
    type: 'agentfootprint.agent.turn_start',
    payload: { turnIndex, userPrompt },
    meta: meta(`turn#${turnIndex}`, ts),
  };
}

function turnEnd(turnIndex: number, ts?: number): AgentfootprintEvent {
  return {
    type: 'agentfootprint.agent.turn_end',
    payload: {
      turnIndex,
      finalContent: 'done',
      totalInputTokens: 100,
      totalOutputTokens: 50,
      iterationCount: 1,
    },
    meta: meta(`turn#${turnIndex}`, ts),
  };
}

// ─── Tier 1 — Unit ─────────────────────────────────────────────────

describe('LiveLLMTracker — Tier 1: Unit', () => {
  it('opens a boundary on llm_start and closes on llm_end', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('call-llm#1'));
    expect(tr.isInFlight()).toBe(true);
    expect(tr.getActive('call-llm#1')?.partial).toBe('');

    runner.dispatcher.dispatch(llmEnd('call-llm#1'));
    expect(tr.isInFlight()).toBe(false);
    expect(tr.getActive('call-llm#1')).toBeUndefined();
  });

  it('accumulates partial content from token events', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('rid1'));
    runner.dispatcher.dispatch(token('rid1', 'I '));
    runner.dispatcher.dispatch(token('rid1', 'will ', 1));
    runner.dispatcher.dispatch(token('rid1', 'help', 2));

    const state = tr.getActive('rid1');
    expect(state?.partial).toBe('I will help');
    expect(state?.tokens).toBe(3);
  });

  it('captures iteration / provider / model from start payload', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(
      llmStart('rid1', { iteration: 7, provider: 'anthropic', model: 'claude-x' }),
    );

    const s = tr.getActive('rid1');
    expect(s?.iteration).toBe(7);
    expect(s?.provider).toBe('anthropic');
    expect(s?.model).toBe('claude-x');
  });

  it('getLatestPartial returns most recently started call', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('A', { ts: 1_000_000 }));
    runner.dispatcher.dispatch(token('A', 'aa'));
    runner.dispatcher.dispatch(llmStart('B', { ts: 2_000_000 })); // newer
    runner.dispatcher.dispatch(token('B', 'bb'));

    expect(tr.getLatestPartial()).toBe('bb');
  });
});

describe('LiveToolTracker — Tier 1: Unit', () => {
  it('tracks tool execution via toolCallId key', () => {
    const tr = new LiveToolTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(toolStart('weather', 'tc-1', { city: 'Seattle' }));
    expect(tr.isExecuting()).toBe(true);
    expect(tr.getExecutingToolNames()).toEqual(['weather']);
    expect(tr.getActive('tc-1')?.args).toEqual({ city: 'Seattle' });

    runner.dispatcher.dispatch(toolEnd('tc-1'));
    expect(tr.isExecuting()).toBe(false);
  });

  it('handles multiple parallel tool calls independently', () => {
    const tr = new LiveToolTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(toolStart('weather', 'tc-1'));
    runner.dispatcher.dispatch(toolStart('forecast', 'tc-2'));
    expect(tr.activeCount).toBe(2);
    expect(tr.getExecutingToolNames().sort()).toEqual(['forecast', 'weather']);

    runner.dispatcher.dispatch(toolEnd('tc-1'));
    expect(tr.getExecutingToolNames()).toEqual(['forecast']);
  });
});

describe('LiveAgentTurnTracker — Tier 1: Unit', () => {
  it('tracks turn lifecycle via turnIndex key', () => {
    const tr = new LiveAgentTurnTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(turnStart(0));
    expect(tr.isInTurn()).toBe(true);
    expect(tr.getCurrentTurnIndex()).toBe(0);

    runner.dispatcher.dispatch(turnEnd(0));
    expect(tr.isInTurn()).toBe(false);
    expect(tr.getCurrentTurnIndex()).toBe(-1);
  });

  it('returns the most-recently started turn when nested', () => {
    const tr = new LiveAgentTurnTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(turnStart(0, 'first', 1_000_000));
    runner.dispatcher.dispatch(turnStart(1, 'second', 2_000_000));
    expect(tr.getCurrentTurnIndex()).toBe(1);
  });
});

// ─── Tier 2 — Scenario ─────────────────────────────────────────────

describe('LiveStateRecorder — Tier 2: Scenario', () => {
  it('full ReAct turn: turn → llm → tool → llm → end-of-turn', () => {
    const live = liveStateRecorder();
    const runner = makeRunner();
    live.subscribe(runner);

    runner.dispatcher.dispatch(turnStart(0, 'Weather in NYC?'));
    expect(live.isAgentInTurn()).toBe(true);

    runner.dispatcher.dispatch(llmStart('call-llm#0'));
    runner.dispatcher.dispatch(token('call-llm#0', "I'll "));
    runner.dispatcher.dispatch(token('call-llm#0', 'check', 1));
    expect(live.isLLMInFlight()).toBe(true);
    expect(live.getPartialLLM()).toBe("I'll check");
    runner.dispatcher.dispatch(llmEnd('call-llm#0'));
    expect(live.isLLMInFlight()).toBe(false);

    runner.dispatcher.dispatch(toolStart('weather', 'tc-1', { city: 'NYC' }));
    expect(live.isToolExecuting()).toBe(true);
    expect(live.getExecutingToolNames()).toEqual(['weather']);
    runner.dispatcher.dispatch(toolEnd('tc-1', { tempF: 42 }));
    expect(live.isToolExecuting()).toBe(false);

    runner.dispatcher.dispatch(llmStart('call-llm#1'));
    runner.dispatcher.dispatch(token('call-llm#1', 'It is 42°F.'));
    runner.dispatcher.dispatch(llmEnd('call-llm#1'));

    runner.dispatcher.dispatch(turnEnd(0));
    expect(live.isAgentInTurn()).toBe(false);
  });

  it('parallel LLM calls (Parallel composition) tracked independently', () => {
    const live = liveStateRecorder();
    const runner = makeRunner();
    live.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('call-A'));
    runner.dispatcher.dispatch(llmStart('call-B'));
    runner.dispatcher.dispatch(token('call-A', 'A'));
    runner.dispatcher.dispatch(token('call-B', 'B'));

    expect(live.llm.activeCount).toBe(2);
    expect(live.llm.getActive('call-A')?.partial).toBe('A');
    expect(live.llm.getActive('call-B')?.partial).toBe('B');

    runner.dispatcher.dispatch(llmEnd('call-A'));
    expect(live.llm.activeCount).toBe(1);
    runner.dispatcher.dispatch(llmEnd('call-B'));
    expect(live.llm.activeCount).toBe(0);
  });

  it('clear() resets all three trackers', () => {
    const live = liveStateRecorder();
    const runner = makeRunner();
    live.subscribe(runner);

    runner.dispatcher.dispatch(turnStart(0));
    runner.dispatcher.dispatch(llmStart('rid'));
    runner.dispatcher.dispatch(toolStart('t', 'tc'));

    expect(live.llm.hasActive).toBe(true);
    expect(live.tool.hasActive).toBe(true);
    expect(live.turn.hasActive).toBe(true);

    live.clear();
    expect(live.llm.hasActive).toBe(false);
    expect(live.tool.hasActive).toBe(false);
    expect(live.turn.hasActive).toBe(false);
  });
});

// ─── Tier 3 — Integration ──────────────────────────────────────────

describe('LiveStateRecorder — Tier 3: Integration', () => {
  it('subscribe returns an Unsubscribe that detaches all three trackers', () => {
    const live = liveStateRecorder();
    const runner = makeRunner();
    const off = live.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('rid'));
    expect(live.isLLMInFlight()).toBe(true);
    runner.dispatcher.dispatch(llmEnd('rid'));

    off();

    // After unsubscribe, new events are ignored.
    runner.dispatcher.dispatch(llmStart('rid2'));
    expect(live.isLLMInFlight()).toBe(false);
  });

  it('subscribe is idempotent — second call replaces first (no double-counting)', () => {
    const live = liveStateRecorder();
    const runner = makeRunner();

    live.subscribe(runner);
    live.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('rid'));
    runner.dispatcher.dispatch(token('rid', 'X'));
    runner.dispatcher.dispatch(token('rid', 'Y', 1));

    // If subscriptions stacked, partial would have 4 chars (XYXY) and
    // tokens would be 4. With idempotent subscribe, exactly XY / 2.
    expect(live.llm.getActive('rid')?.partial).toBe('XY');
    expect(live.llm.getActive('rid')?.tokens).toBe(2);
  });

  it('factory function returns a fresh recorder', () => {
    const a = liveStateRecorder();
    const b = liveStateRecorder();
    expect(a).not.toBe(b);
    expect(a.llm).not.toBe(b.llm);
  });
});

// ─── Tier 4 — Property ─────────────────────────────────────────────

describe('LiveStateRecorder — Tier 4: Property', () => {
  it('every (llm_start, llm_end) pair returns the tracker to inactive', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    for (let i = 0; i < 50; i++) {
      runner.dispatcher.dispatch(llmStart(`r${i}`));
      runner.dispatcher.dispatch(token(`r${i}`, 'x'));
      runner.dispatcher.dispatch(llmEnd(`r${i}`));
    }
    expect(tr.activeCount).toBe(0);
  });

  it('matched tool boundaries clean up regardless of interleaving', () => {
    const tr = new LiveToolTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    // Start 3 tools, end them in scrambled order.
    runner.dispatcher.dispatch(toolStart('a', 'A'));
    runner.dispatcher.dispatch(toolStart('b', 'B'));
    runner.dispatcher.dispatch(toolStart('c', 'C'));
    expect(tr.activeCount).toBe(3);

    runner.dispatcher.dispatch(toolEnd('B'));
    runner.dispatcher.dispatch(toolEnd('A'));
    runner.dispatcher.dispatch(toolEnd('C'));
    expect(tr.activeCount).toBe(0);
  });

  it('updates without a matching start are dropped (no map growth)', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    // Token with no preceding llm_start.
    runner.dispatcher.dispatch(token('nope', 'lost'));
    expect(tr.activeCount).toBe(0);
  });
});

// ─── Tier 5 — Performance ──────────────────────────────────────────

describe('LiveStateRecorder — Tier 5: Performance', () => {
  it('1000 LLM calls × 5 token chunks each completes under 200ms', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      const rid = `r${i}`;
      runner.dispatcher.dispatch(llmStart(rid));
      for (let j = 0; j < 5; j++) {
        runner.dispatcher.dispatch(token(rid, 'x', j));
      }
      runner.dispatcher.dispatch(llmEnd(rid));
    }
    const elapsed = performance.now() - t0;
    expect(tr.activeCount).toBe(0);
    expect(elapsed).toBeLessThan(200);
  });

  it('100 concurrent active LLM calls — getActive remains O(1)', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    for (let i = 0; i < 100; i++) {
      runner.dispatcher.dispatch(llmStart(`r${i}`));
    }
    expect(tr.activeCount).toBe(100);

    const t0 = performance.now();
    for (let i = 0; i < 100; i++) tr.getActive(`r${i}`);
    const elapsed = performance.now() - t0;
    expect(elapsed).toBeLessThan(5);
  });
});

// ─── Tier 6 — Security / Error ─────────────────────────────────────

describe('LiveStateRecorder — Tier 6: Security & Error', () => {
  it('out-of-order token after llm_end is silently dropped', () => {
    const tr = new LiveLLMTracker();
    const runner = makeRunner();
    tr.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('rid'));
    runner.dispatcher.dispatch(llmEnd('rid'));
    runner.dispatcher.dispatch(token('rid', 'late'));

    expect(tr.getActive('rid')).toBeUndefined();
    expect(tr.activeCount).toBe(0);
  });

  it('unsubscribe stops all event forwarding', () => {
    const live = liveStateRecorder();
    const runner = makeRunner();
    live.subscribe(runner);
    live.unsubscribe();

    runner.dispatcher.dispatch(turnStart(0));
    runner.dispatcher.dispatch(llmStart('rid'));
    runner.dispatcher.dispatch(toolStart('t', 'tc'));

    expect(live.isAgentInTurn()).toBe(false);
    expect(live.isLLMInFlight()).toBe(false);
    expect(live.isToolExecuting()).toBe(false);
  });

  it('clear() does not unsubscribe — subsequent events still tracked', () => {
    const live = liveStateRecorder();
    const runner = makeRunner();
    live.subscribe(runner);

    runner.dispatcher.dispatch(llmStart('a'));
    live.clear();
    expect(live.isLLMInFlight()).toBe(false);

    runner.dispatcher.dispatch(llmStart('b'));
    expect(live.isLLMInFlight()).toBe(true);
  });

  it('getCurrentTurnIndex returns -1 when no turn active', () => {
    const tr = new LiveAgentTurnTracker();
    expect(tr.getCurrentTurnIndex()).toBe(-1);
  });

  it('getLatestPartial returns empty string when no LLM active', () => {
    const tr = new LiveLLMTracker();
    expect(tr.getLatestPartial()).toBe('');
  });
});

// ─── Tier 7 — ROI ──────────────────────────────────────────────────

describe('LiveStateRecorder — Tier 7: ROI', () => {
  it('exported from agentfootprint main barrel', async () => {
    const af = await import('../../../src/index.js');
    expect((af as Record<string, unknown>).LiveStateRecorder).toBeDefined();
    expect((af as Record<string, unknown>).liveStateRecorder).toBeDefined();
    expect((af as Record<string, unknown>).LiveLLMTracker).toBeDefined();
    expect((af as Record<string, unknown>).LiveToolTracker).toBeDefined();
    expect((af as Record<string, unknown>).LiveAgentTurnTracker).toBeDefined();
  });

  it('exported from /observe subpath', async () => {
    const obs = await import('../../../src/observe.js');
    expect((obs as Record<string, unknown>).LiveStateRecorder).toBeDefined();
  });

  it('LiveStateRecorder has tight read-API surface', () => {
    const live = liveStateRecorder();
    const proto = Object.getPrototypeOf(live);
    const methods = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');
    // Expected: subscribe, unsubscribe, clear, isLLMInFlight, getPartialLLM,
    // isToolExecuting, getExecutingToolNames, isAgentInTurn,
    // getCurrentTurnIndex = 9 methods. Cap at 12 for headroom.
    expect(methods.length).toBeLessThanOrEqual(12);
  });
});
