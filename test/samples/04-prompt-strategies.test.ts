/**
 * Sample 04: Prompt Strategies
 *
 * Four ways to build system prompts — from static to dynamic.
 * All implement PromptProvider. Mix and match with compositePrompt.
 *
 *   staticPrompt     → same string every turn
 *   templatePrompt   → interpolate {{variables}}
 *   skillBasedPrompt → select fragments by context
 *   compositePrompt  → chain multiple providers
 */
import { describe, it, expect } from 'vitest';
import {
  staticPrompt,
  templatePrompt,
  skillBasedPrompt,
  compositePrompt,
} from '../../src/test-barrel';
import type { PromptContext } from '../../src/test-barrel';

function ctx(msg: string, turn = 0): PromptContext {
  return { message: msg, turnNumber: turn, history: [] };
}

describe('Sample 04: Prompt Strategies', () => {
  it('staticPrompt — same prompt every time', () => {
    const prompt = staticPrompt('You are a helpful assistant.');
    expect(prompt.resolve(ctx('hi')).value).toBe('You are a helpful assistant.');
    expect(prompt.resolve(ctx('bye')).value).toBe('You are a helpful assistant.');
  });

  it('templatePrompt — interpolates variables', () => {
    const prompt = templatePrompt('You are {{role}}. This is turn {{turnNumber}}.', {
      role: 'a code reviewer',
    });

    expect(prompt.resolve(ctx('hi', 3)).value).toBe('You are a code reviewer. This is turn 3.');
  });

  it('skillBasedPrompt — selects fragments by context', () => {
    const prompt = skillBasedPrompt(
      [
        {
          id: 'code',
          content: 'You write clean, well-tested code.',
          match: (c) => c.message.includes('code'),
        },
        {
          id: 'sql',
          content: 'You write efficient SQL queries.',
          match: (c) => c.message.includes('database'),
        },
        {
          id: 'explain',
          content: 'You explain concepts simply.',
          match: (c) => c.message.includes('explain'),
        },
      ],
      { base: 'You are a senior engineer.' },
    );

    // Only matching skills are included
    const codePrompt = prompt.resolve(ctx('write some code')).value;
    expect(codePrompt).toContain('senior engineer');
    expect(codePrompt).toContain('well-tested code');
    expect(codePrompt).not.toContain('SQL');

    // Multiple skills can match
    const bothPrompt = prompt.resolve(ctx('explain the database code')).value;
    expect(bothPrompt).toContain('SQL');
    expect(bothPrompt).toContain('explain concepts');
  });

  it('compositePrompt — chains multiple providers', async () => {
    const prompt = compositePrompt([
      staticPrompt('You are an AI assistant.'),
      skillBasedPrompt([
        { id: 'code', content: 'You write code.', match: (c) => c.message.includes('code') },
      ]),
      templatePrompt('Current turn: {{turnNumber}}.'),
    ]);

    const result = await prompt.resolve(ctx('help me with code', 5));
    expect(result.value).toBe('You are an AI assistant.\n\nYou write code.\n\nCurrent turn: 5.');
  });
});
