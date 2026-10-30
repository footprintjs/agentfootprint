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
    // "``` x" is content, so the block did not close there; a run that long in
    // a block's content makes the whole block prose (the last describe below).
    expect(codeRegionsOf('```\na\n``` x\nb\n```')).toEqual({
      regions: [],
      dropped: 0,
      stoppedAt: 0,
    });
    expect(contents('```\na\n```   \n')).toEqual(['a']);
  });

  it('a fence with LEADING SPACES is prose, at any indent — the rule may not pick a reading', () => {
    expect(contents(' ```\nx = 1\n ```')).toEqual([]);
    expect(contents('   ```\nx = 1\n   ```')).toEqual([]);
    expect(contents('- item\n  ```\n  x\n  ```')).toEqual([]);
  });

  it('an indented OPENING is prose, and nothing after it is read as a block', () => {
    // A renderer opens a block at the indented line and CLOSES it at the next
    // column-0 fence, so `y = 2` below is prose on screen: read as a block it
    // would be exempt from the check. Reading stops at the indented fence.
    expect(contents('  ```\nx = 1\n```')).toEqual([]);
    expect(contents('  ```\nx = 1\n```\n')).toEqual([]);
    expect(contents('  ```\nx = 1\n```\ny = 2\n```')).toEqual([]);
    expect(codeRegionsOf('```\na\n```\n  ```\nx\n```\ny\n```')).toMatchObject({
      regions: [{ content: 'a' }],
      stoppedAt: 10,
    });
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

/**
 * A matched block is exempt from the check, so the reader may never see a
 * block where a renderer shows prose. It closes a block where CommonMark closes
 * it, and it stops reading at the first line where a renderer could pair fences
 * another way. Each case below is a laundering route a model could take: a
 * program it submitted, shown so that part of it renders as a sentence.
 */
describe('code regions — a block closes where a renderer closes it', () => {
  it('a closing fence indented by one to three spaces closes the block', () => {
    expect(contents('```\na\n ```\nRevenue was 4321.')).toEqual(['a']);
    expect(contents('```\na\n  ```\nRevenue was 4321.')).toEqual(['a']);
    expect(contents('```\na\n   ```\nRevenue was 4321.')).toEqual(['a']);
  });

  it('a tilde block closes the same way', () => {
    expect(contents('~~~\na\n  ~~~\nRevenue was 4321.')).toEqual(['a']);
    expect(contents('~~~py\na\n ~~~~~   \nRevenue was 4321.')).toEqual(['a']);
  });

  it('a LONGER closing run closes the block, indented or not', () => {
    expect(contents('```\na\n  `````\nRevenue was 4321.')).toEqual(['a']);
    expect(contents('```\na\n`````\nRevenue was 4321.')).toEqual(['a']);
  });

  it('a closing run followed by a TAB closes the block, and nothing after it is read', () => {
    // CommonMark 0.30 closes there and 0.29 does not: the block is code either
    // way, what follows it is not settled.
    expect(codeRegionsOf('```\na\n```\t\nb\n```\nc\n```')).toMatchObject({
      regions: [{ content: 'a' }],
      stoppedAt: 11,
    });
  });

  it('a lone CR ends a line, as it does for a renderer', () => {
    expect(contents('```\nfoo\r```\rRevenue was 4321.\n```')).toEqual(['foo']);
    expect(contents('```\rx\r```')).toEqual(['x']);
    // Before the closing line an LF is the wrapper's and a CR before it is content.
    expect(contents('```\r\nx\r\n```\r\n')).toEqual(['x\r']);
  });
});

describe('code regions — reading stops where a renderer could pair fences another way', () => {
  it("a list item's indented fence stops reading", () => {
    // The item scopes its fence; a column-0 fence after it opens a NEW block,
    // so the pairing that follows is not the reader's to guess.
    const text = '- step\n  ```\n  a\n```\nRevenue 4321\n```\nProfit was 5000.\n```';
    expect(codeRegionsOf(text)).toEqual({ regions: [], dropped: 0, stoppedAt: 7 });
  });

  it('a line that may start an HTML block stops reading', () => {
    expect(contents('<div>\n```\n</div>\n\nRevenue was 4321.\n```\n')).toEqual([]);
    expect(contents('```\na\n```\n<!--\n```\nx\n```\n-->')).toEqual(['a']);
    expect(contents('  </details>\n```\nx\n```')).toEqual([]);
    // `<` before a digit or a space starts no HTML block.
    expect(contents('<5% of rows\n```\nx\n```')).toEqual(['x']);
  });

  it('a line opening display math (`$$`) stops reading', () => {
    expect(contents('$$\n```\n$$\nRevenue 4321\n```')).toEqual([]);
  });

  it('a byte-order mark at the start: nothing is read', () => {
    expect(codeRegionsOf('\u{FEFF}```\nx\n```\ny\n```')).toEqual({
      regions: [],
      dropped: 0,
      stoppedAt: 0,
    });
  });

  it('a block whose program holds a fence run as long as its own fence is prose, and reading stops', () => {
    // A renderer laxer than CommonMark closes at "```~"; the library's own
    // wrapper never writes such a block (`fenceFor`: the longest run + 1).
    expect(codeRegionsOf('```\na\n```~\nRevenue was 4321.\n```')).toEqual({
      regions: [],
      dropped: 0,
      stoppedAt: 0,
    });
    expect(contents('```\nx = "```"\n```\ny\n```\nz\n```')).toEqual([]);
    // Four spaces do not close a block in CommonMark; a laxer renderer may.
    expect(contents('```\na\n    ```\nb\n```')).toEqual([]);
    // A shorter run, or the other character, is content.
    expect(contents('````\nx = "```"\n~~~~\n````')).toEqual(['x = "```"\n~~~~']);
  });

  it('the regions before the first such line are read', () => {
    expect(contents('```\na\n```\n\n<div>\n```\nb\n```')).toEqual(['a']);
  });

  it('inside a block none of those lines is anything but content', () => {
    const program = '  ```py\n<div>\n$$\n- item\n  ~~~';
    expect(contents(`\`\`\`\`\n${program}\n\`\`\`\``)).toEqual([program]);
  });
});
