/**
 * The release's own housekeeping of `.file-size-baseline.json`.
 *
 * The file-size check (footprintjs/ci · docs/FILE-SIZE.md) holds an oversized file to the
 * smaller of its stored entry and its size at the previous commit, so a pull request that
 * shortens a file needs no edit here and pull requests no longer conflict on this file.
 * The stored entry is what bounds a slip the previous commit cannot see (two pull requests
 * merged without a recheck), so one actor, the release, writes each entry back down to the
 * file's measured size and drops entries for files now at most the limit or gone.
 * An entry is never raised here: a file larger than its entry is the check's to refuse.
 *
 * `LIMIT` and `lineCount` repeat the check's own rule (footprintjs/ci at the commit ci.yml pins,
 * `src/file-size/policy.mjs` and `git-tree.mjs`). Re-read them when that pin moves.
 */
const LIMIT = 600;

/** Physical lines as the check counts them: LF-terminated, plus a non-empty unterminated last line. */
export function lineCount(bytes) {
  let count = 0;
  for (const byte of bytes) if (byte === 10) count++;
  return count + (bytes.length > 0 && bytes[bytes.length - 1] !== 10 ? 1 : 0);
}

/**
 * The baseline text with every entry tightened. `sizeOf(path)` returns the file's line count,
 * or `undefined` when it does not exist. Returns `undefined` when nothing changes, so an
 * already-tight baseline keeps its bytes.
 */
export function tightenedBaseline(text, sizeOf) {
  const baseline = JSON.parse(text);
  const files = {};
  let changed = false;
  for (const [path, cap] of Object.entries(baseline.files)) {
    const lines = sizeOf(path);
    if (lines === undefined || lines <= LIMIT) changed = true;
    else if (lines < cap) (files[path] = lines), (changed = true);
    else files[path] = cap;
  }
  return changed ? `${JSON.stringify({ ...baseline, files }, null, 2)}\n` : undefined;
}
