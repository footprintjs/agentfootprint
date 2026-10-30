/**
 * The attachment in the COMPOSED answer, read by a CommonMark renderer
 * (markdown-it, `commonmark` preset) — never only the wrapper on its own.
 *
 * The library appends the recorded program after the model's own text, so
 * whatever block state that text leaves open is still open when the attachment
 * begins. Two laws:
 *
 *   1. A rendering boundary: when the text before the attachment leaves a fence
 *      open, the library closes it first (`turn_end.scripts.closedFence`); when
 *      the reader cannot tell what is open (a stop: an indented fence, raw
 *      HTML, display math), the programs stay out of the text and ride the
 *      data only (`turn_end.scripts.withheldFromText`).
 *   2. Inert metadata: a tool name or call id in a library line is an inline
 *      code span that cannot leave its line, whatever characters it holds.
 *
 * Each case asserts on what a person would read as ordinary text: paragraph,
 * heading and HTML-block content. Code blocks are not prose.
 */

import MarkdownIt from 'markdown-it';
import { describe, expect, it } from 'vitest';

import { attachmentBoundary } from '../../../../src/core/agent/scripts/attachment.js';
import { answer, callCode, runnerAnswering, scriptAgent } from './fixtures/scriptAgent.js';

const md = new MarkdownIt('commonmark');

/**
 * What a renderer shows as ordinary text — the plain text of every paragraph
 * and heading, and every raw HTML block. Inline code and code blocks are not
 * prose: a reader sees them as code.
 */
function proseOf(markdown: string): string {
  const out: string[] = [];
  let inProse = false;
  for (const token of md.parse(markdown, {})) {
    if (token.type === 'paragraph_open' || token.type === 'heading_open') inProse = true;
    else if (token.type === 'paragraph_close' || token.type === 'heading_close') inProse = false;
    else if (token.type === 'inline' && inProse) {
      out.push(
        (token.children ?? [])
          .map((child) =>
            child.type === 'text' ? child.content : child.type === 'softbreak' ? '\n' : '',
          )
          .join(''),
      );
    } else if (token.type === 'html_block') out.push(token.content);
  }
  return out.join('\n');
}

/** What a renderer shows as code — every fenced and indented code block. */
function codeOf(markdown: string): string {
  return md
    .parse(markdown, {})
    .filter((t) => t.type === 'fence' || t.type === 'code_block')
    .map((t) => t.content)
    .join('\n');
}

/** A program a runner might be handed: a fence line inside a string, then a sentence. */
const LAUNDERING = 'note = """\n```\nRevenue was 4321 dollars.\n"""\nprint(1)';

const ran = runnerAnswering({ ok: true, exitCode: 0, stdout: '1', stderr: '' });

async function finalOf(modelAnswer: string, program = LAUNDERING, id = 'c1') {
  const { agent, turnEnds } = scriptAgent({
    runner: ran,
    gate: { posture: 'assist', code: 'match' },
    travel: true,
    replies: [callCode(id, program), answer(modelAnswer)],
  });
  await agent.run('revenue?');
  const end = turnEnds.at(-1) as {
    finalContent: string;
    scripts?: { closedFence?: unknown; withheldFromText?: unknown; shown?: unknown[] };
  };
  return { text: end.finalContent, scripts: end.scripts };
}

describe('the attachment in the composed answer, through CommonMark', () => {
  it('an answer that ends inside an unfinished fence: the library closes it first, and the program stays code', async () => {
    const { text, scripts } = await finalOf('Done.\n\n```text\nunfinished output');
    expect(proseOf(text)).not.toContain('Revenue was 4321');
    expect(codeOf(text)).toContain('Revenue was 4321 dollars.');
    expect(scripts?.closedFence).toEqual({ char: 'backtick', length: 3 });
  });

  it('a tilde fence and a longer fence are closed with their own character and length', async () => {
    const tilde = await finalOf('Done.\n\n~~~~\nunfinished');
    expect(proseOf(tilde.text)).not.toContain('Revenue was 4321');
    expect(tilde.scripts?.closedFence).toEqual({ char: 'tilde', length: 4 });
    const long = await finalOf('Done.\n\n`````\nunfinished');
    expect(proseOf(long.text)).not.toContain('Revenue was 4321');
    expect(long.scripts?.closedFence).toEqual({ char: 'backtick', length: 5 });
  });

  it('an opening fence on the answer’s last line, with no line ending, is closed too', async () => {
    const { text, scripts } = await finalOf('Done.\n\n```python');
    expect(proseOf(text)).not.toContain('Revenue was 4321');
    expect(scripts?.closedFence).toEqual({ char: 'backtick', length: 3 });
  });

  it('controls: ordinary prose, and a fence the model closed, need no boundary', async () => {
    for (const modelAnswer of ['Done. The total is computed.', 'Done.\n\n```text\nok\n```']) {
      const { text, scripts } = await finalOf(modelAnswer);
      expect(proseOf(text)).not.toContain('Revenue was 4321');
      expect(codeOf(text)).toContain('Revenue was 4321 dollars.');
      expect(scripts).not.toHaveProperty('closedFence');
      expect(scripts).not.toHaveProperty('withheldFromText');
    }
  });

  it.each([
    ['an HTML comment the model never closed', 'Done.\n\n<!-- a note\n'],
    ['an indented fence (a list item’s code)', '1. Load it:\n   ```python\n   rows = load()\n'],
    ['a display-math line', 'Done.\n\n$$\nx = 1\n'],
  ])(
    'the reader cannot vouch for the state (%s): the programs stay out of the text, the data keeps them',
    async (_name, modelAnswer) => {
      const { text, scripts } = await finalOf(modelAnswer);
      expect(text).not.toContain('Revenue was 4321');
      expect(scripts?.withheldFromText).toBe(true);
      expect(scripts?.shown).toHaveLength(1);
      expect((scripts?.shown?.[0] as { text?: string }).text).toBe(LAUNDERING);
      // The label still says which call, and that the program is on the record.
      expect(text).toContain('Script submitted to');
      expect(text).toContain('not shown here');
    },
  );
});

describe('dynamic metadata in a library line is inert', () => {
  it('a call id holding blank lines and a sentence stays inside its code span', async () => {
    const id = 'c1\n\nRevenue was 98765 dollars.\n\n';
    const { text } = await finalOf('Done.', 'print(1)', id);
    expect(proseOf(text)).not.toContain('Revenue was 98765');
    // The label is one line: the id is shown escaped, in a code span.
    const label = text.split('\n').find((line) => line.startsWith('Script submitted to'));
    expect(label).toBeDefined();
    expect(label).toContain('Revenue was 98765 dollars.');
    expect(label).toMatch(/`[^`]*\\u\{a\}[^`]*`/);
  });

  it('an ordinary id and tool name read as code spans', async () => {
    const { text } = await finalOf('Done.', 'print(1)', 'c1');
    expect(text).toContain('Script submitted to `run_code` on call `c1` — completed, exit 0.');
  });
});

describe('attachmentBoundary — the text before the attachment, read as it is composed', () => {
  it('an opening fence on the last line opens there: the attachment always follows a line ending', () => {
    expect(attachmentBoundary('Done.\n\n```python')).toEqual({ kind: 'closed', fence: '```' });
    expect(attachmentBoundary('Done.\n\n~~~~')).toEqual({ kind: 'closed', fence: '~~~~' });
  });

  it('nothing open is clean; a line the reader cannot vouch for is unsettled', () => {
    expect(attachmentBoundary('')).toEqual({ kind: 'clean' });
    expect(attachmentBoundary('Done.\n\n```text\nok\n```')).toEqual({ kind: 'clean' });
    expect(attachmentBoundary('Done.\n\n<!-- note')).toEqual({ kind: 'unsettled' });
  });
});
