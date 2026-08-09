/**
 * listMemoryStrategies + the declared-requirements guard — 7-pattern tests
 * (unit · scenario · integration · property · security · performance · ROI).
 *
 * The point of the surface is that a host can know what it can run BEFORE
 * it offers the choice. So the load-bearing tests here are the property
 * ones: every pair the table declares supported really builds, and every
 * requirement it declares is really enforced. A descriptor nobody checks
 * against the factory is just a second place to be wrong.
 *
 * @see src/memory/strategies.ts
 * @see src/memory/define.ts
 */
import { describe, expect, it } from 'vitest';

import {
  defineMemory,
  listMemoryStrategies,
  memoryStrategyInfo,
  MEMORY_STRATEGIES,
  MEMORY_TYPES,
  type MemoryStrategyInfo,
  type MemoryType,
  type Strategy,
} from '../../src/memory/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { mockEmbedder } from '../../src/memory/embedding/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import type { MemoryStore } from '../../src/memory/store/index.js';

/** A store with every requirement met: it can `search()` the vectors it is given. */
const vectorStore = (): MemoryStore => new InMemoryStore({ embedder: mockEmbedder() });

/** A full memory store that implements no `search()` — the RedisStore shape. */
function storeWithoutSearch(): MemoryStore {
  const inner = new InMemoryStore();
  const { search: _dropped, ...rest } = inner as unknown as Record<string, unknown>;
  void _dropped;
  const bound: Record<string, unknown> = {};
  for (const key of Object.keys(rest)) bound[key] = rest[key];
  // Methods live on the prototype; rebind everything except `search`.
  const proto = Object.getPrototypeOf(inner) as object;
  for (const key of Object.getOwnPropertyNames(proto)) {
    if (key === 'constructor' || key === 'search') continue;
    const value = (inner as unknown as Record<string, unknown>)[key];
    if (typeof value === 'function')
      bound[key] = (value as (...a: unknown[]) => unknown).bind(inner);
  }
  return bound as unknown as MemoryStore;
}

/** A well-formed strategy value of each kind, with every requirement supplied. */
function satisfiedStrategy(kind: string): Strategy {
  switch (kind) {
    case MEMORY_STRATEGIES.WINDOW:
      return { kind: MEMORY_STRATEGIES.WINDOW, size: 5 };
    case MEMORY_STRATEGIES.BUDGET:
      return { kind: MEMORY_STRATEGIES.BUDGET, reserveTokens: 256 };
    case MEMORY_STRATEGIES.SUMMARIZE:
      return { kind: MEMORY_STRATEGIES.SUMMARIZE, recent: 5, llm: mock({ reply: 'summary' }) };
    case MEMORY_STRATEGIES.TOP_K:
      return { kind: MEMORY_STRATEGIES.TOP_K, topK: 3, embedder: mockEmbedder() };
    case MEMORY_STRATEGIES.EXTRACT:
      return { kind: MEMORY_STRATEGIES.EXTRACT, extractor: 'pattern' };
    case MEMORY_STRATEGIES.DECAY:
      return { kind: MEMORY_STRATEGIES.DECAY, halfLifeMs: 86_400_000 };
    case MEMORY_STRATEGIES.HYBRID:
      return {
        kind: MEMORY_STRATEGIES.HYBRID,
        strategies: [{ kind: MEMORY_STRATEGIES.WINDOW, size: 5 }],
      };
    default:
      throw new Error(`test fixture missing for strategy ${kind}`);
  }
}

function build(info: MemoryStrategyInfo, type: MemoryType, strategy?: Strategy): unknown {
  return defineMemory({
    id: `${info.kind}-${type}`,
    type,
    strategy: strategy ?? satisfiedStrategy(info.kind),
    store: vectorStore(),
  } as never);
}

// ─── Unit ───────────────────────────────────────────────────────────

describe('listMemoryStrategies — unit', () => {
  it('lists all seven, frozen, each with a description and a requirements array', () => {
    const list = listMemoryStrategies();
    expect(list).toHaveLength(7);
    expect(Object.isFrozen(list)).toBe(true);
    for (const s of list) {
      expect(Object.isFrozen(s)).toBe(true);
      expect(s.description.length).toBeGreaterThan(0);
      expect(Array.isArray(s.requirements)).toBe(true);
      expect(s.types.length).toBeGreaterThan(0);
    }
  });

  it('the kinds are exactly the values of MEMORY_STRATEGIES — no drift either way', () => {
    const described = listMemoryStrategies()
      .map((s) => s.kind)
      .sort();
    const declared = Object.values(MEMORY_STRATEGIES).sort();
    expect(described).toEqual(declared);
  });

  it('memoryStrategyInfo finds a kind and returns undefined for a non-strategy', () => {
    expect(memoryStrategyInfo(MEMORY_STRATEGIES.DECAY)?.kind).toBe('decay');
    expect(memoryStrategyInfo('telepathy')).toBeUndefined();
  });

  it('pins the requirement of each strategy', () => {
    const req = (kind: string) => memoryStrategyInfo(kind)?.requirements;
    expect(req(MEMORY_STRATEGIES.WINDOW)).toEqual([]);
    expect(req(MEMORY_STRATEGIES.BUDGET)).toEqual([]);
    expect(req(MEMORY_STRATEGIES.SUMMARIZE)).toEqual(['llm']);
    expect(req(MEMORY_STRATEGIES.TOP_K)).toEqual(['embedder', 'vector-store']);
    expect(req(MEMORY_STRATEGIES.EXTRACT)).toEqual([]);
    expect(req(MEMORY_STRATEGIES.DECAY)).toEqual([]);
    expect(req(MEMORY_STRATEGIES.HYBRID)).toEqual([]);
  });
});

// ─── Scenario — the host UI this exists for ─────────────────────────

describe('listMemoryStrategies — consumer scenarios', () => {
  it('a deployment with no embedder can offer four episodic strategies without guessing', () => {
    const canSupply = new Set<string>(); // no embedder, no vector store, no LLM
    const offerable = listMemoryStrategies()
      .filter((s) => s.types.includes(MEMORY_TYPES.EPISODIC))
      .filter((s) => s.requirements.every((r) => canSupply.has(r)))
      .map((s) => s.kind);
    expect(offerable).toEqual(['window', 'budget', 'decay', 'hybrid']);
  });

  it('adding an embedder + a vector store unlocks topK for semantic recall', () => {
    const canSupply = new Set(['embedder', 'vector-store']);
    const offerable = listMemoryStrategies()
      .filter((s) => s.types.includes(MEMORY_TYPES.SEMANTIC))
      .filter((s) => s.requirements.every((r) => canSupply.has(r)))
      .map((s) => s.kind);
    expect(offerable).toContain('topK');
  });

  it('the descriptions say what a picker needs to say — including the summarize caveat', () => {
    const summarize = memoryStrategyInfo(MEMORY_STRATEGIES.SUMMARIZE);
    // The compression stage is not composed into the pipeline defineMemory
    // builds. A picker that offered this as working compaction would lie.
    expect(summarize?.description).toMatch(/not (yet )?(composed|called|wired)/i);
    expect(summarize?.description).toMatch(/compaction/);
  });
});

// ─── Integration — descriptor vs. the factory it describes ──────────

describe('declared strategies vs defineMemory — integration', () => {
  it('every declared (strategy × type) pair actually builds', () => {
    for (const info of listMemoryStrategies()) {
      for (const type of info.types) {
        expect(() => build(info, type), `${info.kind} × ${type}`).not.toThrow();
      }
    }
  });

  it('every UNdeclared pair is refused — the table is not optimistic', () => {
    const allTypes = Object.values(MEMORY_TYPES);
    for (const info of listMemoryStrategies()) {
      for (const type of allTypes) {
        if (info.types.includes(type)) continue;
        expect(() => build(info, type), `${info.kind} × ${type}`).toThrow();
      }
    }
  });
});

// ─── Property — the declaration is enforced, not decorative ─────────

describe('declared requirements — properties', () => {
  it('summarize without its `llm` is refused at BUILD, by name', () => {
    expect(() =>
      defineMemory({
        id: 'no-llm',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.SUMMARIZE, recent: 5 } as never,
        store: new InMemoryStore(),
      }),
    ).toThrow(/`summarize` strategy names an `llm`/);
  });

  it('topK without its `embedder` is refused at BUILD, on both types that accept it', () => {
    for (const type of [MEMORY_TYPES.SEMANTIC, MEMORY_TYPES.CAUSAL]) {
      expect(() =>
        defineMemory({
          id: `no-embedder-${type}`,
          type,
          strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 3 } as never,
          store: vectorStore(),
        } as never),
      ).toThrow(/embedder/);
    }
  });

  it('topK without a store that can `search()` is refused at BUILD, never at turn 1', () => {
    expect(() =>
      defineMemory({
        id: 'no-search',
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 3, embedder: mockEmbedder() },
        store: storeWithoutSearch(),
      }),
    ).toThrow(/search\(\)/);
  });

  it('a hybrid cannot smuggle in a sub-strategy this deployment cannot run', () => {
    // Before 9.5.0 this built happily: the composed pipeline ignored the
    // sub-strategy list, so the missing embedder was never noticed.
    expect(() =>
      defineMemory({
        id: 'smuggler',
        type: MEMORY_TYPES.SEMANTIC,
        strategy: {
          kind: MEMORY_STRATEGIES.HYBRID,
          strategies: [{ kind: MEMORY_STRATEGIES.TOP_K, topK: 3 } as never],
        },
        store: vectorStore(),
      }),
    ).toThrow(/inside `hybrid`.*embedder/s);
  });

  it('a strategy whose requirements are empty builds against a bare store', () => {
    for (const info of listMemoryStrategies()) {
      if (info.requirements.length > 0) continue;
      for (const type of info.types) {
        expect(() =>
          defineMemory({
            id: `bare-${info.kind}-${type}`,
            type,
            strategy: satisfiedStrategy(info.kind),
            store: new InMemoryStore(),
          } as never),
        ).not.toThrow();
      }
    }
  });
});

// ─── Security — the refusals teach ──────────────────────────────────

describe('requirement refusals — security', () => {
  it('names the call site, the missing thing, and a fix that needs nothing', () => {
    let message = '';
    try {
      defineMemory({
        id: 'chat-memory',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.SUMMARIZE, recent: 5 } as never,
        store: new InMemoryStore(),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toContain('defineMemory[chat-memory]');
    expect(message).toContain('listMemoryStrategies()');
    expect(message).toContain("kind: 'window'");
  });

  it('the vector-store refusal names stores that would work', () => {
    let message = '';
    try {
      defineMemory({
        id: 'corpus',
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 3, embedder: mockEmbedder() },
        store: storeWithoutSearch(),
      });
    } catch (error) {
      message = (error as Error).message;
    }
    expect(message).toMatch(/InMemoryStore|sqliteVectorStore|pgVectorStore/);
  });
});

// ─── Performance ────────────────────────────────────────────────────

describe('listMemoryStrategies — performance', () => {
  it('is a frozen singleton — enumerating it allocates nothing', () => {
    expect(listMemoryStrategies()).toBe(listMemoryStrategies());
  });
});

// ─── ROI ────────────────────────────────────────────────────────────

describe('listMemoryStrategies — ROI', () => {
  it('no strategy is advertised that defineMemory cannot build on some type', () => {
    // This is the whole point: the const used to offer seven and build six.
    for (const info of listMemoryStrategies()) {
      const buildable = info.types.some((type) => {
        try {
          build(info, type);
          return true;
        } catch {
          return false;
        }
      });
      expect(buildable, `${info.kind} builds on no type at all`).toBe(true);
    }
  });
});
