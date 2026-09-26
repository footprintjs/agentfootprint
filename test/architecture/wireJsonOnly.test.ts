/**
 * EVERY SERIALIZER OF THE EVENT RECORD GOES THROUGH THE WIRE RULE.
 *
 * `lib/wireJson.ts · toWireJson` writes an `Error` as its name, message, code
 * and cause — never the custom properties a client library hangs on it (an
 * axios error's `config.headers.authorization`) and never its stack. A plain
 * `JSON.stringify` of an event, a payload or a recording writes them. The
 * round-4 recheck found three such serializers the round-2 fix had missed
 * (`toSSE`, the recording artifact, the recording file sink), so this guard
 * scans the modules that serialize the record and refuses a direct
 * `JSON.stringify` there unless it is on the allow-list below, with a reason.
 *
 * The scanned modules: sinks and adapters that ship events
 * (`adapters/observability/`, `strategies/`), the browser stream
 * (`stream.ts`), everything that builds or files a recording
 * (`recorders/`, `artifacts/recordingArtifact.ts`, `lib/bug-report/`), and
 * the causal-memory evidence recorder (it persists live recorder values).
 *
 * Adding a serializer: use `toWireJson`. Adding a `JSON.stringify` that does
 * NOT serialize an event, payload or recording (a value quoted in an error
 * message, say): raise the file's count here and say why.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(__dirname, '..', '..');

const SCANNED_DIRS = [
  'src/adapters/observability',
  'src/strategies',
  'src/recorders',
  'src/lib/bug-report',
];
const SCANNED_FILES = [
  'src/stream.ts',
  'src/artifacts/recordingArtifact.ts',
  'src/memory/causal/evidenceRecorder.ts',
];

/** File → how many direct `JSON.stringify(` calls it may make, and why. */
const ALLOWED: Readonly<Record<string, { readonly count: number; readonly why: string }>> = {
  'src/adapters/observability/githubBugReporter.ts': {
    count: 1,
    why: 'the GitHub REST request body (commit message + a base64 zip the bundle already built with toWireJson)',
  },
  'src/recorders/observability/fileRecordingSink.ts': {
    count: 2,
    why: 'a run id and a directory quoted inside refusal messages — not the record',
  },
  'src/recorders/observability/recordingEnvelope.ts': {
    count: 5,
    why: 'stated option values quoted inside refusal messages — not the record',
  },
};

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (full.endsWith('.ts')) out.push(full);
  }
  return out;
}

/** Direct calls outside comments. */
function directCalls(source: string): number {
  const code = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, ''))
    .join('\n');
  return (code.match(/JSON\.stringify\(/g) ?? []).length;
}

function scanned(): string[] {
  return [
    ...SCANNED_DIRS.flatMap((dir) => walk(join(ROOT, dir))),
    ...SCANNED_FILES.map((file) => join(ROOT, file)),
  ].map((file) => relative(ROOT, file));
}

describe('wire rule — no direct JSON.stringify where the event record is serialized', () => {
  it('every direct call in a scanned module is on the allow-list, and no file exceeds its count', () => {
    const found = scanned()
      .map((file) => ({ file, calls: directCalls(readFileSync(join(ROOT, file), 'utf8')) }))
      .filter(({ calls }) => calls > 0);
    const over = found
      .filter(({ file, calls }) => calls > (ALLOWED[file]?.count ?? 0))
      .map(
        ({ file, calls }) =>
          `${file}: ${calls} direct JSON.stringify call(s), ${ALLOWED[file]?.count ?? 0} allowed`,
      );
    expect(
      over,
      'use toWireJson (lib/wireJson.ts), or allow-list a non-record use with its reason',
    ).toEqual([]);
  });

  it('the allow-list is exact — a stale entry is refused too', () => {
    for (const [file, allowed] of Object.entries(ALLOWED)) {
      expect(directCalls(readFileSync(join(ROOT, file), 'utf8')), file).toBe(allowed.count);
    }
  });

  it('the scan finds a planted call (the guard is not vacuous)', () => {
    expect(directCalls('const x = JSON.stringify(event); // JSON.stringify(ignored)')).toBe(1);
    expect(directCalls('/* JSON.stringify(a) */ toWireJson(b)')).toBe(0);
  });
});
