/**
 * llmFactExtractor unit tests — exercises the LLM-backed fact extractor
 * against a fake LLMProvider that returns scripted JSON.
 *
 * Coverage: parses well-formed facts, skips malformed entries, threads
 * abort signal, tolerates empty/missing content, fires onParseError on
 * malformed JSON.
 */
import { describe, expect, it, vi } from 'vitest';
import { llmFactExtractor } from '../../../src/memory/facts/llmFactExtractor';
import type { LLMProvider, LLMRequest, LLMResponse, LLMMessage } from '../../../src/adapters/types';

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

describe('llmFactExtractor — unit', () => {
  it('parses a well-formed facts response', async () => {
    const provider = scriptedProvider({
      content: JSON.stringify({
        facts: [
          { key: 'name', value: 'Alice', confidence: 0.9 },
          { key: 'role', value: 'engineer', confidence: 0.7 },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [msg('user', "I'm Alice, an engineer")],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(2);
    expect(facts.map((f) => f.key)).toEqual(['name', 'role']);
  });

  it('passes the system prompt + user content to the provider', async () => {
    const seen: LLMRequest[] = [];
    const provider = scriptedProvider({
      content: '{"facts":[]}',
      onComplete: (req) => seen.push(req),
    });
    await llmFactExtractor({ provider }).extract({
      messages: [msg('user', 'hello')],
      turnNumber: 3,
    });
    expect(seen[0].systemPrompt).toMatch(/fact/i);
    expect(seen[0].messages[0].content).toContain('Turn 3');
    expect(seen[0].messages[0].content).toContain('hello');
  });

  it('includes existing facts in the prompt when provided', async () => {
    const seen: LLMRequest[] = [];
    const provider = scriptedProvider({
      content: '{"facts":[]}',
      onComplete: (req) => seen.push(req),
    });
    await llmFactExtractor({ provider }).extract({
      messages: [msg('user', 'update')],
      turnNumber: 5,
      existing: [{ key: 'name', value: 'Alice', confidence: 0.9, refs: [] }],
    });
    expect(seen[0].messages[0].content).toMatch(/Alice/);
  });
});

describe('llmFactExtractor — boundary', () => {
  it('empty facts array is respected', async () => {
    const provider = scriptedProvider({ content: '{"facts":[]}' });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
  });

  it('missing facts key → empty array', async () => {
    const provider = scriptedProvider({ content: '{}' });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
  });

  it('fact with missing key is skipped', async () => {
    const provider = scriptedProvider({
      content: JSON.stringify({
        facts: [
          { value: 'orphan', confidence: 0.5 }, // no key
          { key: 'kept', value: 'yes', confidence: 0.5 },
        ],
      }),
    });
    const facts = await llmFactExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(facts).toHaveLength(1);
    expect(facts[0].key).toBe('kept');
  });
});

describe('llmFactExtractor — security', () => {
  it('malformed JSON → empty facts + onParseError fires, does NOT throw', async () => {
    const provider = scriptedProvider({ content: '{"facts": [{value:bad' });
    const onParseError = vi.fn();
    const facts = await llmFactExtractor({ provider, onParseError }).extract({
      messages: [],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
    expect(onParseError).toHaveBeenCalledTimes(1);
  });

  it('abort signal threads through to provider.complete()', async () => {
    const seen: LLMRequest[] = [];
    const provider = scriptedProvider({
      content: '{"facts":[]}',
      onComplete: (req) => seen.push(req),
    });
    const ctrl = new AbortController();
    await llmFactExtractor({ provider }).extract({
      messages: [],
      turnNumber: 1,
      signal: ctrl.signal,
    });
    expect(seen[0].signal).toBe(ctrl.signal);
  });
});
