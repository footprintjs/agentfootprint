/**
 * patternFactExtractor — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     each rule extracts its expected fact
 *   - boundary: empty messages, non-user roles, whitespace content
 *   - scenario: multi-rule turn produces distinct facts per key
 *   - property: no duplicate keys per extraction call
 *   - security: content-block arrays supported; no exception on garbage
 */
import { describe, expect, it } from 'vitest';
import { patternFactExtractor } from '../../../src/memory/facts';
import type { Fact } from '../../../src/memory/facts';
import type { Message } from '../../../src/types/messages';

const user = (content: string): Message => ({ role: 'user', content });
const assistant = (content: string): Message => ({ role: 'assistant', content });
const system = (content: string): Message => ({ role: 'system', content });

async function run(messages: Message[], turnNumber = 1): Promise<readonly Fact[]> {
  return patternFactExtractor().extract({ messages, turnNumber });
}

function findKey(facts: readonly Fact[], key: string): Fact | undefined {
  return facts.find((f) => f.key === key);
}

// ── Unit ────────────────────────────────────────────────────

describe('patternFactExtractor — unit', () => {
  it('"my name is Alice" → user.name', async () => {
    const facts = await run([user('my name is Alice.')]);
    expect(findKey(facts, 'user.name')?.value).toBe('Alice');
  });

  it('"I\'m Bob" → user.name', async () => {
    const facts = await run([user("I'm Bob.")]);
    expect(findKey(facts, 'user.name')?.value).toBe('Bob');
  });

  it('"I live in San Francisco" → user.location', async () => {
    const facts = await run([user('I live in San Francisco.')]);
    expect(findKey(facts, 'user.location')?.value).toBe('San Francisco');
  });

  it('"my email is alice@example.com" → user.email', async () => {
    const facts = await run([user('my email is alice@example.com.')]);
    expect(findKey(facts, 'user.email')?.value).toBe('alice@example.com');
  });

  it('"I prefer dark mode" → user.preferences', async () => {
    const facts = await run([user('I prefer dark mode.')]);
    expect(findKey(facts, 'user.preferences')?.value).toBe('dark mode');
  });

  it('identity category + high confidence', async () => {
    const facts = await run([user('My name is Alice.')]);
    const name = findKey(facts, 'user.name')!;
    expect(name.category).toBe('identity');
    expect(name.confidence).toBeGreaterThanOrEqual(0.8);
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('patternFactExtractor — boundary', () => {
  it('empty messages array → no facts', async () => {
    expect(await run([])).toEqual([]);
  });

  it('only assistant / system messages → no facts (extractor is user-only)', async () => {
    const facts = await run([assistant('Nice to meet you, Alice.'), system('you are helpful')]);
    expect(facts).toEqual([]);
  });

  it('user message with no matching pattern → no facts', async () => {
    const facts = await run([user('hello, can you help me with something?')]);
    expect(facts).toEqual([]);
  });

  it('empty-content user message → no facts', async () => {
    expect(await run([user(''), user('   ')])).toEqual([]);
  });

  it('trailing punctuation / period stripped from captures', async () => {
    const facts = await run([user('my name is Alice.')]);
    expect(findKey(facts, 'user.name')?.value).toBe('Alice');
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('patternFactExtractor — scenario', () => {
  it('multi-rule single user message produces facts for each match', async () => {
    const facts = await run([
      user('My name is Alice. I live in Berlin. My email is alice@example.com. I prefer tea.'),
    ]);
    expect(findKey(facts, 'user.name')?.value).toBe('Alice');
    expect(findKey(facts, 'user.location')?.value).toBe('Berlin');
    expect(findKey(facts, 'user.email')?.value).toBe('alice@example.com');
    expect(findKey(facts, 'user.preferences')?.value).toBe('tea');
  });

  it('later user message in the same turn overrides earlier fact on same key', async () => {
    const facts = await run([
      user('my name is Alice.'),
      assistant('Nice.'),
      user('Sorry, actually my name is Alicia.'),
    ]);
    expect(findKey(facts, 'user.name')?.value).toBe('Alicia');
  });

  it('assistant chatter between user turns is ignored', async () => {
    const facts = await run([
      user('my name is Alice.'),
      assistant('my name is BOT_NAME — but ignore that.'),
    ]);
    expect(findKey(facts, 'user.name')?.value).toBe('Alice');
  });
});

// ── Property ────────────────────────────────────────────────

describe('patternFactExtractor — property', () => {
  it('no duplicate keys in the output', async () => {
    const facts = await run([
      user('my name is Alice.'),
      user("I'm Alicia."),
      user('my name is Alex.'),
    ]);
    const keys = facts.map((f) => f.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('every fact has a confidence in [0, 1]', async () => {
    const facts = await run([
      user('my name is Alice. I live in SF. I prefer coffee. email alice@x.y.'),
    ]);
    for (const f of facts) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('every fact has a non-empty category', async () => {
    const facts = await run([user('my name is Alice. I live in SF.')]);
    for (const f of facts) {
      expect(typeof f.category).toBe('string');
      expect(f.category!.length).toBeGreaterThan(0);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('patternFactExtractor — security', () => {
  it('content-block arrays are supported via textOf', async () => {
    const weird: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'my name is Alice' }] as never,
    };
    const facts = await run([weird]);
    expect(findKey(facts, 'user.name')?.value).toBe('Alice');
  });

  it('extremely long text does not throw', async () => {
    const huge = 'a'.repeat(100_000) + ' my name is Alice.';
    const facts = await run([user(huge)]);
    // Should complete without timeout or throw
    expect(facts).toBeDefined();
  });

  it('unusual role values do not throw (silently skipped)', async () => {
    const odd: Message = { role: 'function' as never, content: 'my name is X' };
    const facts = await run([odd]);
    expect(facts).toEqual([]);
  });

  it('regex patterns do not match inside random non-English text', async () => {
    const facts = await run([user('日本語の文章です。')]);
    expect(facts).toEqual([]);
  });
});
