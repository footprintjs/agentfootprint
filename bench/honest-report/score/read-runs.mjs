/**
 * bench/honest-report/score/read-runs.mjs — reads a run folder written by `run.mjs`: its plan,
 * its run lines, and each raw record, one at a time (a full recording is large; the scorer keeps
 * a raw record without it, the re-reader asks for it).
 *
 * Example: `readRunFolder(dir).raws()` → an iterator of raw records without `recording`.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';

import { RAW_SCHEMA } from '../harness/one-run.mjs';

/** Lines of a `.jsonl` file (none when it does not exist). */
export function readJsonl(file) {
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => l.trim() !== '')
    .map((l) => JSON.parse(l));
}

export function readRunFolder(dir) {
  const { config, plan } = JSON.parse(readFileSync(join(dir, 'plan.json'), 'utf8'));
  const lines = readJsonl(join(dir, 'runs.jsonl'));
  const files = existsSync(join(dir, 'raw')) ? readdirSync(join(dir, 'raw')).filter((f) => f.endsWith('.json.gz')).sort() : [];
  function* raws({ withRecording = false } = {}) {
    for (const f of files) {
      const raw = JSON.parse(gunzipSync(readFileSync(join(dir, 'raw', f))).toString('utf8'));
      if (raw.schema !== RAW_SCHEMA) throw new Error(`${f}: not a ${RAW_SCHEMA} record`);
      if (!withRecording) delete raw.recording;
      yield raw;
    }
  }
  return { config, plan, lines, files, raws };
}
