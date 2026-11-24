#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectChartMap, renderChartMap } from './chart-map/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--check')) {
  throw new TypeError('Usage: node scripts/generate-chart-map.mjs [--check]');
}
const inventory = collectChartMap(root);
const output = renderChartMap(inventory);
const filename = path.join(root, 'docs/chart-map.md');
if (args[0] === '--check') {
  if (!existsSync(filename) || readFileSync(filename, 'utf8') !== output) {
    console.error('docs/chart-map.md is stale; run npm run docs:chart-map and commit its output.');
    process.exitCode = 1;
  } else {
    console.log('Chart map matches production source declarations.');
  }
} else {
  writeFileSync(filename, output);
  console.log(
    `Chart map: ${inventory.mounts.length} mount sites, ${inventory.stages.length} chart/stage sites.`,
  );
}
