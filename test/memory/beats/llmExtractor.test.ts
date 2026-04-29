/**
 * llmExtractor unit tests — exercises the LLM-backed narrative beat
 * extractor against a fake LLMProvider that returns scripted JSON.
 *
 * Coverage: happy path parse, empty/missing fields, importance clamping,
 * malformed JSON tolerance, abort signal threading.
 */
import { describe, expect, it, vi } from 'vitest';
import { llmExtractor } from '../../../src/memory/beats/llmExtractor';
import type { LLMProvider, LLMRequest, LLMResponse, LLMMessage } from '../../../src/adapters/types';

// ─── Test helpers ────────────────────────────────────────────────────

interface ScriptedProviderOptions {
  readonly content: string;
  readonly onComplete?: (req: LLMRequest) => void;
}

function scriptedProvider(opts: ScriptedProviderOptions): LLMProvider {
  return {
    name: 'scripted',
    async complete(req: LLMRequest): Promise<LLMResponse> {
      opts.onComplete?.(req);
      return {
        content: opts.content,
        toolCalls: [],
        usage: { input: 0, output: 0 },
        stopReason: 'stop',
      };
    },
  };
}

function msg(role: LLMMessage['role'], content: string): LLMMessage {
  return { role, content };
}

// ─── Tests ───────────────────────────────────────────────────────────

describe('llmExtractor — unit', () => {
  it('parses a well-formed beats response', async () => {
    const provider = scriptedProvider({
      content: JSON.stringify({
        beats: [
          { summary: 'User shared name', importance: 0.9, refs: ['msg-1-0'], category: 'identity' },
        ],
      }),
    });
    const extractor = llmExtractor({ provider });
    const beats = await extractor.extract({
      messages: [msg('user', 'My name is Alice')],
      turnNumber: 1,
    });
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toBe('User shared name');
    expect(beats[0].importance).toBe(0.9);
    expect(beats[0].refs).toEqual(['msg-1-0']);
  });

  it('passes the system prompt + user content to the provider', async () => {
    const seen: LLMRequest[] = [];
    const provider = scriptedProvider({
      content: '{"beats":[]}',
      onComplete: (req) => seen.push(req),
    });
    await llmExtractor({ provider }).extract({
      messages: [msg('user', 'hello')],
      turnNumber: 7,
    });
    expect(seen).toHaveLength(1);
    expect(seen[0].systemPrompt).toMatch(/beats|importance/i);
    expect(seen[0].messages[0].content).toContain('Turn 7');
    expect(seen[0].messages[0].content).toContain('hello');
  });
});

describe('llmExtractor — boundary', () => {
  it('empty beats array is respected', async () => {
    const provider = scriptedProvider({ content: '{"beats":[]}' });
    const beats = await llmExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
  });

  it('missing beats key → empty array', async () => {
    const provider = scriptedProvider({ content: '{}' });
    const beats = await llmExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
  });

  it('beat with missing summary is skipped', async () => {
    const provider = scriptedProvider({
      content: JSON.stringify({
        beats: [
          { importance: 0.5 }, // no summary
          { summary: 'kept', importance: 0.5 },
        ],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(beats).toHaveLength(1);
    expect(beats[0].summary).toBe('kept');
  });

  it('beat refs that are not arrays default to empty refs', async () => {
    const provider = scriptedProvider({
      content: JSON.stringify({
        beats: [{ summary: 'no refs', importance: 0.5, refs: 'not-an-array' }],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(beats[0].refs).toEqual([]);
  });

  it('empty response.content tolerated → empty array', async () => {
    const provider = scriptedProvider({ content: '' });
    const beats = await llmExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
  });
});

describe('llmExtractor — property', () => {
  it('importance is ALWAYS clamped to [0, 1] regardless of model output', async () => {
    const provider = scriptedProvider({
      content: JSON.stringify({
        beats: [
          { summary: 'a', importance: 5 },
          { summary: 'b', importance: -2 },
          { summary: 'c', importance: 0.5 },
        ],
      }),
    });
    const beats = await llmExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    for (const b of beats) {
      expect(b.importance).toBeGreaterThanOrEqual(0);
      expect(b.importance).toBeLessThanOrEqual(1);
    }
  });
});

describe('llmExtractor — security', () => {
  it('malformed JSON → empty beats + onParseError fires, does NOT throw', async () => {
    const provider = scriptedProvider({ content: '{"beats": [unclosed' });
    const onParseError = vi.fn();
    const beats = await llmExtractor({ provider, onParseError }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(beats).toEqual([]);
    expect(onParseError).toHaveBeenCalledTimes(1);
  });

  it('abort signal threads through to provider.complete()', async () => {
    const seen: LLMRequest[] = [];
    const provider = scriptedProvider({
      content: '{"beats":[]}',
      onComplete: (req) => seen.push(req),
    });
    const ctrl = new AbortController();
    await llmExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
      signal: ctrl.signal,
    });
    expect(seen[0].signal).toBe(ctrl.signal);
  });
});
