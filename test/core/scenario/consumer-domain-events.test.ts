/**
 * Consumer-emitted domain events — eval / memory / skill.
 *
 * These domains have no library-level implementation (evaluation
 * strategy, memory store, skill manager are all consumer concerns).
 * The library provides:
 *   1. Typed event payloads in the registry (so `.on('<type>', ...)`
 *      gives compile-time payload checking).
 *   2. Always-on `EmitBridge` recorders on every LLMCall/Agent run so
 *      stage-code emits via `scope.$emit` reach typed listeners.
 *   3. The `.emit(name, payload)` method on every Runner for
 *      consumer-code emission outside of a stage function.
 *
 * Bridges are zero-alloc when no listener is attached (early exit).
 *
 * 7-pattern tests demonstrate transport works for both paths.
 */

import { describe, it, expect, vi } from 'vitest';
import { LLMCall } from '../../../src/core/LLMCall.js';
import { Agent } from '../../../src/core/Agent.js';
import { MockProvider } from '../../../src/adapters/llm/MockProvider.js';

// ── 1. Unit — runner.emit routes typed events to typed listeners ────

describe('consumer-domain events — unit', () => {
  it('runner.emit fires a typed listener with the payload shape', () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    let received: unknown;
    llm.on('agentfootprint.eval.score', (e) => {
      received = e.payload;
    });
    llm.emit('agentfootprint.eval.score', {
      metricId: 'relevance',
      value: 0.87,
      target: 'run',
      targetRef: 'r1',
      evaluator: 'heuristic',
    });

    expect((received as { metricId: string }).metricId).toBe('relevance');
    expect((received as { value: number }).value).toBe(0.87);
  });

  it('runner.emit with no listener is a no-op (zero-alloc short circuit)', () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();
    // No .on() — emitting must not throw and must not allocate events.
    expect(() =>
      llm.emit('agentfootprint.memory.written', {
        storeId: 'chat',
        key: 'turn-1',
        tokens: 150,
      }),
    ).not.toThrow();
  });
});

// ── 2. Scenario — eval / memory / skill all fire ────────────────────

describe('consumer-domain events — scenario', () => {
  it('eval.score payload round-trips end-to-end through the dispatcher', () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const received: unknown[] = [];
    agent.on('agentfootprint.eval.score', (e) => received.push(e.payload));

    agent.emit('agentfootprint.eval.score', {
      metricId: 'grounding',
      value: 0.92,
      threshold: 0.8,
      target: 'toolCall',
      targetRef: 'tool-call-1',
      evaluator: 'llm',
    });

    expect(received).toHaveLength(1);
    expect((received[0] as { metricId: string }).metricId).toBe('grounding');
    expect((received[0] as { threshold: number }).threshold).toBe(0.8);
  });

  it('memory.strategy_applied round-trips strategy kind + evidence', () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    let payload: { strategyKind: string; scoreEvidence?: { tokens: number } } | undefined;
    llm.on('agentfootprint.memory.strategy_applied', (e) => {
      payload = e.payload as typeof payload;
    });

    llm.emit('agentfootprint.memory.strategy_applied', {
      strategyId: 'sliding-100',
      strategyKind: 'sliding-window',
      reason: 'token-budget-exceeded',
      scoreEvidence: { tokens: 4500, limit: 4000 },
    });

    expect(payload?.strategyKind).toBe('sliding-window');
    expect(payload?.scoreEvidence?.tokens).toBe(4500);
  });

  it('skill.activated / deactivated both reach their listeners', () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const activations: string[] = [];
    const deactivations: string[] = [];
    agent.on('agentfootprint.skill.activated', (e) => activations.push(e.payload.skillId));
    agent.on('agentfootprint.skill.deactivated', (e) => deactivations.push(e.payload.skillId));

    agent.emit('agentfootprint.skill.activated', { skillId: 'sql', reason: 'intent-matched' });
    agent.emit('agentfootprint.skill.deactivated', { skillId: 'sql', reason: 'done' });

    expect(activations).toEqual(['sql']);
    expect(deactivations).toEqual(['sql']);
  });
});

// ── 3. Integration — events accumulate across multiple runs ─────────

describe('consumer-domain events — integration', () => {
  it('listener accumulates emits issued before, during, and after run()', async () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'done' }), model: 'mock' })
      .system('')
      .build();

    let count = 0;
    llm.on('agentfootprint.memory.written', () => count++);

    llm.emit('agentfootprint.memory.written', { storeId: 's', key: 'a', tokens: 10 });
    await llm.run({ message: 'hi' });
    llm.emit('agentfootprint.memory.written', { storeId: 's', key: 'b', tokens: 20 });
    expect(count).toBe(2);
  });
});

// ── 4. Property — every domain name is reachable via runner.emit ────

describe('consumer-domain events — property', () => {
  it.each([
    'agentfootprint.eval.score' as const,
    'agentfootprint.eval.threshold_crossed' as const,
    'agentfootprint.memory.strategy_applied' as const,
    'agentfootprint.memory.attached' as const,
    'agentfootprint.memory.detached' as const,
    'agentfootprint.memory.written' as const,
    'agentfootprint.skill.activated' as const,
    'agentfootprint.skill.deactivated' as const,
  ])('%s listener receives a dispatched event via .emit', (type) => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    let fired = false;
    agent.on(type, () => {
      fired = true;
    });
    // Minimal payload — structural shape doesn't matter for transport.
    agent.emit(type, { probe: true });
    expect(fired).toBe(true);
  });
});

// ── 5. Security — untyped emit names don't match typed listeners ────

describe('consumer-domain events — security', () => {
  it('unknown event-name emit does not fire a registered-type listener', () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    let evalFired = false;
    llm.on('agentfootprint.eval.score', () => {
      evalFired = true;
    });
    // Emit a name that looks similar but is not registered.
    llm.emit('agentfootprint.eval.unknown', { payload: 'x' });
    expect(evalFired).toBe(false);
  });

  it('hostile consumer emit payload (circular object) does not crash', () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const circular: Record<string, unknown> = {};
    circular.self = circular;
    llm.on('agentfootprint.eval.score', () => {
      /* no-op */
    });
    // Dispatcher passes the payload reference directly; no serialization.
    expect(() =>
      llm.emit('agentfootprint.eval.score', { payload: circular }),
    ).not.toThrow();
  });
});

// ── 6. Performance — N emits with no listener complete in bounded time ──

describe('consumer-domain events — performance', () => {
  it('1000 emits with no listener complete in under 100ms (zero-alloc path)', () => {
    const llm = LLMCall.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();
    const t0 = performance.now();
    for (let i = 0; i < 1000; i++) {
      llm.emit('agentfootprint.memory.written', { storeId: 's', key: `k${i}`, tokens: 1 });
    }
    expect(performance.now() - t0).toBeLessThan(100);
  });
});

// ── 7. ROI — single runner hosts listeners for all domains ──────────

describe('consumer-domain events — ROI', () => {
  it('a single Agent instance routes eval / memory / skill events to separate listeners', () => {
    const agent = Agent.create({ provider: new MockProvider({ reply: 'ok' }), model: 'mock' })
      .system('')
      .build();

    const evalFire = vi.fn();
    const memFire = vi.fn();
    const skillFire = vi.fn();
    agent.on('agentfootprint.eval.score', evalFire);
    agent.on('agentfootprint.memory.attached', memFire);
    agent.on('agentfootprint.skill.deactivated', skillFire);

    agent.emit('agentfootprint.eval.score', {
      metricId: 'x',
      value: 1,
      target: 'run',
      targetRef: 'r',
    });
    agent.emit('agentfootprint.memory.attached', { storeId: 'chat' });
    agent.emit('agentfootprint.skill.deactivated', { skillId: 's', reason: 'idle' });

    expect(evalFire).toHaveBeenCalledTimes(1);
    expect(memFire).toHaveBeenCalledTimes(1);
    expect(skillFire).toHaveBeenCalledTimes(1);
  });
});
