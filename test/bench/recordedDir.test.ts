/**
 * `bench/recordedDir.mjs` — how a bench runner writes a directory into a committed result file:
 * relative to the repo when it is inside, `<scratch>/<folder>` when it is outside, never an
 * absolute path.
 *
 * Test types:
 *   - UNIT     — inside the repo is repo-relative with `/` separators and the repo itself is `.`;
 *                a folder outside is `<scratch>/<name>`; a trailing slash and `..` hops resolve
 *                first; a sibling that only shares the repo's name as a prefix is outside; a
 *                folder named `..x` inside the repo is still inside;
 *   - SECURITY — whatever the input (a session's scratch folder, a home directory, a CI runner,
 *                a hop out of the repo), the output is never absolute and carries no username,
 *                no session folder and no `..`;
 *   - DRIFT    — the three runners that record a reference build go through it, and no committed
 *                `results.json` / `report.md` under `bench/` names a local machine.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

// @ts-expect-error — a plain .mjs bench module, no types
import { OUTSIDE_REPO, recordedDir } from '../../bench/recordedDir.mjs';

const REPO = resolve(__dirname, '..', '..');
const BENCH = join(REPO, 'bench');
/** A repo root the UNIT cases name themselves, so they do not depend on where this checkout is. */
const ROOT = resolve('/work/repo');

describe('UNIT — a directory as a result file records it', () => {
  it('inside the repo: relative to the root, with / separators', () => {
    expect(recordedDir(join(ROOT, 'bench', 'time', 'runs', 'x'), ROOT)).toBe('bench/time/runs/x');
  });

  it('the repo root itself is "."', () => {
    expect(recordedDir(ROOT, ROOT)).toBe('.');
    expect(recordedDir(`${ROOT}/`, ROOT)).toBe('.');
  });

  it('a folder outside the repo is <scratch>/<its name>', () => {
    expect(recordedDir(join(ROOT, '..', 'ref-build'), ROOT)).toBe(`${OUTSIDE_REPO}/ref-build`);
    expect(OUTSIDE_REPO).toBe('<scratch>');
  });

  it('a trailing slash and .. hops are resolved before the decision', () => {
    expect(recordedDir(`${ROOT}/bench/../bench/x/`, ROOT)).toBe('bench/x');
    expect(recordedDir(`${ROOT}/../ref-build/`, ROOT)).toBe(`${OUTSIDE_REPO}/ref-build`);
  });

  it('a sibling that merely starts with the repo name is outside', () => {
    expect(recordedDir(`${ROOT}-two/x`, ROOT)).toBe(`${OUTSIDE_REPO}/x`);
  });

  it('a folder named "..x" inside the repo is still inside', () => {
    expect(recordedDir(join(ROOT, '..x'), ROOT)).toBe('..x');
  });

  it('the filesystem root, which has no folder name, is just <scratch>', () => {
    expect(recordedDir(resolve('/'), ROOT)).toBe(OUTSIDE_REPO);
  });

  it('it needs no directory to exist', () => {
    expect(recordedDir(join(ROOT, 'no', 'such', 'dir'), ROOT)).toBe('no/such/dir');
  });
});

describe('SECURITY — the machine never reaches the file', () => {
  const MACHINE_DIRS = [
    '/private/tmp/claude-501/-Users-someone-repo/0123abcd-0000-4000-8000-000000000000/scratchpad/af-vid-before',
    '/Users/someone/work/ref-build',
    '/home/ci/runner/_work/ref',
    `${ROOT}/../../etc/ref`,
    '/tmp/x',
  ];

  it.each(MACHINE_DIRS)('%s is recorded as <scratch>/<name> and nothing more', (dir) => {
    const out: string = recordedDir(dir, ROOT);
    expect(out.startsWith(`${OUTSIDE_REPO}/`)).toBe(true);
    expect(out).not.toMatch(/^[/\\]|^[A-Za-z]:/);
    expect(out).not.toMatch(/Users|home|claude-501|private|tmp|\.\./);
  });

  it('inside the repo the answer is not absolute either', () => {
    const out: string = recordedDir(join(ROOT, 'bench', 'x'), ROOT);
    expect(out).not.toMatch(/^[/\\]|^[A-Za-z]:/);
  });
});

describe('DRIFT — the runners and the committed results stay clean', () => {
  const RUNNERS = ['time/run-unread.mjs', 'time-checks/run-shift.mjs', 'time-checks/run.mjs'];

  it.each(RUNNERS)('bench/%s writes its reference build through recordedDir', (file) => {
    const source = readFileSync(join(BENCH, file), 'utf8');
    expect(source).toMatch(/(before|baseline): recordedDir\(opts\.(before|baseline) \?\? ''\)/);
    expect(source).not.toMatch(/(before|baseline):\s*resolve\(/);
  });

  const LOCAL_MACHINE =
    /\/private\/tmp\/|\/Users\/[a-z]|\/home\/[a-z]+\/|[A-Za-z]:\\{1,2}Users\\|claude-501/;

  /** Every `results.json` / `report.md` a bench run wrote under `bench/` (not the per-run `raw/`). */
  function runFilesUnder(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === 'node_modules' || entry.name === 'raw') return [];
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return runFilesUnder(path);
      return entry.name === 'results.json' || entry.name === 'report.md' ? [path] : [];
    });
  }

  it('no committed result or report under bench/ names a local machine', () => {
    const files = runFilesUnder(BENCH);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((file) => LOCAL_MACHINE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file));
    expect(offenders).toEqual([]);
  });
});
