// Measurement only. Compares coverage-summary.json files: which files each run
// reported and how many statements, branches, functions and lines each counted.
// Usage: coverage-diff.mjs <vitest 4> <vitest 4 with the newer mapper> <vitest 5>
import { readFileSync } from 'node:fs';

const METRICS = ['statements', 'branches', 'functions', 'lines'];

const load = (path) => {
  const summary = JSON.parse(readFileSync(path, 'utf8'));
  const files = new Map();
  for (const [name, entry] of Object.entries(summary)) {
    if (name === 'total') continue;
    files.set(name.slice(name.indexOf('/src/') + 1), entry);
  }
  return { total: summary.total, files };
};

const denominators = (entry) => METRICS.map((metric) => entry[metric].total);

const compare = (label, a, b) => {
  const onlyA = [...a.files.keys()].filter((name) => !b.files.has(name));
  const onlyB = [...b.files.keys()].filter((name) => !a.files.has(name));
  console.log(`MEASURE coverage-file-set ${label} only-first=${onlyA.length} only-second=${onlyB.length}`);
  for (const name of [...onlyA, ...onlyB].slice(0, 30)) console.log(`MEASURE coverage-file-only ${label} ${name}`);
  const changed = [];
  for (const [name, entry] of a.files) {
    const other = b.files.get(name);
    if (!other) continue;
    const first = denominators(entry);
    const second = denominators(other);
    if (first.some((value, index) => value !== second[index])) {
      changed.push({ name, delta: second.map((value, index) => value - first[index]) });
    }
  }
  console.log(`MEASURE coverage-counts-changed ${label} files=${changed.length}`);
  changed.sort((x, y) => Math.abs(y.delta[1]) - Math.abs(x.delta[1]));
  for (const { name, delta } of changed.slice(0, 40)) {
    console.log(`MEASURE coverage-file-delta ${label} ${name} ${METRICS.map((m, i) => `${m}=${delta[i]}`).join(' ')}`);
  }
};

const [v4, mapper, v5] = process.argv.slice(2).map(load);
for (const [label, run] of [['v4', v4], ['v4-mapper-1.0.7', mapper], ['v5', v5]]) {
  console.log(`MEASURE coverage-total ${label} files=${run.files.size} ${denominators(run.total).map((value, i) => `${METRICS[i]}=${value}`).join(' ')}`);
}
compare('v4-vs-v5', v4, v5);
compare('v4-mapper-1.0.7-vs-v5', mapper, v5);
