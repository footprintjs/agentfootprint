/**
 * bench/recordedDir.mjs — how a bench runner writes a DIRECTORY into a committed result file
 * (the reference build a run compared against: `--before` / `--baseline`).
 *
 * A committed result must not name the machine it ran on: not a username, not a session's
 * scratch folder. So a directory inside this repo is written relative to the repo root
 * (`bench/time/runs/x`, always with `/`), and any other one — a reference build checked out beside
 * the repo or in a temp folder — as `<scratch>/` plus its folder name. The absolute path is never
 * recorded; the build itself is named by the commit the registered rule states.
 *
 * Pinned by `test/bench/recordedDir.test.ts` (the rule, the three runners that use it, and every
 * committed `results.json` / `report.md`).
 */
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root: this file sits directly in `bench/`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What stands in for "a folder outside the repo". */
export const OUTSIDE_REPO = '<scratch>';

/**
 * `dir` as a result file records it: `.` for the repo root itself, a `/`-separated path relative
 * to `root` inside it, else `<scratch>/<folder name>`. `dir` may be relative (to the working
 * directory) and need not exist. `root` is the repo root, except where a test names another.
 */
export function recordedDir(dir, root = REPO_ROOT) {
  const abs = resolve(dir);
  const rel = relative(root, abs);
  if (rel === '') return '.';
  const outside = rel.split(sep)[0] === '..' || isAbsolute(rel);
  if (!outside) return rel.split(sep).join('/');
  const name = basename(abs);
  return name === '' ? OUTSIDE_REPO : `${OUTSIDE_REPO}/${name}`;
}
