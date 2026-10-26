/** Original artifacts are read only. New detailed analysis stays outside Git. */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { hash } from './reparse-core.mjs';
import { compareStages, STAGES, summarizeStages } from './staged-comparison-core.mjs';

const under = (path, root) => {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
};

export function stagedMarkdown(summary) {
  return [
    '# Sequential free comparison: requested kind, then subject',
    '',
    'Fixed saved candidates and native evidence; no live agent or paid call ran.',
    '',
    `Trials: ${summary.denominators.trials}; admitted answers: ${summary.denominators.schemaPass}; claim slots: ${summary.denominators.claims}; schema failures: ${summary.denominators.schemaFail}; no answer: ${summary.denominators.noAnswer}; zero-claim answers: ${summary.denominators.zeroClaims}.`,
    '',
    '| Stage | Established slots | Unestablished slots | Nonempty all-established answers | Complete-request slots rendered as absence | Complete-not-established absence notices |',
    '| --- | ---: | ---: | ---: | ---: | ---: |',
    ...STAGES.map((stage) => {
      const c = summary.totals.stages[stage];
      return `| ${stage} | ${c.established} | ${c.unestablished} | ${c.nonemptyAllEstablishedAnswers} | ${c.completeRequestedRenderedAbsence} | ${c.completeRequestsWithAbsenceFallback} |`;
    }),
    '',
    '## Model / cell / arm',
    '',
    '| Model | Cell | Arm | Trials | Slots | Baseline established | Kind-only established | Kind + subject established |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |',
    ...summary.groups.map(
      ({ model, cell, arm, counts: c }) =>
        `| ${model} | ${cell} | ${arm} | ${c.trials} | ${c.claims} | ${c.stages.baseline.established} | ${c.stages.kindOnly.established} | ${c.stages.kindAndSubject.established} |`,
    ),
    ...['baselineToKind', 'kindToSubject'].flatMap((step) => [
      '',
      `## ${step}`,
      '',
      '| First reason → next first reason | Claim slots |',
      '| --- | ---: |',
      ...Object.entries(summary.totals[step])
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([transition, n]) => `| ${transition} | ${n} |`),
    ]),
    '',
    '## Limits',
    '',
    ...summary.limitations.map((line) => `- ${line}`),
    '',
    `${summary.originalFiles.count} original files checked before/after; unchanged: ${summary.originalFiles.allUnchanged}.`,
    'Built-code trees, dependency locks and analysis-script digests are recorded in the aggregate JSON. Candidate-level detail remains private.',
    '',
  ].join('\n');
}

export function runStagedComparison(
  runDirectory,
  outputDirectory,
  baselineLib,
  correctedLib,
  expected,
) {
  const input = realpathSync(resolve(runDirectory));
  const output = join(realpathSync(dirname(resolve(outputDirectory))), basename(outputDirectory));
  if (existsSync(output) || under(output, input))
    throw new Error('Staged comparison requires a new directory outside original inputs.');
  for (let at = dirname(output); ; at = dirname(at)) {
    if (existsSync(join(at, '.git')))
      throw new Error('Private staged comparison cannot enter Git.');
    if (at === dirname(at)) break;
  }
  const bytes = readFileSync(join(input, 'manifest.json'));
  const manifest = JSON.parse(bytes);
  if (!Array.isArray(manifest.schedule) || manifest.schedule.length === 0)
    throw new Error('Missing registered schedule.');
  const files = [{ path: 'manifest.json', sha256: hash(bytes) }],
    seen = new Set(),
    trials = [];
  for (const row of manifest.schedule) {
    if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(row.id) || seen.has(row.id))
      throw new Error('Invalid registered trial identity.');
    seen.add(row.id);
    const path = `raw/${row.id}.json.gz`,
      full = realpathSync(join(input, path));
    if (!under(full, input)) throw new Error('Raw artifact escaped original inputs.');
    const rawBytes = readFileSync(full);
    files.push({ path, sha256: hash(rawBytes) });
    trials.push(compareStages(JSON.parse(gunzipSync(rawBytes)), row, baselineLib, correctedLib));
  }
  for (const file of files)
    if (hash(readFileSync(join(input, file.path))) !== file.sha256)
      throw new Error('Original input changed during staged comparison.');
  const summary = summarizeStages(trials, expected);
  summary.originalFiles = {
    count: files.length,
    allUnchanged: true,
    manifestSha256: files[0].sha256,
  };
  summary.provenance = {
    baseline: baselineLib.replayProvenance,
    corrected: correctedLib.replayProvenance,
  };
  summary.comparisonScripts = Object.fromEntries(
    ['staged-comparison.mjs', 'staged-comparison-core.mjs', 'staged-comparison-files.mjs'].map(
      (name) => [name, hash(readFileSync(new URL(name, import.meta.url)))],
    ),
  );
  mkdirSync(output, { mode: 0o700 });
  for (const [name, content] of [
    [
      'analysis.private.json',
      JSON.stringify({ generatedAt: new Date().toISOString(), files, summary, trials }, null, 2) +
        '\n',
    ],
    ['aggregate.json', JSON.stringify(summary, null, 2) + '\n'],
    ['aggregate.md', stagedMarkdown(summary)],
  ])
    writeFileSync(join(output, name), content, { mode: 0o600, flag: 'wx' });
  return summary;
}
