/**
 * DOCUMENTED DOORS — the door list in CLAUDE.md against the one in package.json.
 *
 * `package.json` `exports` is EXHAUSTIVE: a subpath that is not in the map does
 * not resolve, in any bundler, at all. So a doc that names a door the map does
 * not publish is not a stale detail — it is the very first line a third-party
 * author writes, and it fails to import. CLAUDE.md drifted exactly that way:
 * through 9.38.0 its Module-map line named thirteen paths that 9.0.0 had
 * removed, and did not name five that exist. Worse, it framed the wrong list as
 * a correction to "older docs", so it read as freshly verified.
 *
 * A correction alone would rot again on the next door. This file is the part
 * that makes it stay true.
 *
 * ── What is pinned ────────────────────────────────────────────────────
 *
 *   1. The doors CLAUDE.md names === the subpaths `package.json` publishes.
 *      Set equality in BOTH directions: a documented-but-unpublished door is
 *      the import that fails; a published-but-undocumented one is the door
 *      nobody finds.
 *   2. Every path CLAUDE.md lists as REMOVED is in fact absent from `exports`.
 *      The same sentence that corrects the list also claims sixteen paths are
 *      gone; an unchecked claim about absence is how the first list went wrong.
 *
 * ── Why source text, and why the markers are asserted first ───────────
 *
 * There is no machine-readable copy of the prose to diff against — the prose IS
 * the artifact that misleads a reader, so the prose is what has to be read. The
 * failure mode of a text-scraping test is passing VACUOUSLY after someone
 * rewords the line: an extractor that finds nothing agrees with everything. So
 * the markers and the minimum counts are asserted before the comparison, and a
 * reworded line fails loudly asking to be re-taught rather than going quiet.
 *
 * This is the DOC half of the pin. `subpath-exports.test.ts` is the manifest
 * half (the two package.json tables, and identity of each absorbed barrel's
 * symbols); it never opens a doc, and this file never opens a `.d.ts`.
 */

import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const REPO_ROOT = join(__dirname, '../..');

/** The sentence that separates "what exists now" from "what 9.0.0 removed". */
const REMOVED_MARKER = '9.0.0 removed sixteen older paths';
const DOORS_MARKER = 'Entry points';

function claudeMd(): string {
  return readFileSync(join(REPO_ROOT, 'CLAUDE.md'), 'utf-8');
}

function publishedSubpaths(): string[] {
  const pkg = JSON.parse(readFileSync(join(REPO_ROOT, 'package.json'), 'utf-8')) as {
    exports: Record<string, unknown>;
  };
  // `./package.json` is a Node convention for reading one's own manifest, not a
  // door a consumer imports code from — subpath-exports.test.ts pins it as such.
  return Object.keys(pkg.exports)
    .filter((k) => k !== './package.json')
    .sort();
}

/** The Module-map line that lists the doors, split at the removed-paths clause. */
function entryPointsLine(): { readonly current: string; readonly removed: string } {
  const line = claudeMd()
    .split('\n')
    .find((l) => l.startsWith(DOORS_MARKER));
  expect(
    line,
    `CLAUDE.md has no line starting "${DOORS_MARKER}" — if the door list moved, ` +
      `re-point this test at it rather than deleting it`,
  ).toBeDefined();
  const at = line!.indexOf(REMOVED_MARKER);
  expect(
    at,
    `the entry-points line no longer contains "${REMOVED_MARKER}", so this test ` +
      `cannot tell a live door from a removed one`,
  ).toBeGreaterThan(-1);
  return { current: line!.slice(0, at), removed: line!.slice(at) };
}

/**
 * Backticked import paths, in `package.json` spelling.
 *
 * A door is written `` `/observe` `` in the prose and `"./observe"` in the map;
 * the root is `` `.` `` in both. Nothing else in the line can match: every other
 * backticked token there is a symbol or a filename, and neither starts with a
 * slash or is a bare dot.
 */
function documentedPaths(segment: string): string[] {
  const found = new Set<string>();
  for (const [, path] of segment.matchAll(/`(\.|\/[A-Za-z0-9][A-Za-z0-9/-]*)`/g)) {
    found.add(path === '.' ? '.' : `.${path}`);
  }
  return [...found].sort();
}

describe('CLAUDE.md documents exactly the doors package.json publishes', () => {
  it('the extractor finds a plausible list at all (a silent scrape passes everything)', () => {
    const { current, removed } = entryPointsLine();
    expect(documentedPaths(current).length, 'no doors extracted from the doc line').toBeGreaterThan(
      5,
    );
    expect(
      documentedPaths(removed).length,
      'no removed paths extracted from the doc line',
    ).toBeGreaterThan(5);
  });

  it('names every published subpath, and not one that is unpublished', () => {
    const documented = documentedPaths(entryPointsLine().current);
    const published = publishedSubpaths();
    // One assertion, both directions: the diff in the failure output names the
    // door that was invented and the door that was forgotten in one read.
    expect(documented, 'CLAUDE.md door list has drifted from package.json exports').toEqual(
      published,
    );
  });

  it('the count it claims out loud matches the count it lists', () => {
    // The line says "THIRTEEN doors" in words. A reader skimming trusts the
    // word over the list, so the word is pinned too.
    expect(entryPointsLine().current).toContain('THIRTEEN');
    expect(documentedPaths(entryPointsLine().current)).toHaveLength(13);
  });
});

describe('the paths CLAUDE.md calls removed really are gone', () => {
  const removedPaths = documentedPaths(entryPointsLine().removed);

  it('the removed list is the sixteen it says it is', () => {
    expect(removedPaths).toHaveLength(16);
  });

  for (const path of removedPaths) {
    it(`${path} is absent from package.json exports`, () => {
      expect(
        publishedSubpaths(),
        `CLAUDE.md says ${path} was removed in 9.0.0, but exports publishes it`,
      ).not.toContain(path);
    });
  }
});
