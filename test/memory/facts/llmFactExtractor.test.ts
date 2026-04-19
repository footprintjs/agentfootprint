/**
 * llmFactExtractor — 5-pattern tests.
 *
 * Uses a scripted mock LLMProvider to verify parsing, confidence
 * clamping, key dedup, existing-facts prompt injection, and
 * parse-error isolation.
 *
 * Tiers:
 *   - unit:     well-formed JSON → facts with correct shape
 *   - boundary: missing fields, empty arrays, missing value, empty response
 *   - scenario: multi-fact + existing-fact injection + dedup on same key
 *   - property: confidence always clamped to [0, 1]
 *   - security: malformed JSON / non-object facts / thrown provider / abort signal
 */
import { describe, expect, it, vi } from 'vitest';
import { llmFactExtractor } from '../../../src/memory/facts';
import type { Fact } from '../../../src/memory/facts';
import type { LLMProvider, LLMResponse, Message } from '../../../src/types';

function makeProvider(response: LLMResponse): LLMProvider {
  return { chat: vi.fn(async () => response) };
}

const user = (content: string): Message => ({ role: 'user', content });

function findKey(facts: readonly Fact[], key: string): Fact | undefined {
  return facts.find((f) => f.key === key);
}

// ── Unit ────────────────────────────────────────────────────

describe('llmFactExtractor — unit', () => {
  it('parses a well-formed facts response', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          {
            key: 'user.name',
            value: 'Alice',
            confidence: 0.95,
            category: 'identity',
            refs: ['msg-1-0'],
          },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('my name is Alice')],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('user.name');
    expect(facts[0].value).toBe('Alice');
    expect(facts[0].confidence).toBe(0.95);
    expect(facts[0].category).toBe('identity');
    expect(facts[0].refs).toEqual(['msg-1-0']);
  });

  it('passes system prompt + formatted user content to provider', async () => {
    const provider = makeProvider({ content: '{"facts": []}' });
    await llmFactExtractor({ provider }).extract({
      messages: [user('hi')],
      turnNumber: 7,
    });
    const call = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = call[0] as Message[];
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Turn 7');
    expect(messages[1].content).toContain('[msg-7-0]');
  });

  it('non-string values (numbers, booleans, objects) are preserved', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { key: 'user.age', value: 32, confidence: 0.9, refs: [] },
          { key: 'user.verified', value: true, confidence: 0.8, refs: [] },
          { key: 'user.address', value: { city: 'SF' }, confidence: 0.7, refs: [] },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(findKey(facts, 'user.age')?.value).toBe(32);
    expect(findKey(facts, 'user.verified')?.value).toBe(true);
    expect(findKey(facts, 'user.address')?.value).toEqual({ city: 'SF' });
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('llmFactExtractor — boundary', () => {
  it('empty facts array is respected', async () => {
    const provider = makeProvider({ content: '{"facts": []}' });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
  });

  it('missing facts key → empty array', async () => {
    const provider = makeProvider({ content: '{}' });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
  });

  it('fact missing key is skipped', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { value: 'Alice', confidence: 0.9 },
          { key: 'user.name', value: 'Bob', confidence: 0.9, refs: [] },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe('Bob');
  });

  it('fact missing value is skipped', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { key: 'user.name', confidence: 0.9 },
          { key: 'user.email', value: 'a@b.c', confidence: 0.9, refs: [] },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('user.email');
  });

  it('refs that are not arrays default to omitted', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [{ key: 'user.name', value: 'A', confidence: 0.9, refs: 'nope' }],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts[0].refs).toBeUndefined();
  });

  it('empty response.content triggers onParseError, returns []', async () => {
    const provider = makeProvider({ content: '' });
    const onParseError = vi.fn();
    const facts = await llmFactExtractor({ provider, onParseError }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
    expect(onParseError).toHaveBeenCalled();
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('llmFactExtractor — scenario', () => {
  it('multi-fact response with distinct keys preserves all', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { key: 'user.name', value: 'Alice', confidence: 0.95, refs: [] },
          { key: 'user.email', value: 'alice@x.y', confidence: 0.95, refs: [] },
          { key: 'user.location', value: 'Berlin', confidence: 0.9, refs: [] },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('many facts')],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(3);
    expect(findKey(facts, 'user.name')?.value).toBe('Alice');
    expect(findKey(facts, 'user.email')?.value).toBe('alice@x.y');
    expect(findKey(facts, 'user.location')?.value).toBe('Berlin');
  });

  it('duplicate key in one response → last-wins (matches patternFactExtractor)', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { key: 'user.name', value: 'Alice', confidence: 0.9, refs: [] },
          { key: 'user.name', value: 'Alicia', confidence: 0.95, refs: [] },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('correction')],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].value).toBe('Alicia');
  });

  it('existing facts are injected into user prompt when provided', async () => {
    const provider = makeProvider({ content: '{"facts":[]}' });
    const existing: Fact[] = [
      { key: 'user.name', value: 'Alice', confidence: 0.95, category: 'identity' },
      { key: 'user.email', value: 'a@b.c', confidence: 0.9 },
    ];
    await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 2,
      existing,
    });
    const call = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMsg = (call[0] as Message[])[1].content as string;
    expect(userMsg).toContain('Previously known facts');
    expect(userMsg).toContain('user.name');
    expect(userMsg).toContain('"Alice"');
    expect(userMsg).toContain('user.email');
  });

  it('includeExistingLimit: 0 skips prior-facts injection', async () => {
    const provider = makeProvider({ content: '{"facts":[]}' });
    const existing: Fact[] = [{ key: 'user.name', value: 'Alice', confidence: 0.95 }];
    await llmFactExtractor({ provider, includeExistingLimit: 0 }).extract({
      messages: [user('x')],
      turnNumber: 1,
      existing,
    });
    const call = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const userMsg = (call[0] as Message[])[1].content as string;
    expect(userMsg).not.toContain('Previously known facts');
  });
});

// ── Property ────────────────────────────────────────────────

describe('llmFactExtractor — property', () => {
  it('confidence is ALWAYS clamped to [0, 1] regardless of model output', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { key: 'a', value: 1, confidence: 99, refs: [] },
          { key: 'b', value: 2, confidence: -5, refs: [] },
          { key: 'c', value: 3, confidence: 'bad' as unknown, refs: [] },
          { key: 'd', value: 4, confidence: 0.42, refs: [] },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(findKey(facts, 'a')?.confidence).toBe(1);
    expect(findKey(facts, 'b')?.confidence).toBe(0);
    expect(findKey(facts, 'c')?.confidence).toBe(0.5);
    expect(findKey(facts, 'd')?.confidence).toBe(0.42);
  });

  it('returned facts never have duplicate keys', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { key: 'user.name', value: 'A1', confidence: 0.9, refs: [] },
          { key: 'user.name', value: 'A2', confidence: 0.9, refs: [] },
          { key: 'user.name', value: 'A3', confidence: 0.9, refs: [] },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    const keys = facts.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

// ── Security ────────────────────────────────────────────────

describe('llmFactExtractor — security', () => {
  it('malformed JSON → empty facts + onParseError fires, does NOT throw', async () => {
    const provider = makeProvider({ content: 'not json {' });
    const onParseError = vi.fn();
    const facts = await llmFactExtractor({ provider, onParseError }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
    expect(onParseError).toHaveBeenCalled();
  });

  it('non-object fact entries are silently skipped', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [null, 'string', 42, { key: 'k', value: 'v', confidence: 0.9, refs: [] }],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('k');
  });

  it('provider throwing propagates (fail-loud on real errors)', async () => {
    const provider: LLMProvider = {
      chat: async () => {
        throw new Error('network down');
      },
    };
    await expect(
      llmFactExtractor({ provider }).extract({ messages: [user('x')], turnNumber: 1 }),
    ).rejects.toThrow('network down');
  });

  it('abort signal threads through to provider', async () => {
    const chatSpy = vi.fn(async () => ({ content: '{"facts":[]}' }));
    const provider: LLMProvider = { chat: chatSpy };
    const controller = new AbortController();
    await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
      signal: controller.signal,
    });
    const call = chatSpy.mock.calls[0];
    expect(call[1]?.signal).toBe(controller.signal);
  });

  it('empty key string is skipped (not a valid fact id)', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        facts: [
          { key: '', value: 'x', confidence: 0.9 },
          { key: 'ok', value: 'y', confidence: 0.9 },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('ok');
  });
});
