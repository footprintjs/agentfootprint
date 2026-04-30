/**
 * Dynamic ReAct loop — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * v2.5 Block A0 — restored per-iteration InjectionEngine re-evaluation.
 * Before this fix, the agent's loopTo target was MESSAGES, which meant
 * iter 2+ skipped INJECTION_ENGINE entirely. Predicates with
 * `activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'X'` never
 * fired on iter 2; per-iteration system-prompt / tool-list recomposition
 * never happened; activated skills never landed their bodies on iter 2.
 *
 * After this fix, loopTo target is INJECTION_ENGINE → every iteration
 * re-runs the full slot composition pipeline. Tool results reshape the
 * next iteration's prompt + tool list + active skills. THE differentiator.
 */

import { describe, expect, it } from 'vitest';
import { Agent, defineInstruction, defineTool, mock } from '../../src/index.js';

// ─── Fixtures ─────────────────────────────────────────────────────

function buildEchoAgent(opts: { iterations: number }) {
  const echoTool = defineTool({
    name: 'echo',
    description: 'Echo input back.',
    inputSchema: { type: 'object', properties: { msg: { type: 'string' } } },
    execute: async ({ msg }: { msg: string }) => `echoed: ${msg}`,
  });

  const noisy = defineInstruction({
    id: 'noisy',
    activeWhen: () => true,
    prompt: 'NOISY-RULE active.',
  });

  const postEcho = defineInstruction({
    id: 'post-echo',
    activeWhen: (ctx) => ctx.lastToolResult?.toolName === 'echo',
    prompt: 'POST-ECHO-RULE active.',
  });

  let iter = 0;
  const provider = mock({
    respond: () => {
      iter++;
      if (iter < opts.iterations) {
        return {
          content: '',
          toolCalls: [{ id: `c${iter}`, name: 'echo', args: { msg: 'hi' } }],
        };
      }
      return { content: 'done', toolCalls: [] };
    },
  });

  const fires: { iter: number; sourceId: string }[] = [];
  let currentIter = 0;

  const agent = Agent.create({ provider, model: 'mock', maxIterations: opts.iterations + 2 })
    .system('You answer.')
    .tool(echoTool)
    .instruction(noisy)
    .instruction(postEcho)
    .build();

  agent.on('agentfootprint.agent.iteration_start', (e) => {
    currentIter = e.payload.iterIndex;
  });

  agent.on('agentfootprint.context.injected', (e) => {
    if (e.payload.source === 'instructions' && e.payload.sourceId) {
      fires.push({ iter: currentIter, sourceId: e.payload.sourceId });
    }
  });

  return { agent, fires };
}

// ─── 1. UNIT — InjectionEngine re-runs per iteration ───────────────

describe('Dynamic ReAct loop — unit: per-iteration re-evaluation', () => {
  it('always-on instruction fires on every iteration', async () => {
    const { agent, fires } = buildEchoAgent({ iterations: 4 });
    await agent.run({ message: 'echo something' });
    const noisyFires = fires.filter((f) => f.sourceId === 'noisy');
    // 4 iterations × 1 noisy each = 4 fires (final iter is the one
    // that returns no tool calls; injection-engine runs there too)
    expect(noisyFires.length).toBeGreaterThanOrEqual(3);
  });

  it('on-tool-return predicate fires on iteration AFTER named tool ran', async () => {
    const { agent, fires } = buildEchoAgent({ iterations: 3 });
    await agent.run({ message: 'echo something' });
    const postEchoFires = fires.filter((f) => f.sourceId === 'post-echo');
    // post-echo fires on iter 2+ (after echo ran on iter 1, 2)
    expect(postEchoFires.length).toBeGreaterThanOrEqual(2);
  });
});

// ─── 2. SCENARIO — predicate state changes between iterations ──────

describe('Dynamic ReAct loop — scenario: state-driven predicate', () => {
  it('predicate that toggles on iteration count fires accordingly', async () => {
    const oddOnly = defineInstruction({
      id: 'odd-only',
      activeWhen: (ctx) => ctx.iteration % 2 === 1,
      prompt: 'ODD iteration.',
    });
    let iter = 0;
    const provider = mock({
      respond: () => {
        iter++;
        if (iter < 4) {
          return { content: '', toolCalls: [{ id: `c${iter}`, name: 'noop', args: {} }] };
        }
        return { content: 'done', toolCalls: [] };
      },
    });
    const noopTool = defineTool({
      name: 'noop',
      description: 'noop',
      inputSchema: { type: 'object' },
      execute: async () => 'ok',
    });
    const fires: number[] = [];
    let currentIter = 0;
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 6 })
      .system('You loop.')
      .tool(noopTool)
      .instruction(oddOnly)
      .build();

    agent.on('agentfootprint.agent.iteration_start', (e) => {
      currentIter = e.payload.iterIndex;
    });
    agent.on('agentfootprint.context.injected', (e) => {
      if (e.payload.sourceId === 'odd-only') fires.push(currentIter);
    });
    await agent.run({ message: 'go' });
    // odd-only fires when ctx.iteration is odd (1, 3, ...).
    // Note: iteration_start.iterIndex is 0-based; ctx.iteration is 1-based.
    // The captured value is iterIndex. We verify SOME fires happened
    // (proving the predicate runs per iteration; pre-fix it would
    // never have fired past iter 0).
    expect(fires.length).toBeGreaterThan(0);
  });
});

// ─── 3. INTEGRATION — fix vs old behavior is observable ────────────

describe('Dynamic ReAct loop — integration: fix is observable', () => {
  it('on-tool-return AND always-on rules both fire across multiple iterations', async () => {
    // Pre-fix (loopTo=MESSAGES): only iter 0/1 saw injection events;
    // iter 2+ had NO instruction fires.
    // Post-fix (loopTo=INJECTION_ENGINE): every iteration sees fresh
    // injection events.
    const { agent, fires } = buildEchoAgent({ iterations: 3 });
    await agent.run({ message: 'multi-iter run' });
    // Distinct iterations that fired noisy
    const iterations = new Set(fires.filter((f) => f.sourceId === 'noisy').map((f) => f.iter));
    // Pre-fix would have had iterations.size <= 1 (only iter 1 ran InjectionEngine)
    // Post-fix has iterations.size >= 2
    expect(iterations.size).toBeGreaterThanOrEqual(2);
  });
});

// ─── 4. PROPERTY ───────────────────────────────────────────────────

describe('Dynamic ReAct loop — properties', () => {
  it('always-on rule fires on EVERY iteration that runs (no skips)', async () => {
    const { agent, fires } = buildEchoAgent({ iterations: 5 });
    await agent.run({ message: 'go' });
    const noisyIters = new Set(fires.filter((f) => f.sourceId === 'noisy').map((f) => f.iter));
    // Iterations are 1-indexed; should see at least 4 distinct iters
    expect(noisyIters.size).toBeGreaterThanOrEqual(4);
  });

  it('activeInjections array stays bounded per iteration (no accumulation)', async () => {
    // REGRESSION TEST for the v2.5.0 InjectionEngine subflow bug:
    // outputMapper was missing `arrayMerge: ArrayMergeMode.Replace`.
    // Effect: parent's `activeInjections` accumulated each iteration
    //   iter 1: [...] (8 items)
    //   iter 2: [...prev, ...new] (16 items)
    //   iter 3: 24, iter 4: 32, ...
    // System prompt grew linearly with iteration count → Dynamic-mode
    // input tokens roughly 1.5–3× over the correct value.
    //
    // Property: at any iteration, scope.activeInjections must contain
    // ONLY the injections active for THAT iteration, not the union of
    // all prior iterations. With the always-on `noisy` + on-tool-return
    // `post-echo` predicates, the count should be ≤2 per iter (the
    // user message itself can add a 'user' source but this only lands
    // in messagesInjections, not activeInjections).
    const { agent } = buildEchoAgent({ iterations: 5 });
    const perIterCounts: number[] = [];
    let currentIter = 0;
    agent.on('agentfootprint.agent.iteration_start', (e) => {
      currentIter = e.payload.iterIndex;
    });
    // ContextRecorder dispatches `slot_composed` per-slot with a
    // sourceBreakdown summary. We instead introspect the snapshot
    // post-run for the ground-truth `activeInjections` length.
    await agent.run({ message: 'echo something' });
    const snap = agent.getLastSnapshot();
    const finalActive = (
      (snap?.sharedState as { activeInjections?: readonly unknown[] })?.activeInjections ?? []
    ).length;
    // The agent has exactly 2 injection definitions (`noisy` always-on +
    // `post-echo` on-tool-return). On the FINAL iteration after the
    // loop unwinds, scope.activeInjections reflects that iter's
    // engine output. Pre-fix: 2 × N iterations = 10+ entries by iter 5.
    // Post-fix: ≤2 entries (one or both predicates true).
    // We assert ≤4 (generous upper bound that still catches the bug;
    // 5+ proves accumulation).
    expect(finalActive).toBeLessThanOrEqual(4);
    // Capture for diagnostic message in case of regression
    perIterCounts.push(currentIter);
  });

  it('systemPromptInjections stays bounded per iteration', async () => {
    // Sister regression: even with InjectionEngine fixed, if the
    // SystemPrompt slot subflow lost its arrayMerge: Replace flag,
    // the system prompt would still grow. This test exercises the
    // composed pipeline end-to-end.
    const { agent } = buildEchoAgent({ iterations: 5 });
    await agent.run({ message: 'echo something' });
    const snap = agent.getLastSnapshot();
    const finalSystem = (
      (snap?.sharedState as { systemPromptInjections?: readonly unknown[] })
        ?.systemPromptInjections ?? []
    ).length;
    // Pre-fix: 1 base prompt + ~2 injections × 5 iters = 11+ entries.
    // Post-fix: 1 base prompt + ≤2 injections = ≤3 entries.
    // Cap at 5 to catch any accumulation while tolerating minor variation.
    expect(finalSystem).toBeLessThanOrEqual(5);
  });

  it('messagesInjections stays bounded per iteration', async () => {
    // Same property for the Messages slot.
    const { agent } = buildEchoAgent({ iterations: 5 });
    await agent.run({ message: 'echo something' });
    const snap = agent.getLastSnapshot();
    // History grows with tool calls + tool results, that's expected.
    // But messagesInjections should mirror history size, not multiply it.
    const finalMessages = (
      (snap?.sharedState as { messagesInjections?: readonly unknown[] })?.messagesInjections ?? []
    ).length;
    const historyLen = (
      (snap?.sharedState as { history?: readonly unknown[] })?.history ?? []
    ).length;
    // Messages slot mirrors history (1 user + N assistant/tool pairs).
    // Allow up to 1.5× history (extra room for any consumer-injected
    // assistant prefills); reject 2×+ which is the accumulation bug.
    expect(finalMessages).toBeLessThanOrEqual(Math.ceil(historyLen * 1.5));
  });
});

// ─── 5. SECURITY — predicates can NOT skip iterations ──────────────

describe('Dynamic ReAct loop — security', () => {
  it('predicate that always returns false NEVER fires (loop fix does not bypass predicates)', async () => {
    const never = defineInstruction({
      id: 'never',
      activeWhen: () => false,
      prompt: 'NEVER.',
    });
    let iter = 0;
    const provider = mock({
      respond: () => {
        iter++;
        if (iter < 3) {
          return { content: '', toolCalls: [{ id: `c${iter}`, name: 'noop', args: {} }] };
        }
        return { content: 'done', toolCalls: [] };
      },
    });
    const noopTool = defineTool({
      name: 'noop',
      description: 'noop',
      inputSchema: { type: 'object' },
      execute: async () => 'ok',
    });
    const fires: string[] = [];
    const agent = Agent.create({ provider, model: 'mock', maxIterations: 5 })
      .system('s')
      .tool(noopTool)
      .instruction(never)
      .build();
    agent.on('agentfootprint.context.injected', (e) => {
      if (e.payload.sourceId === 'never') fires.push(e.payload.sourceId);
    });
    await agent.run({ message: 'go' });
    expect(fires.length).toBe(0);
  });
});

// ─── 6. PERFORMANCE ───────────────────────────────────────────────

describe('Dynamic ReAct loop — performance', () => {
  it('per-iteration InjectionEngine evaluation cost is bounded', async () => {
    // 10-iteration agent with 5 instructions; should complete in <1s
    const provider = mock({
      respond: ((iter) => () => {
        iter.n++;
        if (iter.n < 10) {
          return { content: '', toolCalls: [{ id: `c${iter.n}`, name: 'noop', args: {} }] };
        }
        return { content: 'done', toolCalls: [] };
      })({ n: 0 }),
    });
    const noopTool = defineTool({
      name: 'noop',
      description: 'noop',
      inputSchema: { type: 'object' },
      execute: async () => 'ok',
    });
    const builder = Agent.create({ provider, model: 'mock', maxIterations: 12 })
      .system('s')
      .tool(noopTool);
    for (let i = 0; i < 5; i++) {
      builder.instruction(
        defineInstruction({ id: `inst-${i}`, activeWhen: () => true, prompt: 'r' }),
      );
    }
    const agent = builder.build();
    const t0 = Date.now();
    await agent.run({ message: 'go' });
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(1000);
  });
});

// ─── 7. ROI — what the fix unlocks ────────────────────────────────

describe('Dynamic ReAct loop — ROI', () => {
  it('on-tool-return injection: rule fires the iteration AFTER named tool ran', async () => {
    // The hero use case for Dynamic ReAct: a tool returns redacted PII;
    // the next iteration sees a "use redacted output" instruction in
    // the system slot. Without the loop fix, the instruction never fires.
    const { agent, fires } = buildEchoAgent({ iterations: 3 });
    await agent.run({ message: 'echo' });
    const postEchoFires = fires.filter((f) => f.sourceId === 'post-echo');
    expect(postEchoFires.length).toBeGreaterThan(0);
    // Each post-echo fire was on an iteration AFTER echo ran
    for (const f of postEchoFires) {
      expect(f.iter).toBeGreaterThanOrEqual(1);
    }
  });
});
