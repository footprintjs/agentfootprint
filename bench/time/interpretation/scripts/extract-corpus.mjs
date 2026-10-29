// Extract the partner app's TIME_CORPUS from its test file (read only) into JSON.
// Usage: node scripts/extract-corpus.mjs <path to the app's test file> corpus/app-corpus.json
// Each row: { text, app } where app is { reads: minutes } | 'ask' | 'none' — the app's own labels
// (READS(n) → reads; REFUSED → ask; NO_TIME → none).
import { readFileSync, writeFileSync } from 'node:fs';

const [, , source, out] = process.argv;
const file = readFileSync(source, 'utf8');
const start = file.indexOf('const TIME_CORPUS');
const end = file.indexOf('];', start);
if (start < 0 || end < 0) throw new Error('TIME_CORPUS not found');
const block = file.slice(start, end);

// One entry: ['text with \' escapes', LABEL],  where LABEL is REFUSED | NO_TIME | READS(n)
const ROW = /\[\s*'((?:[^'\\]|\\.)*)'\s*,\s*(REFUSED|NO_TIME|READS\((\d+)\))\s*\]/g;
const rows = [];
for (const m of block.matchAll(ROW)) {
  const text = m[1].replace(/\\(.)/g, '$1');
  const app = m[2] === 'REFUSED' ? 'ask' : m[2] === 'NO_TIME' ? 'none' : { reads: Number(m[3]) };
  rows.push({ text, app });
}
// Count raw entries a second way, to prove no row was skipped by the pattern.
const rawEntries = block.split('\n').filter((l) => /^\s*\['/.test(l)).length;
if (rawEntries !== rows.length) throw new Error(`parsed ${rows.length} rows but the block has ${rawEntries} entry lines`);
const dupes = rows.length - new Set(rows.map((r) => r.text)).size;
writeFileSync(out, JSON.stringify(rows, null, 1) + '\n');
console.log(`extracted ${rows.length} rows (${dupes} duplicate texts) → ${out}`);
console.log('labels:', JSON.stringify(rows.reduce((a, r) => { const k = typeof r.app === 'string' ? r.app : 'reads'; a[k] = (a[k] ?? 0) + 1; return a; }, {})));
