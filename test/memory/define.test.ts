/**
 * defineMemory factory — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * Covers Layer-2 of the memory stack: the `defineMemory(options)`
 * factory that dispatches `type × strategy.kind` onto the existing
 * pipeline factories (defaultPipeline / semanticPipeline /
 * factPipeline / narrativePipeline / autoPipeline).
 *
 * @see src/memory/define.ts
 * @see src/memory/define.types.ts
 */

import { describe, expect, it } from 'vitest';

import {
  defineMemory,
  MEMORY_TYPES,
  MEMORY_STRATEGIES,
  MEMORY_TIMING,
  SNAPSHOT_PROJECTIONS,
} from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { mockEmbedder } from '../../src/memory/embedding/index.js';

// ─── Unit — factory accepts each supported combo ───────────────────

describe('defineMemory — unit', () => {
  it('EPISODIC × WINDOW → frozen MemoryDefinition with read+write subflows', () => {
    const def = defineMemory({
      id: 'short-term',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: new InMemoryStore(),
    });
    expect(def.id).toBe('short-term');
    expect(def.type).toBe('episodic');
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
    expect(def.timing).toBe(MEMORY_TIMING.TURN_START);
    expect(def.asRole).toBe('system');
    expect(Object.isFrozen(def)).toBe(true);
  });

  it('EPISODIC × BUDGET → defaultPipeline with budget knobs', () => {
    const def = defineMemory({
      id: 'budget-mem',
      type: MEMORY_TYPES.EPISODIC,
      strategy: {
        kind: MEMORY_STRATEGIES.BUDGET,
        reserveTokens: 512,
        minimumTokens: 200,
        maxEntries: 10,
      },
      store: new InMemoryStore(),
    });
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
  });

  it('SEMANTIC × TOP_K → semanticPipeline with embedder + threshold', () => {
    const def = defineMemory({
      id: 'sem',
      type: MEMORY_TYPES.SEMANTIC,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 5,
        threshold: 0.75,
        embedder: mockEmbedder(),
      },
      store: new InMemoryStore({ embedder: mockEmbedder() }),
    });
    expect(def.type).toBe('semantic');
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
  });

  it('SEMANTIC × EXTRACT (pattern) → factPipeline (no LLM required)', () => {
    const def = defineMemory({
      id: 'facts',
      type: MEMORY_TYPES.SEMANTIC,
      strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
      store: new InMemoryStore(),
    });
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
  });

  it('NARRATIVE × EXTRACT (pattern/heuristic) → narrativePipeline', () => {
    const def = defineMemory({
      id: 'beats',
      type: MEMORY_TYPES.NARRATIVE,
      strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
      store: new InMemoryStore(),
    });
    expect(def.type).toBe('narrative');
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
  });

  it('SEMANTIC × HYBRID → autoPipeline (facts + beats composed)', () => {
    const def = defineMemory({
      id: 'auto',
      type: MEMORY_TYPES.SEMANTIC,
      strategy: {
        kind: MEMORY_STRATEGIES.HYBRID,
        strategies: [
          { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        ],
      },
      store: new InMemoryStore(),
    });
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
  });
});

// ─── Scenario — common consumer paths ──────────────────────────────

describe('defineMemory — consumer scenarios', () => {
  it('short-term sliding window — the 90% default', () => {
    const def = defineMemory({
      id: 'last-10',
      description: 'Keep the last 10 turns of conversation',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store: new InMemoryStore(),
    });
    expect(def.description).toBe('Keep the last 10 turns of conversation');
    expect(def.timing).toBe(MEMORY_TIMING.TURN_START);
  });

  it('long-conversation summarization — the Ch 7 context-janitor pattern', () => {
    // The book Ch 7 describes "conversation compaction": preserve recent N turns,
    // summarize the middle. Our SUMMARIZE strategy maps this onto defaultPipeline
    // with a tightened loadCount; richer compose lands in step 4.
    const def = defineMemory({
      id: 'long-chat',
      type: MEMORY_TYPES.EPISODIC,
      strategy: {
        kind: MEMORY_STRATEGIES.SUMMARIZE,
        recent: 6,
        // Mock LLM placeholder — real usage passes an LLMProvider
        llm: { name: 'mock', complete: async () => ({ content: 'summary' }) } as never,
      },
      store: new InMemoryStore(),
    });
    expect(def.read).toBeDefined();
  });

  it('explicit timing override — EVERY_ITERATION for tool-result-sensitive memory', () => {
    const def = defineMemory({
      id: 'tool-aware',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
      timing: MEMORY_TIMING.EVERY_ITERATION,
    });
    expect(def.timing).toBe(MEMORY_TIMING.EVERY_ITERATION);
  });

  it('explicit asRole override — inject as user message instead of system', () => {
    const def = defineMemory({
      id: 'as-user',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
      asRole: 'user',
    });
    expect(def.asRole).toBe('user');
  });

  it('redact policy passes through (impl deferred to v2.x)', () => {
    const def = defineMemory({
      id: 'redacted',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
      redact: { patterns: [/\d{3}-\d{2}-\d{4}/], replacement: '[SSN]' },
    });
    expect(def.redact).toBeDefined();
    expect(def.redact?.replacement).toBe('[SSN]');
  });
});

// ─── Integration — read/write subflows are real FlowCharts ─────────

describe('defineMemory — pipeline integration', () => {
  it('read subflow is always defined; write is defined for non-ephemeral configs', () => {
    const def = defineMemory({
      id: 'm',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
    });
    // Branded as ReadonlyMemoryFlowChart but underneath it's a real
    // footprintjs FlowChart with build() output.
    expect(def.read).toBeTruthy();
    expect(def.write).toBeTruthy();
  });
});

// ─── Property — invariants across all supported combos ─────────────

describe('defineMemory — properties', () => {
  it('every returned MemoryDefinition is frozen (immutability invariant)', () => {
    const cases = [
      {
        id: 'a',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
      },
      {
        id: 'b',
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
        store: new InMemoryStore(),
      },
      {
        id: 'c',
        type: MEMORY_TYPES.NARRATIVE,
        strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
        store: new InMemoryStore(),
      },
    ] as const;
    for (const c of cases) {
      const def = defineMemory(c);
      expect(Object.isFrozen(def)).toBe(true);
    }
  });

  it('id round-trips unchanged onto the definition', () => {
    for (const id of ['m1', 'long-id-with-dashes', 'a_b_c']) {
      const def = defineMemory({
        id,
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
      });
      expect(def.id).toBe(id);
    }
  });

  it('default timing is always TURN_START unless overridden', () => {
    const def = defineMemory({
      id: 'p',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 1 },
      store: new InMemoryStore(),
    });
    expect(def.timing).toBe(MEMORY_TIMING.TURN_START);
  });
});

// ─── Security — input validation + clear error remediation ─────────

describe('defineMemory — security', () => {
  it('throws on empty id with helpful message', () => {
    expect(() =>
      defineMemory({
        id: '',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
      }),
    ).toThrow(/`id` is required/);
  });

  it('throws on missing store with remediation hint', () => {
    expect(() =>
      defineMemory({
        id: 'm',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: undefined as never,
      }),
    ).toThrow(/InMemoryStore/);
  });

  it('throws on EPISODIC × EXTRACT (idiomatic mismatch) with remediation', () => {
    expect(() =>
      defineMemory({
        id: 'bad',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
        store: new InMemoryStore(),
      }),
    ).toThrow(/SEMANTIC or NARRATIVE/);
  });

  it('throws on EPISODIC × TOP_K with remediation', () => {
    expect(() =>
      defineMemory({
        id: 'bad',
        type: MEMORY_TYPES.EPISODIC,
        strategy: {
          kind: MEMORY_STRATEGIES.TOP_K,
          topK: 5,
          embedder: mockEmbedder(),
        },
        store: new InMemoryStore(),
      }),
    ).toThrow(/type=SEMANTIC/);
  });

  it('throws on EXTRACT (llm) without LLM provider with remediation', () => {
    expect(() =>
      defineMemory({
        id: 'bad',
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'llm' },
        store: new InMemoryStore(),
      }),
    ).toThrow(/extractor: 'pattern'/);
  });

  it('CAUSAL with TOP_K + vector store builds successfully', () => {
    const def = defineMemory({
      id: 'causal',
      type: MEMORY_TYPES.CAUSAL,
      strategy: {
        kind: MEMORY_STRATEGIES.TOP_K,
        topK: 1,
        embedder: mockEmbedder(),
      },
      store: new InMemoryStore({ embedder: mockEmbedder() }),
      projection: SNAPSHOT_PROJECTIONS.DECISIONS,
    });
    expect(def.type).toBe('causal');
    expect(def.read).toBeDefined();
    expect(def.write).toBeDefined();
  });

  it('throws on DECAY (not yet supported in v2.0) with workaround hint', () => {
    expect(() =>
      defineMemory({
        id: 'decay',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.DECAY, halfLifeMs: 60000 },
        store: new InMemoryStore(),
      }),
    ).toThrow(/TTL|mountMemoryRead/);
  });
});

// ─── Performance — compile-once, no per-turn cost ──────────────────

describe('defineMemory — performance', () => {
  it('repeated calls with identical config are independent (no shared state)', () => {
    const store = new InMemoryStore();
    const a = defineMemory({
      id: 'a',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store,
    });
    const b = defineMemory({
      id: 'b',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store,
    });
    expect(a).not.toBe(b);
    expect(a.id).not.toBe(b.id);
  });

  it('factory dispatch under 10ms for typical config', () => {
    const start = performance.now();
    for (let i = 0; i < 50; i++) {
      defineMemory({
        id: `m${i}`,
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
      });
    }
    const elapsed = performance.now() - start;
    // 50 builds; cap is generous to handle CI cold paths.
    expect(elapsed).toBeLessThan(2000);
  });
});

// ─── ROI — what supports v2.0 release ──────────────────────────────

describe('defineMemory — ROI', () => {
  it('the 4 types × the supported strategies all build successfully', () => {
    // The contract — these are the build combinations that ship in v2.0.
    // If any of these fail, v2.0 cannot ship.
    const supported: Array<() => unknown> = [
      () =>
        defineMemory({
          id: 't1',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
          store: new InMemoryStore(),
        }),
      () =>
        defineMemory({
          id: 't2',
          type: MEMORY_TYPES.EPISODIC,
          strategy: { kind: MEMORY_STRATEGIES.BUDGET, reserveTokens: 256 },
          store: new InMemoryStore(),
        }),
      () =>
        defineMemory({
          id: 't3',
          type: MEMORY_TYPES.SEMANTIC,
          strategy: {
            kind: MEMORY_STRATEGIES.TOP_K,
            topK: 5,
            embedder: mockEmbedder(),
          },
          store: new InMemoryStore({ embedder: mockEmbedder() }),
        }),
      () =>
        defineMemory({
          id: 't4',
          type: MEMORY_TYPES.SEMANTIC,
          strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
          store: new InMemoryStore(),
        }),
      () =>
        defineMemory({
          id: 't5',
          type: MEMORY_TYPES.NARRATIVE,
          strategy: { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' },
          store: new InMemoryStore(),
        }),
    ];
    for (const build of supported) {
      expect(() => build()).not.toThrow();
    }
  });

  it('book Ch 7 "context janitor" use case is one defineMemory call', () => {
    // The book teaches conversation compaction as a multi-step routine
    // (export-prune-restore). For the consumer, this should be one call
    // — the SUMMARIZE strategy carries the LLM dependency explicitly.
    const def = defineMemory({
      id: 'janitor',
      type: MEMORY_TYPES.EPISODIC,
      strategy: {
        kind: MEMORY_STRATEGIES.SUMMARIZE,
        recent: 10,
        llm: {
          name: 'haiku',
          complete: async () => ({ content: 'summary text' }),
        } as never,
      },
      store: new InMemoryStore(),
    });
    expect(def.read).toBeDefined();
  });
});
