/**
 * Tests for src/adapters/memory/ — ConversationStore interface + InMemoryStore.
 *
 * Tiers:
 * - unit:     InMemoryStore CRUD, load/save semantics, isolation between conversations
 * - boundary: empty store, missing id, empty message array, single message
 * - scenario: multi-turn conversation accumulation, clear + restart, size tracking
 * - property: save → load roundtrip identity, stored array is independent copy
 * - security: __proto__ key, very long conversationId, large message payload
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { InMemoryStore } from '../../src/adapters/memory/inMemory';
import type { ConversationStore, MemoryConfig } from '../../src/adapters/memory/types';
import type { Message } from '../../src/types/messages';

// ── Helpers ──────────────────────────────────────────────────

const user = (text: string): Message => ({ role: 'user', content: text });
const assistant = (text: string): Message => ({ role: 'assistant', content: text });

// ── Unit ─────────────────────────────────────────────────────

describe('InMemoryStore — unit', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('load returns empty array for unknown conversationId', () => {
    expect(store.load('unknown')).toEqual([]);
  });

  it('save then load returns same messages', () => {
    const msgs: Message[] = [user('hello'), assistant('hi')];
    store.save('conv-1', msgs);
    expect(store.load('conv-1')).toEqual(msgs);
  });

  it('save replaces existing messages (not appends)', () => {
    store.save('conv-1', [user('first')]);
    store.save('conv-1', [user('second')]);
    expect(store.load('conv-1')).toEqual([user('second')]);
  });

  it('conversations are isolated — save to conv-1 does not affect conv-2', () => {
    store.save('conv-1', [user('a')]);
    store.save('conv-2', [user('b')]);
    expect(store.load('conv-1')).toEqual([user('a')]);
    expect(store.load('conv-2')).toEqual([user('b')]);
  });

  it('size() returns message count', () => {
    store.save('conv-1', [user('a'), assistant('b'), user('c')]);
    expect(store.size('conv-1')).toBe(3);
  });

  it('size() returns 0 for unknown conversationId', () => {
    expect(store.size('unknown')).toBe(0);
  });

  it('ids() returns all stored conversationIds', () => {
    store.save('conv-1', [user('a')]);
    store.save('conv-2', [user('b')]);
    expect(store.ids()).toContain('conv-1');
    expect(store.ids()).toContain('conv-2');
    expect(store.ids()).toHaveLength(2);
  });

  it('delete() removes a specific conversation', () => {
    store.save('conv-1', [user('a')]);
    store.save('conv-2', [user('b')]);
    store.delete('conv-1');
    expect(store.load('conv-1')).toEqual([]);
    expect(store.load('conv-2')).toEqual([user('b')]);
  });

  it('clear() removes all conversations', () => {
    store.save('conv-1', [user('a')]);
    store.save('conv-2', [user('b')]);
    store.clear();
    expect(store.ids()).toHaveLength(0);
    expect(store.load('conv-1')).toEqual([]);
  });
});

// ── Boundary ─────────────────────────────────────────────────

describe('InMemoryStore — boundary', () => {
  let store: InMemoryStore;

  beforeEach(() => {
    store = new InMemoryStore();
  });

  it('save empty array — load returns empty array', () => {
    store.save('conv-1', []);
    expect(store.load('conv-1')).toEqual([]);
  });

  it('save single message — load returns it', () => {
    store.save('conv-1', [user('only message')]);
    expect(store.load('conv-1')).toHaveLength(1);
  });

  it('delete on unknown id is a no-op (no throw)', () => {
    expect(() => store.delete('does-not-exist')).not.toThrow();
  });

  it('clear on empty store is a no-op (no throw)', () => {
    expect(() => store.clear()).not.toThrow();
  });

  it('ids() on empty store returns empty array', () => {
    expect(store.ids()).toEqual([]);
  });

  it('size() on just-cleared id returns 0', () => {
    store.save('conv-1', [user('a'), user('b')]);
    store.delete('conv-1');
    expect(store.size('conv-1')).toBe(0);
  });
});

// ── Scenario ─────────────────────────────────────────────────

describe('InMemoryStore — scenario', () => {
  it('multi-turn conversation accumulates correctly', () => {
    const store = new InMemoryStore();
    const id = 'user-session-abc';

    // Turn 1
    store.save(id, [user('Hi'), assistant('Hello!')]);
    // Turn 2
    store.save(id, [user('Hi'), assistant('Hello!'), user('How are you?'), assistant('Great!')]);

    const history = store.load(id);
    expect(history).toHaveLength(4);
    expect((history[3].content as string)).toBe('Great!');
  });

  it('clear + restart produces fresh conversation', () => {
    const store = new InMemoryStore();
    store.save('conv-1', [user('old message')]);
    store.clear();
    store.save('conv-1', [user('new start')]);

    expect(store.load('conv-1')).toEqual([user('new start')]);
  });

  it('multiple stores are independent (no shared state)', () => {
    const storeA = new InMemoryStore();
    const storeB = new InMemoryStore();
    storeA.save('conv-1', [user('from A')]);
    expect(storeB.load('conv-1')).toEqual([]); // B is unaffected
  });
});

// ── Property ─────────────────────────────────────────────────

describe('InMemoryStore — property', () => {
  it('save → load is identity (deep equal)', () => {
    const store = new InMemoryStore();
    const msgs: Message[] = [
      user('hello'),
      assistant('hi'),
      user('how are you?'),
      { role: 'tool', content: 'result', toolCallId: 'tc-1' },
    ];
    store.save('conv-1', msgs);
    expect(store.load('conv-1')).toEqual(msgs);
  });

  it('stored array is a copy — mutating original does not affect stored', () => {
    const store = new InMemoryStore();
    const msgs: Message[] = [user('original')];
    store.save('conv-1', msgs);
    msgs.push(user('mutated after save'));
    expect(store.load('conv-1')).toHaveLength(1); // stored copy unaffected
  });

  it('loaded array is a copy — mutating loaded does not affect stored', () => {
    const store = new InMemoryStore();
    store.save('conv-1', [user('stored')]);
    const loaded = store.load('conv-1');
    loaded.push(user('mutated after load'));
    expect(store.load('conv-1')).toHaveLength(1); // store unaffected
  });
});

// ── Security ─────────────────────────────────────────────────

describe('InMemoryStore — security', () => {
  it('__proto__ conversationId does not pollute Object prototype', () => {
    const store = new InMemoryStore();
    const msgs: Message[] = [user('test')];
    store.save('__proto__', msgs);
    // Prototype pollution would make ({} as any).__proto__ === msgs
    expect((({}) as any).__proto__).not.toEqual(msgs);
    // But load/size still work correctly
    expect(store.load('__proto__')).toEqual(msgs);
  });

  it('constructor conversationId is handled safely', () => {
    const store = new InMemoryStore();
    expect(() => store.save('constructor', [user('test')])).not.toThrow();
    expect(store.load('constructor')).toEqual([user('test')]);
  });

  it('very long conversationId is stored correctly', () => {
    const store = new InMemoryStore();
    const longId = 'x'.repeat(10_000);
    store.save(longId, [user('test')]);
    expect(store.load(longId)).toHaveLength(1);
  });

  it('large message payload is stored and retrieved correctly', () => {
    const store = new InMemoryStore();
    const largeContent = 'word '.repeat(10_000);
    store.save('conv-1', [user(largeContent)]);
    const loaded = store.load('conv-1');
    expect((loaded[0].content as string)).toHaveLength(largeContent.length);
  });

  it('ConversationStore is structurally typed — any compliant object works', () => {
    // Verify the interface contract works with a custom implementation
    const customStore: ConversationStore = {
      load: (_id: string) => [user('from custom store')],
      save: (_id: string, _msgs: Message[]) => {},
    };
    const loaded = customStore.load('any-id');
    expect(loaded).toHaveLength(1);
  });

  it('MemoryConfig type is correctly shaped', () => {
    const store = new InMemoryStore();
    const config: MemoryConfig = {
      store,
      conversationId: 'conv-123',
    };
    expect(config.conversationId).toBe('conv-123');
    expect(config.store).toBe(store);
    expect(config.strategy).toBeUndefined();
  });
});
