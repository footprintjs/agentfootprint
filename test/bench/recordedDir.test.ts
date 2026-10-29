/**
 * `bench/recordedDir.mjs` — how a bench runner writes a directory into a committed result file:
 * relative to the repo when it is inside, the constant `<outside-repo>` when it is outside. Never
 * an absolute path, and never any part of an outside path: its last folder name can itself be the
 * private part (a home directory named after a person, a temp folder named after a session).
 *
 * Test types:
 *   - UNIT     — inside the repo is repo-relative with `/` separators and the repo itself is `.`;
 *                a folder outside is exactly `<outside-repo>`; a trailing slash and `..` hops
 *                resolve first; a sibling that only shares the repo's name as a prefix is
 *                outside; a folder named `..x` inside the repo is still inside;
 *   - SECURITY — no part of an outside path survives: a home directory named after a person, a
 *                temp folder named after a session, a CI runner, a hop out of the repo and a
 *                session's scratch folder all give the same constant, and many different outside
 *                folders give ONE value, so the answer cannot depend on the path;
 *   - DRIFT    — the three runners that record a reference build go through it; every committed
 *                `results.json` records its reference build as the constant or a repo-relative
 *                path; no committed `results.json` / `report.md` under `bench/` names a local
 *                machine.
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

  it('a folder outside the repo is exactly the constant <outside-repo>', () => {
    expect(recordedDir(join(ROOT, '..', 'ref-build'), ROOT)).toBe(OUTSIDE_REPO);
    expect(OUTSIDE_REPO).toBe('<outside-repo>');
  });

  it('a trailing slash and .. hops are resolved before the decision', () => {
    expect(recordedDir(`${ROOT}/bench/../bench/x/`, ROOT)).toBe('bench/x');
    expect(recordedDir(`${ROOT}/../ref-build/`, ROOT)).toBe(OUTSIDE_REPO);
  });

  it('a sibling that merely starts with the repo name is outside', () => {
    expect(recordedDir(`${ROOT}-two/x`, ROOT)).toBe(OUTSIDE_REPO);
  });

  it('a folder named "..x" inside the repo is still inside', () => {
    expect(recordedDir(join(ROOT, '..x'), ROOT)).toBe('..x');
  });

  it('the filesystem root is outside', () => {
    expect(recordedDir(resolve('/'), ROOT)).toBe(OUTSIDE_REPO);
  });

  it('it needs no directory to exist', () => {
    expect(recordedDir(join(ROOT, 'no', 'such', 'dir'), ROOT)).toBe('no/such/dir');
    expect(recordedDir(join(ROOT, '..', 'no', 'such', 'dir'), ROOT)).toBe(OUTSIDE_REPO);
  });
});

describe('SECURITY — no part of an outside path reaches the file', () => {
  it('a home directory named after a person gives the constant, not the name', () => {
    expect(recordedDir('/Users/example-person', ROOT)).toBe(OUTSIDE_REPO);
  });

  it('a temp folder named after a session gives the constant, not the name', () => {
    expect(recordedDir('/tmp/7e87e208-session-private', ROOT)).toBe(OUTSIDE_REPO);
  });

  const OUTSIDE_DIRS = [
    '/private/tmp/claude-501/-Users-someone-repo/0123abcd-0000-4000-8000-000000000000/scratchpad/ref-build',
    '/Users/someone/work/ref-build',
    '/home/ci/runner/_work/ref',
    `${ROOT}/../../etc/ref`,
    '/tmp/x',
  ];

  it.each(OUTSIDE_DIRS)('%s is recorded as the constant and nothing more', (dir) => {
    expect(recordedDir(dir, ROOT)).toBe(OUTSIDE_REPO);
  });

  it('the answer cannot depend on the outside path: many different folders give ONE value', () => {
    const roots = ['/Users', '/home', '/tmp', '/private/tmp', '/var/folders'];
    const many = Array.from(
      { length: 40 },
      (_, i) => `${roots[i % roots.length]}/name-${(i * 7919).toString(36)}/deep/${i}`,
    );
    expect([...new Set(many.map((dir) => recordedDir(dir, ROOT)))]).toEqual([OUTSIDE_REPO]);
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

  it('every committed run records its reference build as the constant or a repo-relative path', () => {
    const recorded = runFilesUnder(BENCH)
      .filter((file) => file.endsWith('results.json'))
      .flatMap((file) => {
        const config = JSON.parse(readFileSync(file, 'utf8')).config ?? {};
        return ['before', 'baseline']
          .filter((field) => field in config)
          .map((field) => ({
            where: `${relative(REPO, file)} config.${field}`,
            value: config[field],
          }));
      });
    expect(recorded.length).toBeGreaterThan(0);
    for (const { where, value } of recorded) {
      // the constant, or a plain path inside the repo: no other marker (`<scratch>/<name>` would
      // keep a folder name), nothing absolute, no `..` hop out of the repo
      const plain =
        typeof value === 'string' &&
        !/[<>:\\]/.test(value) &&
        !value.startsWith('/') &&
        !value.split('/').includes('..');
      expect(value === OUTSIDE_REPO || plain, `${where} = ${JSON.stringify(value)}`).toBe(true);
    }
  });

  it('no committed result or report under bench/ names a local machine', () => {
    const files = runFilesUnder(BENCH);
    expect(files.length).toBeGreaterThan(0);
    const offenders = files
      .filter((file) => LOCAL_MACHINE.test(readFileSync(file, 'utf8')))
      .map((file) => relative(REPO, file));
    expect(offenders).toEqual([]);
  });
});
