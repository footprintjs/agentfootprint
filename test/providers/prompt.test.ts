import { describe, it, expect } from 'vitest';
import {
  staticPrompt,
  templatePrompt,
  skillBasedPrompt,
  compositePrompt,
} from '../../src/test-barrel';
import type { PromptContext } from '../../src/test-barrel';

// ── Helpers ─────────────────────────────────────────────────

function ctx(overrides: Partial<PromptContext> = {}): PromptContext {
  return {
    message: 'hello',
    turnNumber: 0,
    history: [],
    ...overrides,
  };
}

// ── skillBasedPrompt ────────────────────────────────────────

describe('skillBasedPrompt', () => {
  it('selects a single matching skill', () => {
    const provider = skillBasedPrompt([
      { id: 'code', content: 'You write clean code.', match: (c) => c.message.includes('code') },
      { id: 'math', content: 'You solve math.', match: (c) => c.message.includes('math') },
    ]);

    const result = provider.resolve(ctx({ message: 'help me with code' }));
    expect(result.value).toBe('You write clean code.');
  });

  it('selects multiple matching skills', () => {
    const provider = skillBasedPrompt([
      { id: 'code', content: 'You write clean code.', match: (c) => c.message.includes('code') },
      { id: 'review', content: 'You review PRs.', match: (c) => c.message.includes('code') },
    ]);

    const result = provider.resolve(ctx({ message: 'review my code' }));
    expect(result.value).toBe('You write clean code.\n\nYou review PRs.');
  });

  it('prepends base prompt before skills', () => {
    const provider = skillBasedPrompt(
      [{ id: 'code', content: 'You write clean code.', match: () => true }],
      { base: 'You are helpful.' },
    );

    const result = provider.resolve(ctx());
    expect(result.value).toBe('You are helpful.\n\nYou write clean code.');
  });

  it('returns fallback when no skills match and no base', () => {
    const provider = skillBasedPrompt(
      [{ id: 'code', content: 'You write code.', match: () => false }],
      { fallback: 'You are a general assistant.' },
    );

    const result = provider.resolve(ctx());
    expect(result.value).toBe('You are a general assistant.');
  });

  it('returns base alone when no skills match', () => {
    const provider = skillBasedPrompt(
      [{ id: 'code', content: 'You write code.', match: () => false }],
      { base: 'You are helpful.' },
    );

    const result = provider.resolve(ctx());
    expect(result.value).toBe('You are helpful.');
  });

  it('uses custom separator', () => {
    const provider = skillBasedPrompt(
      [
        { id: 'a', content: 'A', match: () => true },
        { id: 'b', content: 'B', match: () => true },
      ],
      { base: 'Base', separator: '\n---\n' },
    );

    const result = provider.resolve(ctx());
    expect(result.value).toBe('Base\n---\nA\n---\nB');
  });

  it('passes full PromptContext to match function', () => {
    const provider = skillBasedPrompt([
      {
        id: 'late-turn',
        content: 'Wrap up.',
        match: (c) => c.turnNumber > 5,
      },
    ]);

    expect(provider.resolve(ctx({ turnNumber: 2 })).value).toBe('');
    expect(provider.resolve(ctx({ turnNumber: 10 })).value).toBe('Wrap up.');
  });

  it('returns empty string when no match and no fallback', () => {
    const provider = skillBasedPrompt([{ id: 'x', content: 'X', match: () => false }]);

    expect(provider.resolve(ctx()).value).toBe('');
  });
});

// ── compositePrompt ─────────────────────────────────────────

describe('compositePrompt', () => {
  it('chains multiple providers in order', async () => {
    const provider = compositePrompt([
      staticPrompt('You are helpful.'),
      staticPrompt('Be concise.'),
    ]);

    const result = await provider.resolve(ctx());
    expect(result.value).toBe('You are helpful.\n\nBe concise.');
  });

  it('uses custom separator', async () => {
    const provider = compositePrompt([staticPrompt('A'), staticPrompt('B')], { separator: ' | ' });

    const result = await provider.resolve(ctx());
    expect(result.value).toBe('A | B');
  });

  it('filters out empty results', async () => {
    const emptyProvider = { resolve: () => ({ value: '', chosen: 'test' }) };
    const provider = compositePrompt([
      staticPrompt('First.'),
      emptyProvider,
      staticPrompt('Third.'),
    ]);

    const result = await provider.resolve(ctx());
    expect(result.value).toBe('First.\n\nThird.');
  });

  it('composes with skillBasedPrompt', async () => {
    const skills = skillBasedPrompt([
      { id: 'code', content: 'You write code.', match: (c) => c.message.includes('code') },
    ]);

    const provider = compositePrompt([staticPrompt('You are an AI assistant.'), skills]);

    const result = await provider.resolve(ctx({ message: 'help with code' }));
    expect(result.value).toBe('You are an AI assistant.\n\nYou write code.');
  });

  it('composes with templatePrompt', async () => {
    const provider = compositePrompt([
      staticPrompt('Base.'),
      templatePrompt('Turn {{turnNumber}}.'),
    ]);

    const result = await provider.resolve(ctx({ turnNumber: 3 }));
    expect(result.value).toBe('Base.\n\nTurn 3.');
  });

  it('handles async providers', async () => {
    const asyncProvider = {
      resolve: async () => ({ value: 'async result', chosen: 'test' }),
    };

    const provider = compositePrompt([staticPrompt('sync'), asyncProvider]);

    const result = await provider.resolve(ctx());
    expect(result.value).toBe('sync\n\nasync result');
  });

  it('returns empty string when all providers return empty', async () => {
    const provider = compositePrompt([
      { resolve: () => ({ value: '', chosen: 'test' }) },
      { resolve: () => ({ value: '', chosen: 'test' }) },
    ]);

    const result = await provider.resolve(ctx());
    expect(result.value).toBe('');
  });
});
