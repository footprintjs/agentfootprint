/**
 * The `asRole` refusal (7.20.0).
 *
 * Before this, `defineMemory({ asRole })` and `defineRAG({ asRole })`
 * accepted a role, stored it on the returned definition, and nothing ever
 * read it: every formatter this library ships writes `role: 'system'`, so
 * recall has always been injected as system whatever the option said.
 * `defineRAG` even defaulted it to `'user'` and documented why — a reader
 * could pick a role, read it back off the definition, and be told a role
 * the run would never use.
 *
 * What is pinned here is BOTH halves: the refusal fires wherever the
 * option can be declared, and it fires NOWHERE else (every other option,
 * and the behaviour those declarations already had, is untouched).
 *
 * Test types (Convention 3): unit (the sentence) / functional (each
 * factory) / regression (the accepted-then-ignored declaration, including
 * the `'system'` value that "worked" by coincidence) / integration (a real
 * agent run, unchanged by the removal).
 */

import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/adapters/llm/MockProvider.js';
import { defineMemory, MEMORY_TYPES, MEMORY_STRATEGIES } from '../../src/memory/index.js';
import { defineRAG } from '../../src/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { mockEmbedder } from '../../src/memory/embedding/index.js';
import { asRoleRefusal } from '../../src/memory/asRoleRefusal.js';

describe('asRoleRefusal — the sentence', () => {
  it('names the site, the truth, and why the refusal still stands', () => {
    const text = asRoleRefusal("defineRAG('product-docs')");
    expect(text).toContain("defineRAG('product-docs')");
    expect(text).toContain('has never been read');
    expect(text).toContain("role: 'system'");
    expect(text).toContain('does not change');
  });

  it('stopped blaming a limitation that no longer exists (7.21.0)', () => {
    // 7.20.0 refused this because the messages slot could not deliver at all.
    // 7.21.0 delivers, so that reason expired — and a refusal resting on a
    // retired fact is the same class of stale claim the refusal was written to
    // remove. The sentence now says the true reason: the machinery exists and
    // no field evidence asks for the feature.
    const text = asRoleRefusal("defineMemory('chat')");
    expect(text).not.toContain('which does not reach the model');
    expect(text).toContain('no field evidence');
    expect(text).toContain('a decision, not a limitation');
  });
});

describe('asRole declarations are refused', () => {
  it('defineMemory refuses it by name', () => {
    expect(() =>
      defineMemory({
        id: 'chat',
        type: MEMORY_TYPES.EPISODIC,
        strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
        store: new InMemoryStore(),
        asRole: 'user',
      } as never),
    ).toThrow(/defineMemory\('chat'\): `asRole` has never been read/);
  });

  it('defineRAG refuses it by name, before it reaches defineMemory', () => {
    expect(() =>
      defineRAG({
        id: 'product-docs',
        store: new InMemoryStore(),
        embedder: mockEmbedder(),
        asRole: 'user',
      } as never),
    ).toThrow(/defineRAG\('product-docs'\): `asRole` has never been read/);
  });

  it('refuses on PRESENCE, not value — `asRole: "system"` was just as unread', () => {
    // This is the declaration that looked like it worked: it named the role
    // the run happens to use. Letting it through would teach that the
    // option is honoured, which is the thing being fixed.
    expect(() =>
      defineMemory({
        id: 'reference',
        type: MEMORY_TYPES.SEMANTIC,
        strategy: { kind: MEMORY_STRATEGIES.TOP_K, topK: 3, embedder: mockEmbedder() },
        store: new InMemoryStore({ embedder: mockEmbedder() }),
        asRole: 'system',
      } as never),
    ).toThrow(/`asRole` has never been read/);
  });

  it('an explicit `undefined` is still a declaration, and is still refused', () => {
    expect(() =>
      defineRAG({
        id: 'docs',
        store: new InMemoryStore(),
        embedder: mockEmbedder(),
        asRole: undefined,
      } as never),
    ).toThrow(/`asRole` has never been read/);
  });
});

describe('nothing else changes', () => {
  it('the same declarations without the option build and run unchanged', async () => {
    const memory = defineMemory({
      id: 'chat',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
    });
    expect(Object.isFrozen(memory)).toBe(true);
    expect('asRole' in memory).toBe(false);

    const docs = defineRAG({
      id: 'docs',
      store: new InMemoryStore(),
      embedder: mockEmbedder(),
    });
    expect('asRole' in docs).toBe(false);

    const agent = Agent.create({ provider: mock({ reply: 'ok' }), model: 'mock', maxIterations: 1 })
      .memory(memory)
      .rag(docs)
      .build();

    expect(await agent.run({ message: 'hi', identity: { conversationId: 'c1' } })).toBe('ok');
  });
});
