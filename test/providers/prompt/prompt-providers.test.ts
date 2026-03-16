import { describe, it, expect } from 'vitest';
import { staticPrompt, templatePrompt } from '../../../src/providers/prompt';
import type { PromptContext } from '../../../src/core';

const baseCtx: PromptContext = { message: 'hello', turnNumber: 0, history: [] };

describe('staticPrompt', () => {
  it('returns the same string every time', () => {
    const provider = staticPrompt('You are helpful.');
    expect(provider.resolve(baseCtx)).toBe('You are helpful.');
    expect(provider.resolve({ ...baseCtx, turnNumber: 5 })).toBe('You are helpful.');
  });

  it('handles empty string', () => {
    expect(staticPrompt('').resolve(baseCtx)).toBe('');
  });

  it('handles multi-line prompts', () => {
    const prompt = 'Line 1.\nLine 2.\nLine 3.';
    expect(staticPrompt(prompt).resolve(baseCtx)).toBe(prompt);
  });
});

describe('templatePrompt', () => {
  it('interpolates explicit variables', () => {
    const provider = templatePrompt('You are {{role}}.', { role: 'a code reviewer' });
    expect(provider.resolve(baseCtx)).toBe('You are a code reviewer.');
  });

  it('interpolates context fields', () => {
    const provider = templatePrompt('Turn {{turnNumber}}: user said "{{message}}"');
    const ctx: PromptContext = { message: 'hi there', turnNumber: 3, history: [] };
    expect(provider.resolve(ctx)).toBe('Turn 3: user said "hi there"');
  });

  it('explicit vars override context fields', () => {
    const provider = templatePrompt('{{message}}', { message: 'overridden' });
    expect(provider.resolve(baseCtx)).toBe('overridden');
  });

  it('preserves unknown placeholders', () => {
    const provider = templatePrompt('{{known}} and {{unknown}}', { known: 'yes' });
    expect(provider.resolve(baseCtx)).toBe('yes and {{unknown}}');
  });

  it('handles template with no placeholders', () => {
    const provider = templatePrompt('No variables here.');
    expect(provider.resolve(baseCtx)).toBe('No variables here.');
  });
});
