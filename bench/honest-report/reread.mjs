/**
 * bench/honest-report/reread.mjs — the second reading, with no model (RULE.md § 12): the saved
 * full recordings of a run folder, read again by ANOTHER library build and that build's warning
 * table. It writes `reread-<commit8>.jsonl` (one line per run: the run key, the reader's commit
 * and the S2 / S3 facts it read); `score.mjs` then prints the paired counts beside the run's own.
 *
 *   node bench/honest-report/reread.mjs --runs <dir> --build <a built checkout>
 *
 * S1 is not read again: it is what that run delivered. A reader commit with no warning table is
 * refused before anything is read.
 */

import { writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { loadBuild } from './harness/build.mjs';
import { readS2, readS3 } from './harness/surfaces.mjs';
import { warningTableFor } from './rule-tables.mjs';
import { readRunFolder } from './score/read-runs.mjs';

/** The facts one build reads from one saved run. S1 is carried over unchanged, marked as such. */
export function rereadRun(doors, raw) {
  const events = raw.recording?.events ?? [];
  return { S1: { ...raw.surfaces.S1, carriedOver: true }, S2: readS2(events), S3: readS3(doors, raw.recording) };
}

async function main() {
  const argv = process.argv.slice(2);
  const o = {};
  for (let i = 0; i < argv.length; i += 2) {
    if (!['--runs', '--build'].includes(argv[i]) || argv[i + 1] === undefined) throw new Error('usage: --runs <dir> --build <checkout>');
    o[argv[i].slice(2)] = argv[i + 1];
  }
  if (o.runs === undefined || o.build === undefined) throw new Error('usage: --runs <dir> --build <checkout>');
  const build = await loadBuild(o.build, 'R');
  if (warningTableFor(build.commit) === undefined) throw new Error(`reader commit ${build.commit.slice(0, 8)} has no warning table (RULE.md § 7): write one first`);
  const dir = resolve(o.runs);
  const lines = [];
  for (const raw of readRunFolder(dir).raws({ withRecording: true })) lines.push({ runKey: raw.runKey, commit: build.commit, surfaces: rereadRun(build.doors, raw) });
  const file = join(dir, `reread-${build.commit.slice(0, 8)}.jsonl`);
  writeFileSync(file, lines.map((l) => JSON.stringify(l)).join('\n') + '\n');
  process.stdout.write(`re-read ${lines.length} runs with ${build.commit.slice(0, 8)} → ${file}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`honest-report reread: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
