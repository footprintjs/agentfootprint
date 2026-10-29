/**
 * The fenced-block grammar (design docs/design/2026-10-script-artifact.md
 * § 5.1): closed backtick and tilde fences at column 0 are regions; inline
 * spans, indented code, fences with leading spaces and unclosed fences are
 * prose. Formatting alone exempts nothing.
 */

import { describe, expect, it } from 'vitest';

import {
  codeRegionsOf,
  MAX_CODE_REGIONS,
} from '../../../../src/core/agent/evidence/codeRegions.js';

const contents = (text: string): string[] => codeRegionsOf(text).regions.map((r) => r.content);

describe('code regions — what is a fenced block', () => {
  it('a closed backtick fence is a region; its content is the bytes between the wrapper', () => {
    const text = 'Total:\n```\nprint(1)\n```\nDone.';
    const { regions, dropped } = codeRegionsOf(text);
    expect(regions).toHaveLength(1);
    expect(regions[0]).toMatchObject({ block: 1, content: 'print(1)', info: '' });
    expect(text.slice(regions[0]!.start, regions[0]!.end)).toBe('```\nprint(1)\n```\n');
    expect(dropped).toBe(0);
  });

  it('a tilde fence is a region, and its info string may hold a backtick', () => {
    expect(contents('~~~py `x`\na = 1\n~~~')).toEqual(['a = 1']);
  });

  it('an info string is wrapper, never content', () => {
    const [region] = codeRegionsOf('```python title="x.py"\nx = 1\n```').regions;
    expect(region?.content).toBe('x = 1');
    expect(region?.info).toBe('python title="x.py"');
  });

  it('a backtick fence whose info string holds a backtick is NOT an opening fence', () => {
    expect(contents('```py`x\nprint(1)\n```')).toEqual([]);
  });

  it('a fence closed by a LONGER fence of the same character is a region', () => {
    expect(contents('```\na\n`````\nafter')).toEqual(['a']);
  });

  it('a shorter or different-character line does not close a fence', () => {
    expect(contents('````\n```\nb\n~~~~\n````')).toEqual(['```\nb\n~~~~']);
  });

  it('a closing line with anything but spaces after the fence does not close it', () => {
    expect(contents('```\na\n``` x\nb\n```')).toEqual(['a\n``` x\nb']);
    expect(contents('```\na\n```   \n')).toEqual(['a']);
  });

  it('a fence with LEADING SPACES is prose, at any indent — the rule may not pick a reading', () => {
    expect(contents(' ```\nx = 1\n ```')).toEqual([]);
    expect(contents('   ```\nx = 1\n   ```')).toEqual([]);
    expect(contents('- item\n  ```\n  x\n  ```')).toEqual([]);
  });

  it('an indented OPENING is prose even when a column-0 fence follows: that fence opens its own block', () => {
    // Read as an opening, the indented line would pair with the column-0 fence.
    expect(contents('  ```\nx = 1\n```')).toEqual([]);
    expect(contents('  ```\nx = 1\n```\n')).toEqual([]);
    expect(contents('  ```\nx = 1\n```\ny = 2\n```')).toEqual(['y = 2']);
  });

  it('an indented code block (four spaces) is prose', () => {
    expect(contents('Text\n\n    x = 1200\n    y = 2\n')).toEqual([]);
  });

  it('an inline span is prose', () => {
    expect(contents('The latency was `240 ms` and ``` inline ``` too.')).toEqual([]);
  });

  it('an UNCLOSED fence is prose to the end — not a region', () => {
    expect(contents('Before\n```python\nprint(1200)\nmore prose')).toEqual([]);
    // …and a later closed fence after an unclosed one is swallowed by it, as CommonMark reads it.
    expect(contents('```\nopen\n~~~\nx\n~~~')).toEqual([]);
  });

  it('nested backticks inside a block stay content', () => {
    expect(contents('````\nx = "```"\ny = `a`\n````')).toEqual(['x = "```"\ny = `a`']);
  });

  it('a closing fence on the line right after the opening one is an empty block', () => {
    expect(contents('```\n```')).toEqual(['']);
    expect(contents('```\n\n```')).toEqual(['']);
  });

  it('an opening fence must end in an LF: a fence on the last line opens nothing', () => {
    expect(contents('prose\n```python')).toEqual([]);
  });

  it('blocks are numbered in answer order', () => {
    const { regions } = codeRegionsOf('```\na\n```\nmid\n~~~\nb\n~~~\n');
    expect(regions.map((r) => [r.block, r.content])).toEqual([
      [1, 'a'],
      [2, 'b'],
    ]);
  });

  it(`at most ${MAX_CODE_REGIONS} regions are read; the rest are prose and COUNTED`, () => {
    const text = Array.from(
      { length: MAX_CODE_REGIONS + 5 },
      (_, i) => `\`\`\`\n${i}\n\`\`\``,
    ).join('\n');
    const { regions, dropped } = codeRegionsOf(text);
    expect(regions).toHaveLength(MAX_CODE_REGIONS);
    expect(dropped).toBe(5);
    expect(regions[MAX_CODE_REGIONS - 1]?.content).toBe(String(MAX_CODE_REGIONS - 1));
  });

  it('nothing is normalized: CR, tabs, trailing spaces and combining marks are content', () => {
    const program = 'a = "A  "\r\n\tb = "é"';
    expect(contents(`\`\`\`\n${program}\n\`\`\``)).toEqual([program]);
  });
});

// The one-pass cost bound is COUNTED, never clocked: `test/security/linear-scanners.test.ts`
// (`codeRegionsOf`) pins it on a long run of backticks and on the other worst cases.
