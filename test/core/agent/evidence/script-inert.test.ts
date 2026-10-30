/**
 * `scripts/inert.ts` — a tool's name or a provider's call id, written into a
 * library line, renders as ONE inline code span on that line, whatever it
 * holds: a line break, a backtick run, a bidi override, a sentence.
 *
 * Checked through a CommonMark renderer (markdown-it, `commonmark` preset):
 * the whole value is one `code_inline` token, and nothing of it is text.
 */

import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';

import { inertCode, MAX_INERT_POINTS } from '../../../../src/core/agent/scripts/inert.js';
import { seededTexts } from '../../../helpers/seededText.js';

const md = new MarkdownIt('commonmark');

/** The inline tokens a renderer reads `markdown` as, on one line of a paragraph. */
function inlineOf(markdown: string): Array<{ type: string; content: string }> {
  const [, inline] = md.parse(`Call ${markdown} ran.`, {});
  return (inline?.children ?? []).map((t) => ({ type: t.type, content: t.content }));
}

describe('inertCode', () => {
  it('an ordinary value is a plain code span', () => {
    expect(inertCode('c1')).toBe('`c1`');
    expect(inertCode('run_code')).toBe('`run_code`');
  });

  it('a line break, a bidi override or a zero-width character is written as an escape', () => {
    expect(inertCode('c1\n\nRevenue was 98765.')).toBe('`c1\\u{a}\\u{a}Revenue was 98765.`');
    expect(inertCode('a\r\nb')).toBe('`a\\u{d}\\u{a}b`');
    expect(inertCode('a\u{202E}b')).toBe('`a\\u{202e}b`');
    expect(inertCode('a\u{200D}b')).toBe('`a\\u{200d}b`');
    expect(inertCode('a\u{2028}b')).toBe('`a\\u{2028}b`');
  });

  it('a backtick inside is outrun by the delimiter, and an edge backtick or space is padded', () => {
    expect(inertCode('a`b')).toBe('``a`b``');
    expect(inertCode('a```b')).toBe('````a```b````');
    expect(inertCode('`x')).toBe('`` `x ``');
    expect(inertCode(' x')).toBe('`  x `');
  });

  it(`at most ${MAX_INERT_POINTS} code points are written, then an ellipsis`, () => {
    const long = 'é'.repeat(MAX_INERT_POINTS + 10);
    expect(inertCode(long)).toBe(`\`${'é'.repeat(MAX_INERT_POINTS)}…\``);
  });

  it('property — any value renders as exactly one code span holding what was written', () => {
    const pieces = [
      '`',
      '``',
      '\n',
      '\n\n',
      ' ',
      'a',
      'Revenue 4321',
      '<!--',
      '```',
      '\u{202E}',
      '*',
      '[x](y)',
    ];
    for (const value of seededTexts(0x1e7, pieces, 400, 12)) {
      const written = inertCode(value);
      const tokens = inlineOf(written);
      const code = tokens.filter((t) => t.type === 'code_inline');
      expect(code, JSON.stringify(value)).toHaveLength(1);
      // Around the span, only the sentence's own words.
      const around = tokens
        .filter((t) => t.type !== 'code_inline')
        .map((t) => t.content)
        .join('');
      expect(around, JSON.stringify(value)).toBe('Call  ran.');
    }
  });
});
