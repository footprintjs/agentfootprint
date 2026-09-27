/**
 * The Tools page prints what the model reads from each result helper — and
 * says it was captured. This holds it to that.
 *
 * `docs-next/content/docs/build/tools.mdx` · "What `execute` returns" shows
 * three JSON blocks: what the MODEL read when one `execute` returned
 * `describedResult()`, `coverage()` and `absent()`. The page claims they were
 * captured from example 66's run, so they are compared here against a fresh
 * capture from that example (`modelViews()`, the real loop with a mock
 * provider). Whitespace is the page's own (pretty-printed for reading); keys,
 * key order and every value — the static notes included — must be the bytes
 * the model reads. If a note, a projection or the example changes, this fails
 * and the page is re-captured rather than left describing a model view that
 * no longer exists.
 */

import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { modelViews } from '../../examples/features/66-semantic-envelope.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const PAGE = join(ROOT, 'docs-next/content/docs/build/tools.mdx');

/** The `json` blocks of the page's "What `execute` returns" section, by title. */
function capturedBlocks(): Map<string, string> {
  const page = readFileSync(PAGE, 'utf8');
  const start = page.indexOf('## What `execute` returns');
  const end = page.indexOf('\n## ', start + 1);
  expect(start).toBeGreaterThan(-1);
  const section = page.slice(start, end);
  const blocks = new Map<string, string>();
  for (const m of section.matchAll(/```json title="([^"]+)"\n([\s\S]*?)\n```/g)) {
    blocks.set(m[1]!, m[2]!);
  }
  return blocks;
}

describe('docs: the Tools page prints the model view it says it captured', () => {
  it('finds the three blocks — one per helper', () => {
    expect([...capturedBlocks().keys()]).toEqual([
      'describedResult — two rows found',
      'coverage — a one-line verdict',
      'absent — nothing matched',
    ]);
  });

  it('each block is the exact JSON the model read in example 66', async () => {
    const views = await modelViews();
    const blocks = capturedBlocks();
    const same = (title: string, captured: string): void => {
      const printed = blocks.get(title);
      expect(printed, title).toBeDefined();
      expect(JSON.stringify(JSON.parse(printed!)), title).toBe(captured);
    };
    same('describedResult — two rows found', views.described);
    same('coverage — a one-line verdict', views.covered);
    same('absent — nothing matched', views.absent);
  });

  it('the page is honest about the three differences it names', async () => {
    const views = await modelViews();
    // describedResult keeps its `checked` list on the record; the other two serve theirs.
    expect(views.described).not.toContain('"checked"');
    expect(views.covered).toContain('"checked"');
    expect(views.absent).toContain('"checked"');
    // measured_at is the export's own time — taken from the data.
    expect(views.described).toContain('"measured_at":"2026-08-19T10:12:00Z"');
  });
});
