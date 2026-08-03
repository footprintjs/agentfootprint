/**
 * Compile-level regression test — 7.20.0 removed `asRole` from
 * `defineMemory` and `defineRAG`.
 *
 * The runtime throw (see `test/memory/asRoleRefusal.test.ts`) catches
 * JavaScript callers and casts. This file pins the half that only the
 * compiler can enforce, and that is the half consumers actually meet: the
 * declaration is reported at the keystroke, before anything runs.
 *
 * Lives under ./tsconfig.json (`npm run test:types`) while its name still
 * matches `test/**\/*.test.ts`, so `npm test` runs the assertions too.
 */
import { describe, expect, it } from 'vitest';
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } from '../../src/memory/index';
import { defineRAG } from '../../src/index';
import { InMemoryStore } from '../../src/memory/store/index';
import { mockEmbedder } from '../../src/memory/embedding/index';
import type { DefineMemoryOptions, MemoryDefinition } from '../../src/memory/index';
import type { DefineRAGOptions } from '../../src/index';

describe('asRole no longer type-checks (7.20.0)', () => {
  // The `@ts-expect-error` is the assertion these two make: it fails to
  // compile if the option ever type-checks again. The `toThrow` keeps them
  // honest under `npm test`, where this file also runs as a normal suite.
  it('defineMemory rejects it at the declaration', () => {
    expect(() =>
      defineMemory({
        id: 'chat',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
        // @ts-expect-error — `asRole` was never read; removed in 7.20.0.
        asRole: 'user',
      }),
    ).toThrow(/`asRole` has never been read/);
  });

  it('defineRAG rejects it at the declaration', () => {
    expect(() =>
      defineRAG({
        id: 'docs',
        store: new InMemoryStore(),
        embedder: mockEmbedder(),
        // @ts-expect-error — `asRole` was never read; removed in 7.20.0.
        asRole: 'system',
      }),
    ).toThrow(/`asRole` has never been read/);
  });

  it('the option types no longer carry the key, and neither does the definition', () => {
    // `Extract<keyof T, 'asRole'>` is `never` when the key is gone. Written
    // as a type-level assertion so removing the key from ONE of the three
    // and not the others fails to compile.
    const noKey = <T>(_present: Extract<keyof T, 'asRole'> extends never ? true : false): void =>
      void _present;
    noKey<DefineMemoryOptions>(true);
    noKey<DefineRAGOptions>(true);
    noKey<MemoryDefinition>(true);
    expect(true).toBe(true);
  });

  it('every other option still compiles unchanged', () => {
    const opts: DefineRAGOptions = {
      id: 'docs',
      description: 'product docs',
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
      embedderId: 'mock-1',
      topK: 5,
      threshold: 0.6,
    };
    expect(defineRAG(opts).type).toBe('semantic');
  });
});
