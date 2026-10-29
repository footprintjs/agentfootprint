/**
 * The Markdown wrapper's pinned line endings (design § 4.2, § 5.2): the
 * library's renderer writes `fence + info`, ONE LF, the program unchanged, ONE
 * LF, the closing fence; the reader removes exactly those bytes. A CR before
 * the opening LF is wrapper; a CR before the closing LF is content.
 */

import { describe, expect, it } from 'vitest';

import { codeRegionsOf } from '../../../../src/core/agent/evidence/codeRegions.js';
import { fenceFor, wrapProgram } from '../../../../src/core/agent/scripts/wrapper.js';

/** Render with the library's wrapper, read back with the gate's reader. */
const roundTrip = (program: string, language?: string): string | undefined =>
  codeRegionsOf(wrapProgram(program, language)).regions[0]?.content;

describe('the wrapper — renderer and reader agree byte for byte', () => {
  it.each([
    ['a program ending in a lone CR', 'print(1)\r'],
    ['a program ending in LF', 'print(1)\n'],
    ['a program ending in CRLF', 'print(1)\r\n'],
    ['an empty program', ''],
    ['a program with no final line break', 'a = 1\nb = 2'],
    ['a program holding three backticks', 's = "```"\nprint(s)'],
    ['a program holding four backticks', 's = "````"\nprint(s)'],
    ['a program that is only line breaks', '\n\n'],
    ['a program with CRLF inside', 'a = 1\r\nb = 2'],
    ['a multibyte program', 'print("é — ✓ 😀")'],
  ])('%s round-trips unchanged', (_label, program) => {
    expect(roundTrip(program, 'python')).toBe(program);
    expect(roundTrip(program)).toBe(program);
  });

  it('a program ending in a line break shows an empty line before the closing fence', () => {
    expect(wrapProgram('x\n', 'python')).toBe('```python\nx\n\n```');
  });

  it('the fence is max(3, longestRun + 1) backticks', () => {
    expect(fenceFor('print(1)')).toBe('```');
    expect(fenceFor('a = "``"')).toBe('```');
    expect(fenceFor('a = "```"')).toBe('````');
    expect(fenceFor('a = "````"')).toBe('`````');
  });

  it('a program holding a fence line cannot close the library block early', () => {
    const program = 'doc = """\n```\nnot the end\n```\n"""';
    const text = `answer\n\n${wrapProgram(program, 'python')}\n\nafter`;
    const { regions } = codeRegionsOf(text);
    expect(regions).toHaveLength(1);
    expect(regions[0]?.content).toBe(program);
  });

  it('a CR before the OPENING LF is wrapper; a CR before the CLOSING LF is content', () => {
    expect(codeRegionsOf('```python\r\nx = 1\n```').regions[0]?.content).toBe('x = 1');
    expect(codeRegionsOf('```python\nx = 1\r\n```').regions[0]?.content).toBe('x = 1\r');
  });

  it('an answer written with CRLF line endings around an LF program reads a DIFFERENT program', () => {
    const program = 'a = 1\nb = 2';
    const crlfAnswer = `Result:\r\n\`\`\`python\r\na = 1\r\nb = 2\r\n\`\`\`\r\n`;
    const content = codeRegionsOf(crlfAnswer).regions[0]?.content;
    expect(content).toBe('a = 1\r\nb = 2\r');
    expect(content).not.toBe(program);
  });
});
