/**
 * The honesty-layer design folder (docs/design/honesty/) keeps its own promises.
 *
 * WHY A TEST. The folder is the one home of the honesty layers' design: the
 * architecture note (README.md), the decisions page, and one page per layer.
 * Every step of the plan edits these pages (README.md § 7, "Every step's
 * checklist"), and several steps may edit them in one night. The pages link to
 * each other and to the dated pages beside them, and a page that is renamed or
 * moved breaks those links without a sound — step 0 found every cross-reference
 * of the reviewed drafts pointing at a scratch file name this folder does not
 * have.
 *
 * WHAT A GREEN RUN PROVES:
 *   - every page the README's page table lists exists;
 *   - every relative link on every page lands on a file in the repo;
 *   - no page cites code by line number (the house law is `file · symbol`), and
 *     no page carries a local absolute path;
 *   - each layer page states its law in the README's own words (README.md
 *     § 5.5, "The one-sentence laws") and ends with "What … lets you measure"
 *     (the owner's framing, item 4, on decisions.md);
 *   - the decisions page carries the adoption markers (the 43 answers of
 *     2026-09-27, and Q44 of 2026-09-28) and answers Q1–Q44 once each.
 *
 * WHAT IT DOES NOT PROVE: that a `file · symbol` pointer on these pages still
 * resolves. The pages cite code that later steps create, so, like the rest of
 * docs/design/, they are records and stay out of
 * test/architecture/citations.test.ts; a layer's live pointers belong in its
 * src/ folder README. Nor does it prove a sentence is true — that is review.
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const FOLDER = join(ROOT, 'docs', 'design', 'honesty');

/** The layer pages, keyed by the name README.md § 5.5 gives each law. */
const LAYER_PAGES: Readonly<Record<string, string>> = {
  Choice: 'choice.md',
  Inputs: 'inputs.md',
  Results: 'results.md',
  Answer: 'answer.md',
};

const ADOPTION_MARKER = "Adopted overnight 2026-09-27 on the owner's go; the owner may overturn.";
/** Q44, reopened by the step-5 bench and adopted the same way a night later. */
const LATER_ADOPTION_MARKER = "Adopted overnight 2026-09-28 on the owner's go";

/** The banned citation form, as test/architecture/citations.test.ts spells it. */
const LINE_CITATION = /[A-Za-z0-9_.\-/]+\.(?:ts|tsx|md):\d+/;
const LOCAL_PATH = /\/Users\/|\/private\/tmp\/|\/home\/[a-z]/;

function read(page: string): string {
  return readFileSync(join(FOLDER, page), 'utf8');
}

function pagesOnDisk(): string[] {
  return readdirSync(FOLDER)
    .filter((f) => f.endsWith('.md'))
    .sort();
}

/** The page with its fenced code blocks removed: a link or heading in a sample is not one. */
function prose(md: string): string {
  const kept: string[] = [];
  let fence: string | null = null;
  for (const line of md.split('\n')) {
    const marker = /^\s*(`{3,}|~{3,})/.exec(line)?.[1];
    if (fence === null) {
      if (marker) fence = marker;
      else kept.push(line);
    } else if (marker && marker[0] === fence[0] && marker.length >= fence.length) {
      fence = null;
    }
  }
  return kept.join('\n');
}

/** Whitespace collapsed, so a sentence wrapped across lines still matches. */
function flat(text: string): string {
  return text.replace(/\s+/g, ' ');
}

/** Targets of `[text](target)` links that are paths: no scheme, not a bare anchor. */
function relativeLinks(md: string): string[] {
  const out: string[] = [];
  for (const m of prose(md).matchAll(/\]\(([^)\s]+)\)/g)) {
    const target = m[1]!;
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    out.push(target.split('#')[0]!);
  }
  return out;
}

/** The README's page table — rows `| [x.md](x.md) | … |`, inside its status block. */
function listedPages(): string[] {
  const out: string[] = [];
  for (const line of read('README.md').split('\n')) {
    const m = /^>?\s*\|\s*\[[^\]]+\]\(([^)#\s]+\.md)\)\s*\|/.exec(line);
    if (m) out.push(m[1]!);
  }
  return out;
}

/** README.md § 5.5's one-sentence laws, by layer name. */
function laws(): Map<string, string> {
  const text = read('README.md');
  const start = text.indexOf('The one-sentence laws:');
  const block = text.slice(start, text.indexOf('\n\n', start));
  const out = new Map<string, string>();
  for (const item of block.split(/\n(?=- \*)/)) {
    const m = /^- \*(\w+):\* ([\s\S]+)$/.exec(item);
    if (m) out.set(m[1]!, flat(m[2]!).trim());
  }
  return out;
}

/** The last level-2 heading of a page, outside code. */
function lastSection(md: string): string {
  const headings = prose(md)
    .split('\n')
    .filter((line) => line.startsWith('## '));
  return headings[headings.length - 1] ?? '';
}

describe('docs/design/honesty — the folder keeps its own promises', () => {
  it('holds every page the README lists, and the list names the decisions and all four layers', () => {
    const listed = listedPages();
    expect(listed).toEqual(
      expect.arrayContaining(['README.md', 'decisions.md', ...Object.values(LAYER_PAGES)]),
    );
    for (const page of listed) {
      expect(
        existsSync(join(FOLDER, page)),
        `README lists ${page}, which is not in the folder`,
      ).toBe(true);
    }
  });

  for (const page of pagesOnDisk()) {
    it(`${page}: every relative link lands on a file`, () => {
      const links = relativeLinks(read(page));
      for (const target of links) {
        expect(existsSync(resolve(FOLDER, target)), `${page} links to ${target}`).toBe(true);
      }
    });

    it(`${page}: cites code by symbol, never by line, and carries no local path`, () => {
      const text = read(page);
      expect(LINE_CITATION.exec(text)?.[0], `${page} cites a line number`).toBeUndefined();
      expect(LOCAL_PATH.exec(text)?.[0], `${page} carries a local path`).toBeUndefined();
    });
  }

  it('the README states one law per layer — a silently empty parse would pass every page', () => {
    expect([...laws().keys()].sort()).toEqual(Object.keys(LAYER_PAGES).sort());
  });

  for (const [layer, page] of Object.entries(LAYER_PAGES)) {
    it(`${page} states the ${layer.toLowerCase()} law in the README's words`, () => {
      const law = laws().get(layer)!;
      expect(flat(read(page)).includes(law), `${page} does not state: ${law}`).toBe(true);
    });

    it(`${page} ends with what the ${layer.toLowerCase()} layer lets you measure`, () => {
      expect(lastSection(read(page))).toMatch(/lets you measure/i);
    });
  }

  it('the decisions page carries the adoption markers and answers Q1–Q44 once each', () => {
    const text = read('decisions.md');
    expect(text.includes(ADOPTION_MARKER), 'the adoption marker is missing').toBe(true);
    expect(text.includes(LATER_ADOPTION_MARKER), 'Q44’s adoption marker is missing').toBe(true);
    const numbers: number[] = [];
    for (const line of text.split('\n')) {
      const m = /^\|\s*Q(\d+)\s*\|/.exec(line);
      if (!m) continue;
      numbers.push(Number(m[1]));
      const answer = (line.split('|')[3] ?? '').trim();
      expect(answer.length, `Q${m[1]} has no answer`).toBeGreaterThan(0);
    }
    expect(numbers).toEqual(Array.from({ length: 44 }, (_, i) => i + 1));
  });
});
