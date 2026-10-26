/** Read-only original inputs; private comparison output in a new non-Git folder. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { hash } from './reparse-core.mjs';
import { compareTrial, summarizeComparison } from './compare-evidence-owned-core.mjs';

const within = (path, root) => {
  const r = relative(root, path);
  return r === '' || (!r.startsWith('..') && !r.startsWith('/'));
};
export function comparisonMarkdown(summary) {
  return [
    '# Free comparison: evidence-owned kind and subject',
    '',
    'This compares two runtime checkers on fixed saved candidates and evidence. No live agent ran.',
    '',
    `Trials: ${summary.denominators.trials}; admitted answers: ${summary.denominators.schemaPass}; claims: ${summary.denominators.claims}; schema failures: ${summary.denominators.schemaFail}; no answer: ${summary.denominators.noAnswer}; zero-claim answers: ${summary.denominators.zeroClaims}.`,
    '',
    '| Model | Cell | Arm | Trials | Claims | Baseline established | Current established | Current unestablished | Counterfactual corrections |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.groups.map(
      ({ model, cell, arm, counts: c }) =>
        `| ${model} | ${cell} | ${arm} | ${c.trials} | ${c.claims} | ${c.baselineEstablished} | ${c.currentEstablished} | ${c.currentUnestablished} | ${c.currentCorrectionNeeded} |`,
    ),
    '',
    '## Claim transitions',
    '',
    '| Baseline → current | Claims |',
    '| --- | ---: |',
    ...Object.entries(summary.totals.transitions)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, n]) => `| ${key} | ${n} |`),
    '',
    '## Limits',
    '',
    ...summary.limitations.map((t) => `- ${t}`),
    '',
    `Original inputs: ${summary.originalFiles.count} manifest/raw files checked before and after; unchanged: ${summary.originalFiles.allUnchanged}.`,
    'Both complete local built-JavaScript trees, dependency locks and analysis scripts have recorded hashes. The detailed analysis stays private; this report contains aggregate counts only.',
    '',
  ].join('\n');
}

export function runComparison(runDirectory, outputDirectory, baselineLib, currentLib, expected) {
  const input = realpathSync(resolve(runDirectory));
  const output = join(realpathSync(dirname(resolve(outputDirectory))), basename(outputDirectory));
  if (existsSync(output) || within(output, input))
    throw new Error('Comparison needs a new directory outside original inputs.');
  for (let dir = dirname(output); ; dir = dirname(dir)) {
    if (existsSync(join(dir, '.git'))) throw new Error('Private comparison cannot enter Git.');
    if (dir === dirname(dir)) break;
  }
  const manifestBytes = readFileSync(join(input, 'manifest.json')),
    manifest = JSON.parse(manifestBytes);
  if (!Array.isArray(manifest.schedule) || !manifest.schedule.length)
    throw new Error('Missing registered schedule.');
  const files = [{ path: 'manifest.json', sha256: hash(manifestBytes) }],
    seen = new Set(),
    trials = [];
  for (const row of manifest.schedule) {
    if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(row.id) || seen.has(row.id))
      throw new Error('Invalid registered trial identity.');
    seen.add(row.id);
    const path = `raw/${row.id}.json.gz`,
      absolute = realpathSync(join(input, path));
    if (!within(absolute, input)) throw new Error('Raw artifact escaped original inputs.');
    const bytes = readFileSync(absolute);
    files.push({ path, sha256: hash(bytes) });
    trials.push(compareTrial(JSON.parse(gunzipSync(bytes)), row, baselineLib, currentLib));
  }
  for (const file of files)
    if (hash(readFileSync(join(input, file.path))) !== file.sha256)
      throw new Error('Original input changed during comparison.');
  const summary = summarizeComparison(trials, expected);
  summary.originalFiles = { count: files.length, allUnchanged: true };
  summary.provenance = {
    baseline: baselineLib.replayProvenance,
    current: currentLib.replayProvenance,
  };
  const scripts = [
    'compare-evidence-owned.mjs',
    'compare-evidence-owned-core.mjs',
    'compare-evidence-owned-files.mjs',
  ];
  summary.comparisonScripts = Object.fromEntries(
    scripts.map((name) => [name, hash(readFileSync(new URL(name, import.meta.url)))]),
  );
  mkdirSync(output, { mode: 0o700 });
  for (const [name, content] of [
    [
      'analysis.private.json',
      JSON.stringify({ generatedAt: new Date().toISOString(), files, summary, trials }, null, 2) +
        '\n',
    ],
    ['aggregate.json', JSON.stringify(summary, null, 2) + '\n'],
    ['aggregate.md', comparisonMarkdown(summary)],
  ])
    writeFileSync(join(output, name), content, { mode: 0o600, flag: 'wx' });
  return summary;
}
