/**
 * The memory `redact` refusal.
 *
 * `defineMemory({ redact })` took a `MemoryRedactionPolicy` "reserved for a
 * future release", stored it on the definition, and no store ever scrubbed
 * anything because of it. It is now refused by name — for JavaScript callers
 * and casts here; TypeScript reports it at the keystroke
 * (`test/type-regressions/MemoryRedact.assignability.test.ts`).
 *
 * Pinned, both halves:
 *   - the refusal fires wherever the option can be declared (`defineMemory`,
 *     `defineRAG`), on presence, not value — an empty `{}` too;
 *   - and the reason it is refused rather than built holds at runtime: a
 *     memory is working state, so under an agent's `redact` the STORE still
 *     holds the real conversation while the RECORD of the memory stages is
 *     served.
 */
import { describe, expect, it } from 'vitest';

import { Agent } from '../../src/index.js';
import { mock } from '../../src/doors/providers.js';
import { defineMemory, MEMORY_STRATEGIES, MEMORY_TYPES } from '../../src/memory/index.js';
import { defineRAG } from '../../src/index.js';
import { InMemoryStore } from '../../src/memory/store/index.js';
import { mockEmbedder } from '../../src/memory/embedding/index.js';
import { memoryRedactRefusal } from '../../src/memory/redactRefusal.js';
import type { AgentfootprintEvent } from '../../src/events/registry.js';
import { conversationRedaction } from '../../src/doors/security.js';

const SECRET = 'SECRET-REMEMBERED-6620';

describe('memoryRedactRefusal — the sentence', () => {
  it('names the site, says it never worked, and points at what does the job', () => {
    const text = memoryRedactRefusal("defineMemory('chat')");
    expect(text).toContain("defineMemory('chat')");
    expect(text).toContain('not implemented');
    expect(text).toContain('working state');
    expect(text).toContain('Agent.create({ redact })');
    expect(text).toContain('readOnly: true');
  });
});

describe('the refusal fires wherever `redact` can be declared', () => {
  const memory = (redact: unknown) => () =>
    defineMemory({
      id: 'chat',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
      redact,
    } as never);

  it('defineMemory — the old reserved shape, and an empty one (presence, not value)', () => {
    expect(memory({ patterns: [/\d{3}-\d{2}-\d{4}/], replacement: '[SSN]' })).toThrow(
      /defineMemory\('chat'\): `redact` is not implemented/,
    );
    expect(memory({})).toThrow(/`redact` is not implemented/);
    expect(memory(undefined)).toThrow(/`redact` is not implemented/);
  });

  it('defineRAG — never had it; a copied option is refused, not ignored', () => {
    expect(() =>
      defineRAG({
        id: 'docs',
        store: new InMemoryStore(),
        embedder: mockEmbedder(),
        redact: { patterns: [/x/] },
      } as never),
    ).toThrow(/defineRAG\('docs'\): `redact` is not implemented/);
  });

  it('every other option still builds, and the definition carries no `redact`', () => {
    const def = defineMemory({
      id: 'chat',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 5 },
      store: new InMemoryStore(),
    });
    expect('redact' in def).toBe(false);
  });
});

describe('why it is refused: a memory is working state, the record is not', () => {
  it('under the agent’s `redact`, the store keeps the real turn; the memory record is served', async () => {
    const store = new InMemoryStore();
    const memory = defineMemory({
      id: 'chat',
      type: MEMORY_TYPES.EPISODIC,
      strategy: { kind: MEMORY_STRATEGIES.WINDOW, size: 10 },
      store,
    });
    const agent = Agent.create({
      provider: mock({ reply: 'noted' }),
      model: 'm',
      // The library's vocabulary of where the conversation lives (`src/redaction/`).
      redact: conversationRedaction(),
    })
      .memory(memory)
      .build();
    const events: AgentfootprintEvent[] = [];
    agent.on('*', (e) => events.push(e));
    await agent.run({ message: `remember ${SECRET}` }, { identity: { conversationId: 'c-1' } });

    // The STORE: what a later run recalls — the real words.
    const stored = await store.list({ conversationId: 'c-1' });
    expect(JSON.stringify(stored)).toContain(SECRET);
    // The RECORD of the same run: events and the served snapshot.
    expect(JSON.stringify(events)).not.toContain(SECRET);
    expect(JSON.stringify(agent.getLastSnapshot())).not.toContain(SECRET);
  });
});
