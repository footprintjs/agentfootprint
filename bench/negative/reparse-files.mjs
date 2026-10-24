/** Private file adapter for the free replay. The registered folder is read only;
 * output must be a new directory outside both that run and a Git checkout. */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { hash, reparseTrial, summarizeReparse } from './reparse-core.mjs';

/** Hash every built local JS module, covering transitive helpers as well as the
 * four entry modules. Include the replay code and dependency lock separately. */
export function replayProvenance(root) {
  const files = [];
  const walk = (path, prefix = '') => {
    for (const item of readdirSync(path, { withFileTypes: true }).sort((a, b) =>
      a.name.localeCompare(b.name),
    )) {
      const name = prefix + item.name;
      if (item.isDirectory()) walk(join(path, item.name), name + '/');
      else if (item.isFile() && name.endsWith('.js'))
        files.push([name, hash(readFileSync(join(path, item.name)))]);
    }
  };
  walk(join(root, 'dist/esm'));
  const scripts = [
    'reparse.mjs',
    'reparse-core.mjs',
    'reparse-files.mjs',
    'reparse-contract.mjs',
  ].map((name) => [name, hash(readFileSync(join(root, 'bench/negative', name)))]);
  return {
    node: process.version,
    builtJsFiles: files.length,
    builtJsTreeSha256: hash(JSON.stringify(files)),
    replayScripts: Object.fromEntries(scripts),
    dependencyLockSha256: hash(readFileSync(join(root, 'package-lock.json'))),
  };
}

function under(path, root) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !rel.startsWith('/'));
}
function privateOutput(input, requested) {
  const output = join(realpathSync(dirname(resolve(requested))), basename(requested));
  if (existsSync(output) || under(output, input))
    throw new Error('Replay output must be a new directory outside the original run.');
  for (let at = dirname(output); ; at = dirname(at)) {
    if (existsSync(join(at, '.git'))) throw new Error('Private replay output cannot enter Git.');
    if (at === dirname(at)) break;
  }
  return output;
}

export function reparseMarkdown(summary) {
  const c = summary.totals;
  return [
    '# Counterfactual offline parser/checker replay',
    '',
    `All ${c.trials} registered trials remain in the denominator. No model calls, tools, or corrections were run.`,
    '',
    '| Model | Cell | Arm | Trials | Schema pass | Schema fail | No answer | Binding error | Zero claims | Nonempty all established | Correction needed (counterfactual) |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |',
    ...summary.groups.map(
      ({ model, cell, arm, counts: n }) =>
        `| ${model} | ${cell} | ${arm} | ${n.trials} | ${n['schema-pass'] ?? 0} | ${
          n['schema-fail'] ?? 0
        } | ${n['no-answer'] ?? 0} | ${n['binding-error'] ?? 0} | ${
          n['zero-claim-answers'] ?? 0
        } | ${n['nonempty-all-established'] ?? 0} | ${
          n['counterfactual-correction-needed'] ?? 0
        } |`,
    ),
    '',
    '## Aggregate observations',
    '',
    '```json',
    JSON.stringify(c, null, 2),
    '```',
    '',
    `Prose coverage: ${c['schema-pass'] ?? 0} admitted candidates scanned; ${
      (c['prose-unscanned:schema-fail'] ?? 0) +
      (c['prose-unscanned:no-answer'] ?? 0) +
      (c['prose-unscanned:binding-error'] ?? 0)
    } unscanned; ${
      c['prose-scanned-no-observation'] ?? 0
    } scanned without observations (not clearance).`,
    '',
    '## Interpretation limits',
    '',
    ...summary.limitations.map((text) => `- ${text}`),
    '',
    `Original-file audit: ${summary.originalFiles.count} files checked before and after; unchanged: ${summary.originalFiles.allUnchanged}.`,
    'The detailed private report contains the selected response hashes, native record hashes, call-binding audit, candidates and checker rows. This aggregate contains no private case IDs, questions, entity names, or tool names.',
    '',
  ].join('\n');
}

export function runReparse(runDirectory, outputDirectory, lib) {
  if (!runDirectory || !outputDirectory)
    throw new Error('Usage: reparse.mjs <registered-run-dir> <new-private-out-dir>');
  const input = realpathSync(resolve(runDirectory));
  const output = privateOutput(input, outputDirectory);
  const manifestPath = join(input, 'manifest.json');
  const manifestBytes = readFileSync(manifestPath);
  const manifest = JSON.parse(manifestBytes);
  if (!Array.isArray(manifest.schedule) || manifest.schedule.length === 0)
    throw new Error('Registered schedule is missing.');
  const originalFiles = [{ path: 'manifest.json', sha256: hash(manifestBytes) }];
  const trials = [],
    ids = new Set();
  for (const row of manifest.schedule) {
    if (typeof row.id !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(row.id) || ids.has(row.id))
      throw new Error('Invalid or duplicate registered trial identity.');
    ids.add(row.id);
    const path = `raw/${row.id}.json.gz`;
    const full = realpathSync(join(input, path));
    if (!under(full, input)) throw new Error('Raw artifact resolves outside the run.');
    const bytes = readFileSync(full);
    originalFiles.push({ path, sha256: hash(bytes) });
    trials.push(reparseTrial(JSON.parse(gunzipSync(bytes)), row, lib));
  }
  for (const file of originalFiles)
    if (hash(readFileSync(join(input, file.path))) !== file.sha256)
      throw new Error('An original file changed during offline replay.');
  const summary = summarizeReparse(trials);
  summary.originalFiles = { count: originalFiles.length, allUnchanged: true };
  summary.runtimeProvenance = lib.replayProvenance ?? { injectedTestDependencies: true };
  summary.implementationSha256 = hash(
    JSON.stringify(
      Object.fromEntries(
        [
          'applyOutputSchema',
          'renderNegativeCandidate',
          'observeNegativeProse',
          'readResultIdentity',
        ].map((name) => [name, lib[name].toString()]),
      ),
    ),
  );
  mkdirSync(output, { mode: 0o700 });
  const save = (name, data) => writeFileSync(join(output, name), data, { mode: 0o600, flag: 'wx' });
  save(
    'analysis.private.json',
    JSON.stringify(
      {
        kind: 'counterfactual-only',
        generatedAt: new Date().toISOString(),
        originalFiles,
        summary,
        trials,
      },
      null,
      2,
    ) + '\n',
  );
  save('aggregate.json', JSON.stringify(summary, null, 2) + '\n');
  save('aggregate.md', reparseMarkdown(summary));
  return summary;
}
