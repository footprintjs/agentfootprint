/**
 * patternFactExtractor unit tests — zero-dep regex extractor.
 *
 * Coverage: each built-in rule (name / location / email / preference) +
 * non-user messages ignored + trailing punctuation stripped.
 */
import { describe, expect, it } from 'vitest';
import { patternFactExtractor } from '../../../src/memory/facts/patternFactExtractor';
import type { LLMMessage } from '../../../src/adapters/types';

function user(content: string): LLMMessage {
  return { role: 'user', content };
}

function assistant(content: string): LLMMessage {
  return { role: 'assistant', content };
}

describe('patternFactExtractor — unit', () => {
  it('extracts user.name from "my name is X"', async () => {
    const facts = await patternFactExtractor().extract({
      messages: [user('Hi, my name is Alice')],
      turnNumber: 1,
    });
    expect(facts.find((f) => f.key === 'user.name')?.value).toBe('Alice');
  });

  it("extracts user.name from \"I'm X\"", async () => {
    const facts = await patternFactExtractor().extract({
      messages: [user("I'm Bob")],
      turnNumber: 1,
    });
    expect(facts.find((f) => f.key === 'user.name')?.value).toBe('Bob');
  });

  it('extracts user.location from "I live in X"', async () => {
    const facts = await patternFactExtractor().extract({
      messages: [user('I live in San Francisco')],
      turnNumber: 1,
    });
    expect(facts.find((f) => f.key === 'user.location')?.value).toBe('San Francisco');
  });

  it('extracts user.email from "my email is X"', async () => {
    const facts = await patternFactExtractor().extract({
      messages: [user('my email is alice@example.com')],
      turnNumber: 1,
    });
    expect(facts.find((f) => f.key === 'user.email')?.value).toBe('alice@example.com');
  });

  it('strips trailing punctuation from captures', async () => {
    const facts = await patternFactExtractor().extract({
      messages: [user('my name is Alice.')],
      turnNumber: 1,
    });
    expect(facts.find((f) => f.key === 'user.name')?.value).toBe('Alice');
  });
});

describe('patternFactExtractor — boundary', () => {
  it('non-user messages are ignored', async () => {
    const facts = await patternFactExtractor().extract({
      messages: [assistant('My name is Claude')],
      turnNumber: 1,
    });
    expect(facts.find((f) => f.key === 'user.name')).toBeUndefined();
  });

  it('returns empty array on no matches', async () => {
    const facts = await patternFactExtractor().extract({
      messages: [user('hello there')],
      turnNumber: 1,
    });
    expect(facts).toEqual([]);
  });

  it('all extracted facts have confidence in [0, 1]', async () => {
    const facts = await patternFactExtractor().extract({
      messages: [user('my name is Alice and my email is a@b.com')],
      turnNumber: 1,
    });
    for (const f of facts) {
      expect(f.confidence).toBeGreaterThanOrEqual(0);
      expect(f.confidence).toBeLessThanOrEqual(1);
    }
  });
});
