import { describe, expect, it, vi } from 'vitest';
import { detectNegativeClaims } from '../../../src/integrity/negative-claim/detect.js';
import { judgeProseNegatives } from '../../../src/integrity/negative-claim/prose.js';
import {
  NEGATIVE_CLAIM_PHRASES,
  NEGATIVE_CLAIM_PHRASES_HASH,
  NEGATIVE_CLAIM_PHRASES_VERSION,
  resolveNegativeClaimPhrases,
  type NegativeClaimPhraseExtensions,
} from '../../../src/integrity/negative-claim/phrases.js';
import type { TurnRecord } from '../../../src/integrity/negative-claim/types.js';
import { incidentCall, turnRecord } from './fixtures.js';

describe('bounded literal phrase extensions', () => {
  it('keeps the default pack/hash/version unchanged', () => {
    expect(resolveNegativeClaimPhrases()).toEqual({
      packs: NEGATIVE_CLAIM_PHRASES,
      hash: NEGATIVE_CLAIM_PHRASES_HASH,
      version: NEGATIVE_CLAIM_PHRASES_VERSION,
    });
    expect(resolveNegativeClaimPhrases({ none: [] })).toBe(resolveNegativeClaimPhrases());
  });

  it('detaches, freezes and hashes the effective literal packs', () => {
    const input = { none: ['incident-free'] };
    const resolved = resolveNegativeClaimPhrases(input);
    input.none[0] = 'changed';
    expect(resolved).toEqual(resolveNegativeClaimPhrases({ none: ['incident-free'] }));
    expect(resolved.hash).not.toBe(NEGATIVE_CLAIM_PHRASES_HASH);
    expect(resolved.version).toContain(resolved.hash);
    expect(Object.isFrozen(resolved.packs.none.at(-1)?.words)).toBe(true);
    expect(Object.isFrozen(resolved.packs.none)).toBe(true);
    expect(resolveNegativeClaimPhrases({ none: ['free of incidents'] }).hash).not.toBe(
      resolved.hash,
    );
  });

  it('observes a custom phrase only with the same native data anchor', () => {
    const phrases = resolveNegativeClaimPhrases({ none: ['incident-free'] });
    const check = (text: string) =>
      judgeProseNegatives({
        field: '/',
        text,
        record: turnRecord([incidentCall()]),
        phrases,
      });
    expect(check('Payments is incident-free.')).toEqual([
      expect.objectContaining({
        kind: 'negative-claim',
        phraseId: 'none.app.0',
        packVersion: phrases.version,
      }),
    ]);
    expect(check('Checkout is incident-free.')).toEqual([]);
    expect(detectNegativeClaims('Payments is incident-free.').claims).toEqual([]);
  });

  it('a custom completeness phrase stays a note, never an evidence binding', () => {
    const phrases = resolveNegativeClaimPhrases({ complete: ['exhaustive inventory'] });
    const rows = judgeProseNegatives({
      field: '/',
      text: 'Payments: exhaustive inventory.',
      record: turnRecord([incidentCall()]),
      phrases,
    });
    expect(rows).toEqual([
      expect.objectContaining({
        kind: 'negative-claim',
        claim: 'complete',
        packVersion: phrases.version,
      }),
    ]);
  });

  it('custom phrases keep code and unsupported-language notes', () => {
    const phrases = resolveNegativeClaimPhrases({ none: ['incident-free'] });
    expect(detectNegativeClaims('`incident-free`', phrases).notes).toEqual([
      expect.objectContaining({ code: 'in-code-block', packVersion: phrases.version }),
    ]);
    expect(detectNegativeClaims('支付服务没有未解决的事件。', phrases).notes).toEqual([
      expect.objectContaining({ code: 'language-unsupported', packVersion: phrases.version }),
    ]);
  });

  it('custom hits share the raw-claim cap before any record is read', () => {
    const phrases = resolveNegativeClaimPhrases({ none: ['incident-free'] });
    const read = vi.fn(() => {
      throw new Error('record must not be read');
    });
    const record = new Proxy({} as TurnRecord, { get: read });
    expect(
      judgeProseNegatives({
        field: '/',
        text: Array.from({ length: 33 }, () => 'Payments is incident-free.').join(' '),
        record,
        phrases,
      }),
    ).toEqual([expect.objectContaining({ code: 'too-many-claims', packVersion: phrases.version })]);
    expect(read).not.toHaveBeenCalled();
  });

  it('admits exactly 32 phrases and 128 UTF-16 units per phrase', () => {
    expect(
      resolveNegativeClaimPhrases({ none: Array.from({ length: 32 }, () => 'a'.repeat(128)) }).packs
        .none.length,
    ).toBe(NEGATIVE_CLAIM_PHRASES.none.length + 32);
  });

  it.each([
    { none: Array.from({ length: 33 }, () => 'not available') },
    { none: ['a'.repeat(129)] },
    { none: [''] },
    { none: ['   '] },
    { none: ['no.*'] },
    { none: ['<word> is absent'] },
    { none: ['^ no'] },
    { none: ['foo|bar'] },
    { none: ['/absent/i'] },
    { none: ['!other'] },
    { none: ['none\nexists'] },
    { none: [42] },
    { unknown: ['missing'] },
    { none: /missing/ },
    { complete: () => true },
  ])('rejects malformed or executable/pattern-like extensions: %j', (value) => {
    expect(() => resolveNegativeClaimPhrases(value as NegativeClaimPhraseExtensions)).toThrow();
  });

  it('rejects accessors without running them', () => {
    const get = vi.fn(() => ['missing']);
    const value = Object.defineProperty({}, 'none', { enumerable: true, get });
    expect(() => resolveNegativeClaimPhrases(value)).toThrow();
    expect(get).not.toHaveBeenCalled();
  });
});
