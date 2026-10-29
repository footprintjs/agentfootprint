// Bundle the library's englishTimeReader from THIS repository's source (src/time/readers/english.ts,
// which imports only the port), so the bench measures the reader as it stands, without a package build.
// Writes .build/af-english.mjs and .build/af-english.json (the source commit and the reader version).
import { build } from 'esbuild';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '../../../..');
const entry = resolve(root, 'src/time/readers/english.ts');
mkdirSync(resolve(here, '../.build'), { recursive: true });
await build({ entryPoints: [entry], bundle: true, format: 'esm', platform: 'neutral', outfile: resolve(here, '../.build/af-english.mjs'), logLevel: 'error' });
const { ENGLISH_TIME_READER_VERSION } = await import(resolve(here, '../.build/af-english.mjs'));
const commit = execFileSync('git', ['-C', root, 'log', '-1', '--format=%H', '--', 'src/time/readers/english.ts', 'src/time/reader.ts']).toString().trim();
const info = { source: 'src/time/readers/english.ts', lastCommitTouchingReader: commit, readerVersion: ENGLISH_TIME_READER_VERSION };
writeFileSync(resolve(here, '../.build/af-english.json'), JSON.stringify(info, null, 1) + '\n');
console.log(JSON.stringify(info));
