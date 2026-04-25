/**
 * MapReduce pattern — 5 scenario tests.
 * Origin: Dean & Ghemawat, 2004 — applied to LLM long-document
 * summarization (split → summarize each → combine).
 */

import { describe, it, expect } from 'vitest';
import { mapReduce } from '../../../src/patterns/MapReduce.js';
import type { LLMProvider, LLMResponse } from '../../../src/adapters/types.js';

/** Echo provider — returns the user input so we can verify shard routing. */
function echoProvider(): LLMProvider {
  return {
    name: 'echo',
    complete: async (req): Promise<LLMResponse> => {
      const last = [...req.messages].reverse().find((m) => m.role === 'user');
      return {
        content: `SHARD<${last?.content ?? ''}>`,
        toolCalls: [],
        usage: { input: 10, output: 5 },
        stopReason: 'stop',
      };
    },
  };
}

describe('MapReduce', () => {
  it('splits input into N shards and runs N LLMCalls in parallel', async () => {
    const runner = mapReduce({
      provider: echoProvider(),
      model: 'mock',
      mapPrompt: 'Summarize this:',
      shardCount: 3,
      split: (input) => input.split(' | '),
      reduce: {
        kind: 'fn',
        fn: (results) =>
          Object.keys(results)
            .sort()
            .map((id) => results[id])
            .join(' + '),
      },
    });

    const out = await runner.run({ message: 'alpha | beta | gamma' });
    // Each shard routed through echo provider = SHARD<alpha>, SHARD<beta>, SHARD<gamma>
    expect(out).toBe('SHARD<alpha> + SHARD<beta> + SHARD<gamma>');
  });

  it('pads empty shards when split returns fewer than shardCount', async () => {
    const runner = mapReduce({
      provider: echoProvider(),
      model: 'mock',
      mapPrompt: 'M',
      shardCount: 4,
      split: (input) => input.split(' | '), // only 2 parts
      reduce: {
        kind: 'fn',
        fn: (results) =>
          Object.keys(results)
            .sort()
            .map((id) => results[id])
            .join(' | '),
      },
    });

    const out = await runner.run({ message: 'first | second' });
    // Shards 0,1 get content; 2,3 get empty string.
    expect(out).toBe('SHARD<first> | SHARD<second> | SHARD<> | SHARD<>');
  });

  it('rejects shardCount < 2 at construction time', () => {
    expect(() =>
      mapReduce({
        provider: echoProvider(),
        model: 'mock',
        mapPrompt: 'M',
        shardCount: 1,
        split: (s) => [s],
        reduce: { kind: 'fn', fn: () => '' },
      }),
    ).toThrow(/shardCount must be >= 2/);
  });

  it('fires N fork_start branches per run', async () => {
    const runner = mapReduce({
      provider: echoProvider(),
      model: 'mock',
      mapPrompt: 'M',
      shardCount: 3,
      split: (s) => s.split(','),
      reduce: { kind: 'fn', fn: (r) => Object.values(r).join('') },
    });
    let branchesCount = 0;
    runner.on('agentfootprint.composition.fork_start', (e) => {
      branchesCount = e.payload.branches.length;
    });
    await runner.run({ message: 'a,b,c' });
    expect(branchesCount).toBe(3);
  });

  it('supports LLM-based reducer', async () => {
    // Reducer LLM echoes — so the final output should contain shard pieces.
    const reducerProvider: LLMProvider = {
      name: 'reducer',
      complete: async (req): Promise<LLMResponse> => {
        const last = [...req.messages].reverse().find((m) => m.role === 'user');
        return {
          content: `REDUCED<${last?.content ?? ''}>`,
          toolCalls: [],
          usage: { input: 10, output: 5 },
          stopReason: 'stop',
        };
      },
    };
    const runner = mapReduce({
      provider: echoProvider(),
      model: 'mock',
      mapPrompt: 'Map',
      shardCount: 2,
      split: (s) => s.split('|'),
      reduce: {
        kind: 'llm',
        opts: {
          provider: reducerProvider,
          model: 'reducer-mock',
          prompt: 'Combine:',
        },
      },
    });
    const out = await runner.run({ message: 'x|y' });
    expect(out).toContain('REDUCED<');
    // Shards are XML-escaped inside the merge prompt (safe against
    // injection). Verify the escaped form reaches the reducer.
    expect(out).toContain('SHARD&lt;x&gt;');
    expect(out).toContain('SHARD&lt;y&gt;');
  });
});
