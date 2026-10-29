// Record every version a run depends on: results/versions.json.  Usage: node scripts/versions.mjs [duckling image id]
import { readFileSync, writeFileSync } from 'node:fs';
import { SCAN_VERSION } from './signals.mjs';
import { MEANING_RULE_VERSION } from './meaning-rule.mjs';
import { BINDING_VERSION } from './binding.mjs';

// Read from disk: some packages do not export their package.json.
const version = (name) => JSON.parse(readFileSync(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8')).version;
const versions = {
  node: process.version,
  clock: '2026-10-27T09:30:00Z',
  zone: 'UTC',
  readers: {
    '@microsoft/recognizers-text-date-time': version('@microsoft/recognizers-text-date-time'),
    'chrono-node': version('chrono-node'),
    duckling: { image: 'rasa/duckling:latest', id: process.argv[2] ?? 'not recorded', built: '2022-04-21T13:51:29Z', runs: 'as a local container, linux/amd64 under emulation' },
    englishTimeReader: JSON.parse(readFileSync(new URL('../.build/af-english.json', import.meta.url), 'utf8')),
    'library-grammar': 'scripts/adapters.mjs · libraryGrammar over scripts/signals.mjs · readLookbackQuote',
  },
  rules: { leftoverScan: SCAN_VERSION, completeMeaning: MEANING_RULE_VERSION, binding: BINDING_VERSION },
  hostRuleReference: {
    commit: '0d52b9b', measured: '2026-10-28',
    note: "the host app's rule in the reference row, as it stood at that commit: a historical baseline. The reviewer reports that its current rule refuses H16, H23 and H31; it was not rerun here.",
  },
  esbuild: version('esbuild'),
};
writeFileSync(new URL('../results/versions.json', import.meta.url), JSON.stringify(versions, null, 1) + '\n');
console.log(JSON.stringify(versions, null, 1));
