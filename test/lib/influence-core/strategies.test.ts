/**
 * Named influence strategies — the descriptor surface a host UI's strategy
 * selector renders (name / description / requirements / scorer).
 */
import { describe, expect, it } from 'vitest';
import { mockEmbedder } from '../../../src/memory/embedding/mockEmbedder';
import {
  lexicalOverlapStrategy,
  listInfluenceStrategies,
  scoreInfluence,
  scoreLexicalInfluence,
  semanticAlignmentStrategy,
} from '../../../src/lib/influence-core';

const EVIDENCE = [
  {
    id: 'vip',
    text: 'VIP tier override status: refunds approved beyond the 30-day window.',
    ancestorTexts: [],
  },
  { id: 'style', text: 'Style rule: limit replies to two sentences.', ancestorTexts: [] },
];
const ANSWER = 'Refund APPROVED: VIP tier override, refunds approved beyond the 30-day window.';

describe('listInfluenceStrategies', () => {
  it('lists the two built-ins, default first, all frozen', () => {
    const list = listInfluenceStrategies();
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe('semantic-alignment');
    expect(list[1].name).toBe('lexical-overlap');
    expect(Object.isFrozen(list)).toBe(true);
    for (const s of list) expect(Object.isFrozen(s)).toBe(true);
  });

  it('every entry is well-shaped with a unique kebab-case name', () => {
    const list = listInfluenceStrategies();
    const kebab = /^[a-z]+(-[a-z]+)*$/;
    const names = new Set<string>();
    for (const s of list) {
      expect(s.name).toMatch(kebab);
      expect(s.description.length).toBeGreaterThan(0);
      expect(Array.isArray(s.requirements)).toBe(true);
      expect(typeof s.scorer).toBe('function');
      names.add(s.name);
    }
    expect(names.size).toBe(list.length);
  });
});

describe('built-in strategy values', () => {
  it('wires the right scorer + requirements for each', () => {
    expect(semanticAlignmentStrategy.scorer).toBe(scoreInfluence);
    expect(semanticAlignmentStrategy.requirements).toEqual(['embedder']);
    expect(lexicalOverlapStrategy.scorer).toBe(scoreLexicalInfluence);
    expect(lexicalOverlapStrategy.requirements).toEqual([]);
  });
});

describe('both honest options actually run', () => {
  it('each strategy scores one fixture into a ranked non-empty array', async () => {
    for (const strategy of listInfluenceStrategies()) {
      const ranked = await strategy.scorer({
        evidence: EVIDENCE,
        finalAnswerText: ANSWER,
        embedder: mockEmbedder(),
      });
      expect(ranked.length).toBe(EVIDENCE.length);
      expect(ranked[0]).toHaveProperty('score');
    }
  });
});

describe('greying contract', () => {
  it('pins what a selector keys off to enable/disable each option', () => {
    expect(lexicalOverlapStrategy.requirements.includes('embedder')).toBe(false);
    expect(semanticAlignmentStrategy.requirements.includes('embedder')).toBe(true);
  });
});
