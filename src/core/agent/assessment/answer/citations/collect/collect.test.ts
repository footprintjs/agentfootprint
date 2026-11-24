import { describe, expect, it } from 'vitest';
import type { SubmittedCitationOffer } from '../../../../../../provider-contract/citationResponse.js';
import { collectCitations } from './collect.js';

function offer(id: string): SubmittedCitationOffer {
  return {
    offer: id,
    results: [
      {
        occurrence: [1, 2, 3, 4, 0],
        resultId: 'claim-result/example',
        bodyDigest: 'digest',
        slot: 1,
      },
    ],
  };
}

describe('citations in simple prose', () => {
  it('deduplicates citation markers without copying the answer', () => {
    const text = '- North recorded 12 mm [c:now:1] [c:now:1].';
    const [span] = collectCitations(text, offer('now')).spans;
    expect(text.slice(span?.start, span?.end)).toBe('North recorded 12 mm');
    expect(span?.references).toEqual([{ marker: { offer: 'now', slot: 1 }, resolvedSlot: 1 }]);
  });

  it('resolves an old answer only in its own offer when the next turn reuses slot 1', () => {
    const previous = 'South recorded 12 mm [c:previous:1].';
    const current = 'North recorded 12 mm [c:previous:1] [c:current:1].';
    expect(
      collectCitations(previous, JSON.parse(JSON.stringify(offer('previous')))).spans[0]
        ?.references[0]?.resolvedSlot,
    ).toBe(1);
    expect(collectCitations(current, offer('current')).spans[0]?.references).toEqual([
      { marker: { offer: 'previous', slot: 1 } },
      { marker: { offer: 'current', slot: 1 }, resolvedSlot: 1 },
    ]);
  });

  it.each([
    'Literal `[c:now:1]`.',
    'Literal \\[c:now:1].',
    'Literal [link [c:now:1]](https://example.invalid).',
    'Literal [c:now:1](https://example.invalid).',
    'Literal [link\nwith [c:now:1]\n](https://example.invalid).',
    '\x60\x60\x60\nliteral [c:now:1].\n\x60\x60\x60',
    '> Wrapper\nQuoted [c:now:1].',
  ])('ignores literal and unproved layouts %s', (text) => {
    expect(collectCitations(text, offer('now')).spans).toEqual([]);
  });

  it.each(['.', ';'])('ignores a literal code marker before %s in the code span', (stop) => {
    const code = `Example \`North recorded 12 mm [c:now:1]${stop} Next example.\``;
    expect(collectCitations(code, offer('now')).spans).toEqual([]);
    const prose = 'North recorded 12 mm [c:now:1].';
    const text = `${code}. ${prose}`;
    const spans = collectCitations(text, offer('now')).spans;
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]?.start, spans[0]?.end)).toBe('North recorded 12 mm');
  });

  it('keeps a longer code delimiter literal even when it contains a shorter backtick run', () => {
    const text = 'Example ``North `reading` [c:now:1]; Next example.``. North [c:now:1].';
    const spans = collectCitations(text, offer('now')).spans;
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]?.start, spans[0]?.end)).toBe('North');
  });

  it.each([
    'Example `North recorded 12 mm [c:now:1].\nNext example.`',
    'Example ` then ``North recorded 12 mm [c:now:1]. Next example.``',
  ])('leaves an ambiguous code layout literal without suppressing an unrelated block', (code) => {
    const text = `${code}\n\nNorth recorded 12 mm [c:now:1].`;
    const spans = collectCitations(text, offer('now')).spans;
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]?.start, spans[0]?.end)).toBe('North recorded 12 mm');
  });

  it('does not let unrelated link markup suppress a separate plain paragraph', () => {
    const text = '[example](https://example.invalid)\n\nNorth recorded 12 mm [c:now:1].';
    expect(collectCitations(text, offer('now')).spans[0]?.references[0]?.resolvedSlot).toBe(1);
  });

  it('keeps a separate suffix after complete code and leaves a split code span literal', () => {
    const text = '`North` recorded 12 mm [c:current:1].';
    const spans = collectCitations(text, offer('current')).spans;
    expect(spans).toHaveLength(1);
    expect(text.slice(spans[0]?.start, spans[0]?.end)).toBe('`North` recorded 12 mm');
    const split = 'Example `First. Second` is a reading [c:current:1].';
    expect(collectCitations(split, offer('current')).spans).toEqual([]);
  });

  it('leaves an escaped-delimiter block literal', () => {
    const text = 'Example \\` literal, `reading [c:current:1]. Further code.` and \\` escaped.';
    expect(collectCitations(text, offer('current')).spans).toEqual([]);
  });

  it('does not charge literal code markers to the citation limit', () => {
    const code = 'Read [c:current:1]; '.repeat(257);
    const text = '`' + code + '`. North [c:current:1].';
    const collected = collectCitations(text, offer('current'));
    expect(collected.complete).toBe(true);
    expect(collected.spans).toHaveLength(1);
    expect(collected.spans[0]?.references[0]?.resolvedSlot).toBe(1);
  });

  it('reports a scan limit and a reference-definition ambiguity without partial results', () => {
    const overLimit = 'North [c:now:1]. '.repeat(257);
    expect(collectCitations(overLimit, offer('now'))).toEqual({ complete: false, spans: [] });
    const defined = 'North [c:now:1].\n\n[c:now:1]: https://example.invalid';
    expect(collectCitations(defined, offer('now'))).toEqual({ complete: false, spans: [] });
  });
});
