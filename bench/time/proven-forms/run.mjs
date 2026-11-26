import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { isDeepStrictEqual } from 'node:util';
import { buildSync } from 'esbuild';
import { cells, processZones } from './manifest.mjs';
import { verify } from './verify.mjs';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = fileURLToPath(new URL('../../../', import.meta.url));
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const expected = JSON.parse(readFileSync(join(here, 'identity.json')));
const manifest = processZones.flatMap(cells);
const tmp = mkdtempSync(join(tmpdir(), 'af-ruler-'));
try {
  if (git('status', '--porcelain', '--', 'src/time', 'test/time/fixtures/rulerTool.ts')) {
    throw new Error('The reader and ruler must match their committed source.');
  }
  const worker = join(tmp, 'measure.cjs');
  buildSync({ entryPoints: [join(here, 'measure.mjs')], outfile: worker, bundle: true,
    platform: 'node', format: 'cjs', packages: 'external', treeShaking: true, logOverride: { 'ignored-bare-import': 'silent' } });
  const inputs = processZones.map(TZ => JSON.parse(execFileSync(process.execPath, [worker], {
    env: { ...process.env, TZ }, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  })));
  const identity = {
    reader: inputs[0].reader, node: process.version, tz: process.versions.tz, icu: process.versions.icu,
    timeTree: git('rev-parse', 'HEAD:src/time'), rulerBlob: git('rev-parse', 'HEAD:test/time/fixtures/rulerTool.ts'),
    grammar: sha(readFileSync(join(here, 'manifest.mjs'))),
    manifest: sha(JSON.stringify(manifest)),
  };
  for (const [i, input] of inputs.entries()) {
    if (!isDeepStrictEqual(input.reader, identity.reader) || input.node !== identity.node ||
        input.tz !== identity.tz || input.icu !== identity.icu || input.processZone !== processZones[i]) {
      throw new Error('Worker identity mismatch');
    }
  }
  const rows = inputs.flatMap(input => input.rows);
  const forms = verify(manifest, rows, expected, identity);
  const expectedById = new Map(manifest.map(cell => [cell.id, cell.expected]));
  const receipt = { identity, forms, rows: rows.map(row => ({ ...row, expected: expectedById.get(row.id) })) };
  const output = process.argv[2];
  if (!output) throw new Error('Supply an output .json.gz path.');
  writeFileSync(output, gzipSync(JSON.stringify(receipt) + '\n'));
  console.log(JSON.stringify({ identityMatched: isDeepStrictEqual(expected, identity), forms }, null, 2));
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
