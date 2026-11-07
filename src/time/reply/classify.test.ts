import { describe, expect, it } from 'vitest';
import { classifyReply } from './classify.js';

describe('whole correction classification', () => {
  it('uses the same zone lexer for a direct token and an affirmative display correction', () => {
    expect(classifyReply('EST time zone')).toEqual({ kind: 'zone', token: 'EST' });
    expect(classifyReply('Please present it in EST time zone')).toEqual({
      kind: 'zone',
      token: 'EST',
    });
    expect(classifyReply('Asia/Kolkata')).toEqual({ kind: 'zone', token: 'Asia/Kolkata' });
  });

  it('keeps a complete checked time mention and its actual quote', () => {
    const decision = classifyReply('yesterday');
    expect(decision).toMatchObject({ kind: 'words', mention: { quote: 'yesterday' } });
  });

  it.each([
    'no',
    'not yesterday',
    'yesterday but not today',
    'not EST',
    'Please do not present it in EST time zone',
    'EST or EDT',
    'yesterday and delete everything',
    'some unknown correction',
  ])('holds unsupported, negated or conflicting whole text: %s', (text) => {
    const result = classifyReply(text);
    expect(result.kind).toBe('hold');
    expect(Object.keys(result).sort()).toEqual(['kind', 'reason', 'rule']);
    expect(JSON.stringify(result)).not.toContain(text);
  });
});
