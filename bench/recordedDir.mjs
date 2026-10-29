/**
 * bench/recordedDir.mjs — how a bench runner writes a DIRECTORY into a committed result file
 * (the reference build a run compared against: `--before` / `--baseline`).
 *
 * A committed result must not name the machine it ran on, and no part of a path outside this repo
 * is safe to keep: not the username, not a session's scratch folder, and not even the last folder
 * name, which can itself be the private part (`/Users/<person>`, `/tmp/<session>`). So a directory
 * inside this repo is written relative to the repo root (`bench/time/runs/x`, always with `/`),
 * and any other one — a reference build checked out beside the repo or in a temp folder — as the
 * constant `<outside-repo>`, with nothing of its path. The build itself is named by the commit the
 * registered rule states.
 *
 * Pinned by `test/bench/recordedDir.test.ts` (the rule, the three runners that use it, and every
 * committed `results.json` / `report.md`).
 */
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/** The repo root: this file sits directly in `bench/`. */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** What stands in for any folder outside the repo: one constant, no part of its path. */
export const OUTSIDE_REPO = '<outside-repo>';

/**
 * `dir` as a result file records it: `.` for the repo root itself, a `/`-separated path relative
 * to `root` inside it, else `<outside-repo>`. `dir` may be relative (to the working directory) and
 * need not exist. `root` is the repo root, except where a test names another.
 */
export function recordedDir(dir, root = REPO_ROOT) {
  const rel = relative(root, resolve(dir));
  if (rel === '') return '.';
  const outside = rel.split(sep)[0] === '..' || isAbsolute(rel);
  return outside ? OUTSIDE_REPO : rel.split(sep).join('/');
}
