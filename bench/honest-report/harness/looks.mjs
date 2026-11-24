/**
 * bench/honest-report/harness/looks.mjs — the log of every look at a closed set's rows
 * (RULE.md § 9).
 *
 * Why it lives in the run folder, not in this checkout: the closed set's rows never land inside
 * the checkout, and neither does the record of who opened them. Every command that opens a pack
 * run's rows (`run.mjs`, `judge.mjs`, `reread.mjs`, `score.mjs`, the sheets) appends one line
 * here. Opening a raw file by hand goes around it, which RULE.md § 9 says plainly.
 *
 * Example: `logLook(dir, { command: 'score', set: 'closed-1', setDigest: '…' })` appends
 * `{ "date": "…", "command": "score", "set": "closed-1", "setDigest": "…", "commit": "<HEAD>" }`.
 */

import { execFileSync } from 'node:child_process';
import { appendFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
export const LOOKS_FILE = 'closed-looks.jsonl';

/** This checkout's commit, or `unknown` outside a git checkout. */
function headCommit() {
  try {
    return execFileSync('git', ['-C', HERE, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

/** Appends one look to `<dir>/closed-looks.jsonl`. */
export function logLook(dir, { command, set, setDigest }) {
  appendFileSync(join(dir, LOOKS_FILE), `${JSON.stringify({ date: new Date().toISOString(), command, set, setDigest, commit: headCommit() })}\n`);
}
