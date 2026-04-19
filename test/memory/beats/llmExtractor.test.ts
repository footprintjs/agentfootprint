/**
 * llmExtractor — 5-pattern tests.
 *
 * Uses a scripted mock LLMProvider to verify parsing, importance
 * clamping, ref/category passthrough, and parse-error isolation.
 *
 * Tiers:
 *   - unit:     well-formed JSON → beats with correct shape
 *   - boundary: empty response, missing fields, beats=[], no response.content
 *   - scenario: multi-beat response with mixed importance / category
 *   - property: importance always clamped to [0, 1]
 *   - security: malformed JSON / non-object beats / throwing provider
 */
import { describe, expect, it, vi } from 'vitest';
import { llmExtractor } from '../../../src/memory/beats';
import type { LLMProvider, LLMResponse, Message } from '../../../src/types';

function makeProvider(response: LLMResponse): LLMProvider {
  return { chat: vi.fn(async () => response) };
}

const user = (content: string): Message => ({ role: 'user', content });

// ── Unit ────────────────────────────────────────────────────

describe('llmExtractor — unit', () => {
  it('parses a well-formed beats response', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        beats: [
          {
            summary: 'User revealed name is Alice',
            importance: 0.9,
            refs: ['msg-1-0'],
            category: 'identity',
          },
        ],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('my name is Alice')],
      turnNumber: 1,
    });
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toBe('User revealed name is Alice');
    expect(beats[0].importance).toBe(0.9);
    expect(beats[0].refs).toEqual(['msg-1-0']);
    expect(beats[0].category).toBe('identity');
  });

  it('passes the system prompt + user content to the provider', async () => {
    const provider = makeProvider({ content: '{"beats": []}' });
    await llmExtractor({ provider }).extract({
      messages: [user('hi')],
      turnNumber: 3,
    });
    const call = (provider.chat as ReturnType<typeof vi.fn>).mock.calls[0];
    const messages = call[0] as Message[];
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content).toContain('Turn 3');
    expect(messages[1].content).toContain('[msg-3-0]');
  });
});

// ── Boundary ────────────────────────────────────────────────

describe('llmExtractor — boundary', () => {
  it('empty beats array is respected', async () => {
    const provider = makeProvider({ content: '{"beats": []}' });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
  });

  it('missing beats key → empty array', async () => {
    const provider = makeProvider({ content: '{}' });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
  });

  it('beat with missing summary is skipped', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        beats: [
          { importance: 0.5, refs: [] },
          { summary: 'ok', importance: 0.5, refs: [] },
        ],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toBe('ok');
  });

  it('beat refs that are not arrays default to empty refs', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        beats: [{ summary: 's', importance: 0.5, refs: 'not-array' }],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats[0].refs).toEqual([]);
  });

  it('undefined response.content is tolerated', async () => {
    const provider = makeProvider({ content: '' });
    const onParseError = vi.fn();
    const beats = await llmExtractor({ provider, onParseError }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
    expect(onParseError).toHaveBeenCalled();
  });
});

// ── Scenario ────────────────────────────────────────────────

describe('llmExtractor — scenario', () => {
  it('multi-beat response preserves order and fields', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        beats: [
          { summary: 'b1', importance: 0.9, refs: ['msg-1-0'], category: 'identity' },
          { summary: 'b2', importance: 0.5, refs: ['msg-1-1'] },
          { summary: 'b3', importance: 0.3, refs: ['msg-1-2'], category: 'tool-result' },
        ],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('x'), user('y'), user('z')],
      turnNumber: 1,
    });
    expect(beats.map((b) => b.summary)).toEqual(['b1', 'b2', 'b3']);
    expect(beats.map((b) => b.category)).toEqual(['identity', undefined, 'tool-result']);
  });
});

// ── Property ────────────────────────────────────────────────

describe('llmExtractor — property', () => {
  it('importance is ALWAYS clamped to [0, 1] regardless of model output', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        beats: [
          { summary: 'too high', importance: 99, refs: [] },
          { summary: 'too low', importance: -5, refs: [] },
          { summary: 'NaN', importance: 'bad' as unknown, refs: [] },
          { summary: 'ok', importance: 0.42, refs: [] },
        ],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats[0].importance).toBe(1);
    expect(beats[1].importance).toBe(0);
    expect(beats[2].importance).toBe(0.5); // non-number → neutral
    expect(beats[3].importance).toBe(0.42);
  });
});

// ── Security ────────────────────────────────────────────────

describe('llmExtractor — security', () => {
  it('malformed JSON → empty beats + onParseError fires, does NOT throw', async () => {
    const provider = makeProvider({ content: 'not json at all {' });
    const onParseError = vi.fn();
    const beats = await llmExtractor({ provider, onParseError }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
    expect(onParseError).toHaveBeenCalled();
  });

  it('non-object beat entries are silently skipped', async () => {
    const provider = makeProvider({
      content: JSON.stringify({
        beats: [null, 'string', 42, { summary: 'ok', importance: 0.5, refs: [] }],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
    });
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toBe('ok');
  });

  it('provider throwing propagates (fail-loud on real errors)', async () => {
    const provider: LLMProvider = {
      chat: async () => {
        throw new Error('network down');
      },
    };
    await expect(
      llmExtractor({ provider }).extract({ messages: [user('x')], turnNumber: 1 }),
    ).rejects.toThrow('network down');
  });

  it('abort signal threads through to the provider', async () => {
    const chatSpy = vi.fn(async () => ({ content: '{"beats":[]}' }));
    const provider: LLMProvider = { chat: chatSpy };
    const controller = new AbortController();
    await llmExtractor({ provider }).extract({
      messages: [user('x')],
      turnNumber: 1,
      signal: controller.signal,
    });
    const call = chatSpy.mock.calls[0];
    expect(call[1]?.signal).toBe(controller.signal);
  });
});
