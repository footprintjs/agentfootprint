#!/usr/bin/env node
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collectChartMap, renderChartMap } from './chart-map/index.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
if (process.argv.length !== 2) throw new TypeError('Usage: node scripts/generate-chart-map.mjs');
const inventory = collectChartMap(root);
const output = renderChartMap(inventory);
const filename = path.join(root, 'docs/chart-map.md');
writeFileSync(filename, output);
console.log(
  'Chart map: ' +
    inventory.mounts.length +
    ' mount sites, ' +
    inventory.stages.length +
    ' chart/stage sites.',
);
