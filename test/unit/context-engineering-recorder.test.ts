/**
 * ContextEngineeringRecorder contract — the consumer-facing surface
 * for any UI / observability tool that wants to see context injections.
 *
 * Mirrors footprintjs CombinedNarrativeRecorder's role in the narrative
 * domain: the library emits, the recorder collects, every consumer
 * (Lens, Datadog dashboards, custom React, CLI) reads the same shape.
 *
 * Five pattern tests exercise the full circle:
 *   1. Captures a single injection with the enriched fields
 *   2. Folds multiple injections into a cumulative ledger
 *   3. Tracks per-iteration ledger via surrounding llm_start events
 *   4. Groups by source and by slot
 *   5. clear() wipes state for re-runs
 */
import { describe, expect, it } from 'vitest';
import { contextEngineering } from '../../src';
import type { EmitEvent } from 'footprintjs';

function emit(name: string, payload: Record<string, unknown>): EmitEvent {
  return {
    name,
    payload,
    stageName: 'test',
    runtimeStageId: 'test#0',
    subflowPath: undefined,
    pipelineId: 'test',
    timestamp: Date.now(),
  };
}

describe('contextEngineering() recorder — the consumer-facing surface', () => {
  it('1. captures a single RAG injection with role + targetIndex + deltaCount', () => {
    const ctx = contextEngineering();
    ctx.onEmit(
      emit('agentfootprint.context.rag.chunks', {
        slot: 'messages',
        role: 'system',
        targetIndex: 1,
        deltaCount: { system: 1 },
        chunkCount: 2,
        topScore: 0.9,
      }),
    );
    const list = ctx.injections();
    expect(list.length).toBe(1);
    expect(list[0].source).toBe('rag');
    expect(list[0].slot).toBe('messages');
    expect(list[0].role).toBe('system');
    expect(list[0].targetIndex).toBe(1);
    expect(list[0].deltaCount).toEqual({ system: 1 });
    expect(list[0].eventName).toBe('agentfootprint.context.rag.chunks');
  });

  it('2. folds multiple injections into a cumulative ledger', () => {
    const ctx = contextEngineering();
    // RAG +1 system msg
    ctx.onEmit(
      emit('agentfootprint.context.rag.chunks', {
        slot: 'messages',
        role: 'system',
        deltaCount: { system: 1 },
      }),
    );
    // Memory +1 system msg
    ctx.onEmit(
      emit('agentfootprint.context.memory.injected', {
        slot: 'messages',
        role: 'system',
        deltaCount: { system: 1 },
      }),
    );
    // Skill +1200 chars to system prompt + tools-from-skill flag
    ctx.onEmit(
      emit('agentfootprint.context.skill.activated', {
        slot: 'system-prompt',
        skillId: 'weather',
        deltaCount: { systemPromptChars: 1200, toolsFromSkill: true },
      }),
    );
    const ledger = ctx.ledger();
    expect(ledger.system).toBe(2); // RAG + Memory summed
    expect(ledger.systemPromptChars).toBe(1200);
    expect(ledger.toolsFromSkill).toBe(true);
  });

  it('3. tracks per-iteration ledger via surrounding llm_start events', () => {
    const ctx = contextEngineering();
    // Iter 1 — RAG injects
    ctx.onEmit(emit('agentfootprint.stream.llm_start', { iteration: 1 }));
    ctx.onEmit(
      emit('agentfootprint.context.rag.chunks', {
        slot: 'messages',
        role: 'system',
        deltaCount: { system: 1 },
      }),
    );
    // Iter 2 — Memory injects
    ctx.onEmit(emit('agentfootprint.stream.llm_start', { iteration: 2 }));
    ctx.onEmit(
      emit('agentfootprint.context.memory.injected', {
        slot: 'messages',
        role: 'system',
        deltaCount: { system: 1 },
      }),
    );

    const byIter = ctx.ledgerByIteration();
    expect(byIter.get(1)?.system).toBe(1);
    expect(byIter.get(2)?.system).toBe(1);
    // Cumulative ledger sums BOTH iterations.
    expect(ctx.ledger().system).toBe(2);
  });

  it('4. groups injections by source and by slot', () => {
    const ctx = contextEngineering();
    ctx.onEmit(emit('agentfootprint.context.rag.chunks', { slot: 'messages' }));
    ctx.onEmit(emit('agentfootprint.context.rag.chunks', { slot: 'messages' }));
    ctx.onEmit(emit('agentfootprint.context.skill.activated', { slot: 'system-prompt' }));

    const bySource = ctx.bySource();
    expect(bySource.rag.length).toBe(2);
    expect(bySource.skill.length).toBe(1);

    const bySlot = ctx.bySlot();
    expect(bySlot.messages.length).toBe(2);
    expect(bySlot['system-prompt'].length).toBe(1);
  });

  it('5. clear() wipes injections + iteration state for re-runs', () => {
    const ctx = contextEngineering();
    ctx.onEmit(emit('agentfootprint.stream.llm_start', { iteration: 5 }));
    ctx.onEmit(
      emit('agentfootprint.context.rag.chunks', {
        slot: 'messages',
        deltaCount: { system: 99 },
      }),
    );
    expect(ctx.injections().length).toBe(1);
    expect(ctx.ledger().system).toBe(99);

    ctx.clear();
    expect(ctx.injections()).toEqual([]);
    expect(ctx.ledger()).toEqual({});

    // Iteration counter resets to 0 so the next run's injections start
    // with iteration=undefined until the next llm_start fires.
    ctx.onEmit(emit('agentfootprint.context.memory.injected', { slot: 'messages' }));
    expect(ctx.injections()[0].iteration).toBeUndefined();
  });
});
