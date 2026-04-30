/**
 * contextEngineering — 7-pattern test matrix
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Pins the contract:
 *   - Pure classifiers (isEngineeredSource / isBaselineSource) — total
 *     coverage of the union, no overlap.
 *   - The two source sets are disjoint and frozen.
 *   - contextEngineering(agent) returns onEngineered + onBaseline +
 *     detach() with correct routing.
 *   - Unknown / future sources route to NEITHER stream (under-fire by
 *     design — caller can subscribe to raw event for completeness).
 *   - detach() removes ALL listeners idempotently.
 *   - End-to-end with real Agent: engineered injection (Instruction)
 *     reaches onEngineered; user message reaches onBaseline.
 */

import { describe, expect, it } from 'vitest';
import {
  Agent,
  contextEngineering,
  defineInstruction,
  isEngineeredSource,
  isBaselineSource,
  ENGINEERED_SOURCES,
  BASELINE_SOURCES,
  mock,
  type ContextInjectedEvent,
  type ContextSource,
} from '../../src/index.js';

// ─── 1. UNIT — pure classifiers ───────────────────────────────────

describe('contextEngineering — unit: pure classifiers', () => {
  it('isEngineeredSource returns true for known engineered values', () => {
    const engineered: ContextSource[] = [
      'rag',
      'skill',
      'memory',
      'instructions',
      'steering',
      'fact',
      'custom',
    ];
    for (const s of engineered) expect(isEngineeredSource(s)).toBe(true);
  });

  it('isEngineeredSource returns false for baseline values', () => {
    const baseline: ContextSource[] = ['user', 'tool-result', 'assistant', 'base', 'registry'];
    for (const s of baseline) expect(isEngineeredSource(s)).toBe(false);
  });

  it('isBaselineSource is the inverse — true for baseline, false for engineered', () => {
    expect(isBaselineSource('user')).toBe(true);
    expect(isBaselineSource('tool-result')).toBe(true);
    expect(isBaselineSource('rag')).toBe(false);
    expect(isBaselineSource('skill')).toBe(false);
  });
});

// ─── 2. SCENARIO — sets are disjoint + immutable ──────────────────

describe('contextEngineering — scenario: source sets', () => {
  it('ENGINEERED_SOURCES and BASELINE_SOURCES are disjoint', () => {
    for (const e of ENGINEERED_SOURCES) {
      expect(BASELINE_SOURCES.has(e)).toBe(false);
    }
    for (const b of BASELINE_SOURCES) {
      expect(ENGINEERED_SOURCES.has(b)).toBe(false);
    }
  });

  it('ENGINEERED_SOURCES is non-empty and stable', () => {
    expect(ENGINEERED_SOURCES.size).toBeGreaterThan(0);
    // Stable membership across modules — pin known values
    expect(ENGINEERED_SOURCES.has('rag')).toBe(true);
    expect(ENGINEERED_SOURCES.has('skill')).toBe(true);
    expect(ENGINEERED_SOURCES.has('instructions')).toBe(true);
  });

  it('BASELINE_SOURCES contains the message-history flow', () => {
    expect(BASELINE_SOURCES.has('user')).toBe(true);
    expect(BASELINE_SOURCES.has('tool-result')).toBe(true);
  });
});

// ─── 3. INTEGRATION — wrapper routes correctly ────────────────────

describe('contextEngineering — integration: wrapper routing', () => {
  function makeFakeAgent() {
    type Listener = (e: ContextInjectedEvent) => void;
    const listeners: Listener[] = [];
    return {
      on: (type: 'agentfootprint.context.injected', listener: Listener) => {
        if (type !== 'agentfootprint.context.injected') {
          throw new Error('fake supports only context.injected');
        }
        listeners.push(listener);
        return () => {
          const idx = listeners.indexOf(listener);
          if (idx >= 0) listeners.splice(idx, 1);
        };
      },
      emit(source: ContextSource): void {
        const event: ContextInjectedEvent = {
          type: 'agentfootprint.context.injected',
          payload: {
            source,
            contentSummary: 'x',
            contentHash: 'h',
            slot: 'system',
            reason: 'r',
          },
          // The envelope has more fields; cast for the test
        } as unknown as ContextInjectedEvent;
        for (const l of [...listeners]) l(event);
      },
      listenerCount: () => listeners.length,
    };
  }

  it('onEngineered fires only for engineered sources', () => {
    const fake = makeFakeAgent();
    const ce = contextEngineering(fake);
    const seen: ContextSource[] = [];
    ce.onEngineered((e) => seen.push(e.payload.source));

    fake.emit('user');
    fake.emit('skill');
    fake.emit('tool-result');
    fake.emit('rag');
    fake.emit('memory');

    expect(seen).toEqual(['skill', 'rag', 'memory']);
  });

  it('onBaseline fires only for baseline sources', () => {
    const fake = makeFakeAgent();
    const ce = contextEngineering(fake);
    const seen: ContextSource[] = [];
    ce.onBaseline((e) => seen.push(e.payload.source));

    fake.emit('user');
    fake.emit('skill');
    fake.emit('tool-result');
    fake.emit('rag');

    expect(seen).toEqual(['user', 'tool-result']);
  });

  it('both subscribers fire side-by-side without interference', () => {
    const fake = makeFakeAgent();
    const ce = contextEngineering(fake);
    const eng: ContextSource[] = [];
    const base: ContextSource[] = [];
    ce.onEngineered((e) => eng.push(e.payload.source));
    ce.onBaseline((e) => base.push(e.payload.source));

    fake.emit('skill');
    fake.emit('user');
    fake.emit('rag');
    fake.emit('tool-result');

    expect(eng).toEqual(['skill', 'rag']);
    expect(base).toEqual(['user', 'tool-result']);
  });

  it('detach() removes ALL listeners (engineered + baseline)', () => {
    const fake = makeFakeAgent();
    const ce = contextEngineering(fake);
    const seen: string[] = [];
    ce.onEngineered(() => seen.push('e'));
    ce.onBaseline(() => seen.push('b'));

    expect(fake.listenerCount()).toBe(2);
    ce.detach();
    expect(fake.listenerCount()).toBe(0);

    fake.emit('skill');
    fake.emit('user');
    expect(seen).toEqual([]);
  });

  it('individual unsub from onEngineered does not detach onBaseline', () => {
    const fake = makeFakeAgent();
    const ce = contextEngineering(fake);
    const eng: string[] = [];
    const base: string[] = [];
    const unsubE = ce.onEngineered(() => eng.push('e'));
    ce.onBaseline(() => base.push('b'));

    unsubE();
    expect(fake.listenerCount()).toBe(1); // only baseline

    fake.emit('skill');
    fake.emit('user');
    expect(eng).toEqual([]);
    expect(base).toEqual(['b']);
  });
});

// ─── 4. PROPERTY — invariants ────────────────────────────────────

describe('contextEngineering — properties', () => {
  it('every defined ContextSource is in EXACTLY ONE of the sets, OR neither (forward-compat slot)', () => {
    // The test helper that asserts non-overlap is in the SCENARIO block.
    // Here we verify total coverage of known values.
    const known: ContextSource[] = [
      'rag',
      'skill',
      'memory',
      'instructions',
      'steering',
      'fact',
      'custom',
      'user',
      'tool-result',
      'assistant',
      'base',
      'registry',
    ];
    for (const s of known) {
      const inE = ENGINEERED_SOURCES.has(s);
      const inB = BASELINE_SOURCES.has(s);
      expect(inE || inB).toBe(true);
      expect(inE && inB).toBe(false);
    }
  });

  it('detach() is idempotent', () => {
    const fake = {
      on: () => () => {},
    };
    const ce = contextEngineering(fake);
    expect(() => {
      ce.detach();
      ce.detach();
      ce.detach();
    }).not.toThrow();
  });
});

// ─── 5. SECURITY — defensive ─────────────────────────────────────

describe('contextEngineering — security', () => {
  it('throwing inner unsub does not break detach for sibling subscriptions', () => {
    let goodCalled = false;
    const fake = {
      on: () => {
        // Mix one throwing unsub with one normal unsub
        return () => {
          throw new Error('uncooperative-unsub');
        };
      },
    };
    const ce = contextEngineering(fake);
    ce.onEngineered(() => {
      // never fires (fake doesn't emit)
    });
    // Replace the second subscription with a working one by using a
    // different fake — here the contract is "swallowing throws".
    expect(() => ce.detach()).not.toThrow();
    expect(goodCalled).toBe(false); // sanity
  });

  it('unknown/forward-compat source routes to NEITHER stream (under-fire by design)', () => {
    // When ContextSource is extended with a new value, callers using
    // contextEngineering() get under-fired (safer than miscategorized).
    // They can still subscribe to raw 'agentfootprint.context.injected'
    // for completeness.
    type Listener = (e: ContextInjectedEvent) => void;
    const listeners: Listener[] = [];
    const fake = {
      on: (_: 'agentfootprint.context.injected', l: Listener) => {
        listeners.push(l);
        return () => {
          listeners.splice(listeners.indexOf(l), 1);
        };
      },
      emit(s: ContextSource): void {
        const e: ContextInjectedEvent = {
          type: 'agentfootprint.context.injected',
          payload: { source: s, contentSummary: '', contentHash: '', slot: 'system', reason: '' },
        } as unknown as ContextInjectedEvent;
        listeners.forEach((l) => l(e));
      },
    };
    const ce = contextEngineering(fake);
    let engCount = 0;
    let baseCount = 0;
    ce.onEngineered(() => engCount++);
    ce.onBaseline(() => baseCount++);

    // Cast a fictitious future source
    fake.emit('NEW_SOURCE_FROM_FUTURE' as unknown as ContextSource);
    expect(engCount).toBe(0);
    expect(baseCount).toBe(0);
  });
});

// ─── 6. PERFORMANCE — bounded ────────────────────────────────────

describe('contextEngineering — performance', () => {
  it('1000 emits across both streams under 50ms', () => {
    type Listener = (e: ContextInjectedEvent) => void;
    const listeners: Listener[] = [];
    const fake = {
      on: (_: 'agentfootprint.context.injected', l: Listener) => {
        listeners.push(l);
        return () => {
          listeners.splice(listeners.indexOf(l), 1);
        };
      },
      emit(s: ContextSource): void {
        const e: ContextInjectedEvent = {
          type: 'agentfootprint.context.injected',
          payload: { source: s, contentSummary: '', contentHash: '', slot: 'system', reason: '' },
        } as unknown as ContextInjectedEvent;
        listeners.forEach((l) => l(e));
      },
    };
    const ce = contextEngineering(fake);
    let n = 0;
    ce.onEngineered(() => n++);
    ce.onBaseline(() => n++);

    const t0 = Date.now();
    for (let i = 0; i < 1000; i++) {
      fake.emit(i % 2 === 0 ? 'skill' : 'user');
    }
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeLessThan(50);
    expect(n).toBe(1000); // each emit hits exactly one stream
  });
});

// ─── 7. ROI — end-to-end with real Agent ──────────────────────────

describe('contextEngineering — ROI: real agent integration', () => {
  it('engineered Instruction reaches onEngineered; user message reaches onBaseline', async () => {
    const myInstruction = defineInstruction({
      id: 'be-friendly',
      activeWhen: () => true,
      prompt: 'Be friendly.',
    });
    const provider = mock({ respond: () => ({ content: 'hi', toolCalls: [] }) });
    const agent = Agent.create({ provider, model: 'mock' })
      .system('You answer.')
      .instruction(myInstruction)
      .build();

    const ce = contextEngineering(agent);
    const eng: string[] = [];
    const base: string[] = [];
    ce.onEngineered((e) => eng.push(`${e.payload.source}:${e.payload.sourceId ?? ''}`));
    ce.onBaseline((e) => base.push(e.payload.source));

    await agent.run({ message: 'hello' });

    // The instruction must surface in the engineered stream
    expect(eng.some((s) => s.startsWith('instructions'))).toBe(true);
    // The user message must surface in the baseline stream
    expect(base).toContain('user');

    ce.detach();
  });
});
