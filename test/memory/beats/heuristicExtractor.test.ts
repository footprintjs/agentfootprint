/**
 * heuristicExtractor — 5-pattern tests.
 *
 * Tiers:
 *   - unit:     user/assistant/tool role-based classification
 *   - boundary: empty messages, empty text, system messages skipped
 *   - scenario: mixed-role turn produces beats in message order
 *   - property: importance is always within [0, 1]
 *   - security: extractor never throws on bizarre content shapes
 */
import { describe, expect, it } from 'vitest';
import { heuristicExtractor } from '../../../src/memory/beats';
import type { Message } from '../../../src/types/messages';

const user = (content: string): Message => ({ role: 'user', content });
const assistant = (content: string): Message => ({ role: 'assistant', content });
const tool = (content: string): Message => ({ role: 'tool', content });
const system = (content: string): Message => ({ role: 'system', content });

async function run(messages: Message[], turnNumber = 1) {
  return heuristicExtractor().extract({ messages, turnNumber });
}

// ── Unit ────────────────────────────────────────────────────

describe('heuristicExtractor — unit', () => {
  it('extracts a beat per user message', async () => {
    const beats = await run([user('hello')]);
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toContain('User said');
    expect(beats[0].summary).toContain('hello');
  });

  it('tags identity claims with high importance + category', async () => {
    const beats = await run([user('My name is Alice.')]);
    expect(beats[0].importance).toBe(0.9);
    expect(beats[0].category).toBe('identity');
  });

  it('tags user questions with elevated importance + category', async () => {
    const beats = await run([user('What time is it?')]);
    expect(beats[0].importance).toBe(0.75);
    expect(beats[0].category).toBe('question');
  });

  it('assistant messages get neutral importance and no category', async () => {
    const beats = await run([assistant('Let me think...')]);
    expect(beats[0].summary).toContain('Assistant replied');
    expect(beats[0].importance).toBe(0.5);
    expect(beats[0].category).toBeUndefined();
  });

  it('tool results get low importance + tool-result category', async () => {
    const beats = await run([tool('search-result: x')]);
    expect(beats[0].importance).toBe(0.3);
    expect(beats[0].category).toBe('tool-result');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('heuristicExtractor — boundary', () => {
  it('empty messages array → empty beats array', async () => {
    expect(await run([])).toEqual([]);
  });

  it('system messages are SKIPPED (prompt framing, not conversation)', async () => {
    const beats = await run([system('you are helpful'), user('hi')]);
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toContain('hi');
  });

  it('messages with empty / whitespace content are skipped', async () => {
    const beats = await run([user(''), user('   '), user('real')]);
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toContain('real');
  });

  it('refs use the msg-{turn}-{index} convention matching writeMessages', async () => {
    const beats = await run([user('hi'), assistant('hello')], 7);
    expect(beats[0].refs).toEqual(['msg-7-0']);
    expect(beats[1].refs).toEqual(['msg-7-1']);
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('heuristicExtractor — scenario', () => {
  it('full turn with user question + assistant reply + tool call + tool result produces beats in order', async () => {
    const beats = await run([
      user('What is 2+2?'),
      assistant('Let me calculate'),
      tool('4'),
      assistant('The answer is 4.'),
    ]);
    expect(beats).toHaveLength(4);
    expect(beats.map((b) => b.category)).toEqual(['question', undefined, 'tool-result', undefined]);
  });

  it('identity claim with other messages → identity beat ranks highest by importance', async () => {
    const beats = await run([
      assistant('Welcome!'),
      user('my name is Alice and I like dogs'),
      assistant('Nice to meet you, Alice'),
    ]);
    const byImportance = [...beats].sort((a, b) => b.importance - a.importance);
    expect(byImportance[0].category).toBe('identity');
  });
});

// ── Property ────────────────────────────────────────────────

describe('heuristicExtractor — property', () => {
  it('every beat has importance in [0, 1]', async () => {
    const beats = await run([
      user('my name is Bob'),
      user('what is the weather?'),
      assistant('sunny'),
      tool('details'),
      user('ok'),
    ]);
    for (const b of beats) {
      expect(b.importance).toBeGreaterThanOrEqual(0);
      expect(b.importance).toBeLessThanOrEqual(1);
    }
  });

  it('beat count never exceeds non-system message count', async () => {
    const messages: Message[] = [
      system('sys'),
      user('a'),
      assistant('b'),
      system('sys2'),
      tool('c'),
    ];
    const beats = await run(messages);
    const nonSystem = messages.filter((m) => m.role !== 'system');
    expect(beats.length).toBeLessThanOrEqual(nonSystem.length);
  });

  it('refs arrays contain exactly one id per beat (single-message source)', async () => {
    const beats = await run([user('a'), assistant('b'), tool('c')]);
    for (const b of beats) {
      expect(b.refs).toHaveLength(1);
    }
  });
});

// ── Security ────────────────────────────────────────────────

describe('heuristicExtractor — security', () => {
  it('does not throw on non-string content (content-block arrays)', async () => {
    const weird: Message = {
      role: 'user',
      content: [{ type: 'text', text: 'hi via block' }] as never,
    };
    const beats = await run([weird]);
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toContain('hi via block');
  });

  it('does not throw on unusual role values (silently skips)', async () => {
    const odd: Message = { role: 'function' as never, content: 'weird' };
    const beats = await run([odd]);
    expect(beats).toHaveLength(0); // unknown role → no beat
  });

  it('extremely long content is captured verbatim (truncation is storage layer concern, not extractor)', async () => {
    const huge = 'a'.repeat(100_000);
    const beats = await run([user(huge)]);
    expect(beats).toHaveLength(1);
    // Extractor doesn't truncate — keeps refs faithful. Budget / display
    // layers (pickByBudget, formatter) handle length.
    expect(beats[0].summary.length).toBeGreaterThan(100_000);
  });
});
