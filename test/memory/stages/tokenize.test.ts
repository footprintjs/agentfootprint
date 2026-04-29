/**
 * tokenize unit tests — approximate token counter + per-message helper.
 */
import { describe, expect, it } from 'vitest';
import { approximateTokenCounter, countMessageTokens } from '../../../src/memory/stages/tokenize';
import type { LLMMessage } from '../../../src/adapters/types';

describe('approximateTokenCounter', () => {
  it('counts an empty string as 0 tokens', () => {
    expect(approximateTokenCounter('')).toBe(0);
  });

  it('counts a 4-char string as 1 token', () => {
    expect(approximateTokenCounter('abcd')).toBe(1);
  });

  it('rounds up — partial token counts as 1', () => {
    expect(approximateTokenCounter('a')).toBe(1);
    expect(approximateTokenCounter('ab')).toBe(1);
    expect(approximateTokenCounter('abc')).toBe(1);
  });

  it('is deterministic — same input → same output', () => {
    const text = 'The quick brown fox jumps over the lazy dog';
    expect(approximateTokenCounter(text)).toBe(approximateTokenCounter(text));
  });
});

describe('countMessageTokens', () => {
  function msg(content: string): LLMMessage {
    return { role: 'user', content };
  }

  it('counts the message content via the default counter', () => {
    expect(countMessageTokens(msg('abcd'))).toBe(1);
    expect(countMessageTokens(msg('abcdefgh'))).toBe(2);
  });

  it('uses the supplied counter when provided', () => {
    expect(countMessageTokens(msg('abcd'), () => 42)).toBe(42);
  });

  it('handles empty content as 0', () => {
    expect(countMessageTokens(msg(''))).toBe(0);
  });
});
