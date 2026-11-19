import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

import { createBudget } from '../honest-report/budget.mjs';
import { packageTreeDigest } from '../honest-report/candidate.mjs';
import { loadCohort } from '../honest-report/cohorts.mjs';
import { openAttemptLedger } from '../honest-report/ledger.mjs';
import { runOne } from './benchmark.mjs';
import { summarize } from './metrics.mjs';
import { limits, paidSchedule, projectPreflight, PROJECTED_LIMIT_UNITS, SPEND_LIMIT_UNITS } from './plan.mjs';
import { rehearse, scriptedRows } from './rehearsal.mjs';

const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const file = (path) => new URL(path, import.meta.url);

function inputs() {
  const paths = [
    'RULE.md', 'PREDICTIONS.md', 'tasks.mjs', 'desk.mjs', 'benchmark.mjs', 'metrics.mjs', 'scorer.mjs',
    'plan.mjs', 'rehearsal.mjs', 'run.mjs',
    '../honest-report/tasks.mjs', '../honest-report/plan.mjs', '../honest-report/hiddenTasks.mjs',
    '../honest-report/budget.mjs', '../honest-report/ledger.mjs', '../honest-report/cohorts.mjs',
    '../honest-report/candidate.mjs', '../honest-report/cohorts/after/package-lock.json',
  ];
  return Object.fromEntries(paths.map((path) => [path, digest(readFileSync(file(path)))]));
}

function pinnedLibrary() {
  const root = file('../honest-report/cohorts/after/');
  const require = createRequire(new URL('package.json', root));
  const base = new URL('node_modules/', root);
  const tokenPath = fileURLToPath(new URL('agentfootprint/dist/core/agent/evidence/resultCarries.js', base));
  if (realpathSync(tokenPath) !== tokenPath) throw new Error('Expected token helpers in the pinned package');
  const { library, stamp } = loadCohort('published');
  const tokens = require(tokenPath);
  const packages = Object.fromEntries(Object.keys(stamp).filter((name) => name !== 'lockDigest').map((name) =>
    [name, packageTreeDigest(fileURLToPath(new URL(name, base)))]));
  return { library, tokens, cohort: { ...stamp, packages, tokenModuleSha256: digest(readFileSync(tokenPath)) } };
}

function verify(inputs, cohort) {
  const receipt = JSON.parse(readFileSync(file('rehearsal-lock.json')));
  assert.deepEqual(receipt.inputs, inputs, 'Pilot inputs changed after rehearsal');
  assert.deepEqual(receipt.cohort, cohort, 'Pinned package bytes differ from rehearsal');
  assert.equal(receipt.scriptedRows, scriptedRows, 'Incomplete scripted rehearsal');
  assert.match(receipt.transcriptSha256, /^[0-9a-f]{64}$/);
  return receipt;
}

async function coordinatorRun(library, tokens, receipt) {
  const adapterPath = file('paid-provider.mjs');
  const absolutePath = fileURLToPath(adapterPath);
  assert.equal(realpathSync(absolutePath), absolutePath, 'Keep the coordinator adapter in this bench');
  const { createProvider } = await import(adapterPath);
  assert.equal(typeof createProvider, 'function', 'Expected the coordinator’s provider adapter');
  const { append, close } = openAttemptLedger(file('paid-attempts.jsonl'));
  const budget = createBudget(append, { spendLimitUnits: SPEND_LIMIT_UNITS });
  const { preflight, remaining } = paidSchedule();
  const rows = [];
  let projection;
  let stop;

  const execute = async (item, phase) => {
    const { task, arm, repeat } = item;
    try {
      const model = await createProvider(limits);
      const row = await runOne(library, tokens, model, item, { budget, append });
      rows.push(row);
      append({ type: 'row', phase, row });
      if (row.ending === 'provider-error' || row.ending === 'spend-stop') stop = row.ending;
    } catch (error) {
      stop = budget.snapshot().stopped ? 'spend-stop' : 'harness-error';
      append({ type: 'run-error', phase, family: task.family, side: task.side, arm, repeat, error: error.name });
    }
  };
  try {
    append({ type: 'plan', receipt, limits, plannedRuns: preflight.length + remaining.length,
      projectedLimitUnits: PROJECTED_LIMIT_UNITS, spendLimitUnits: SPEND_LIMIT_UNITS });
    for (const item of preflight) {
      await execute(item, 'preflight');
      if (stop) break;
    }
    projection = projectPreflight(rows, remaining, budget.snapshot().chargedUnits);
    append({ type: 'preflight', projection });
    if (!stop && !projection.canContinue) stop = 'preflight-projection';
    if (!stop) {
      for (const item of remaining) {
        await execute(item, 'batch');
        if (stop) break;
      }
    }
    if (stop) append({ type: 'stop', reason: stop, completedRows: rows.length });
  } finally {
    close();
  }
  if (stop) process.exitCode = 2;
  return { rows, projection, stop, budget: budget.snapshot(), summary: summarize(rows) };
}

if (!process.permission || process.permission.has('fs.read', fileURLToPath(file('../')))) {
  throw new Error('Restrict filesystem reads to source-links and honest-report');
}
const [mode = '--rehearse', ...extra] = process.argv.slice(2);
if (extra.length || !['--rehearse', '--verify-receipt', '--coordinator-run'].includes(mode)) {
  throw new Error('Use --rehearse, --verify-receipt, or --coordinator-run');
}
const frozenInputs = inputs();
const { library, tokens, cohort } = pinnedLibrary();
const verified = mode === '--rehearse' ? undefined : verify(frozenInputs, cohort);
let report;
if (mode === '--rehearse') {
  const rows = await rehearse(library, tokens);
  report = { rows, receipt: {
    inputs: frozenInputs, cohort, scriptedRows: rows.length, transcriptSha256: digest(JSON.stringify(rows)),
  } };
} else if (mode === '--verify-receipt') {
  report = { receipt: verified };
} else {
  report = await coordinatorRun(library, tokens, verified);
}
process.stdout.write(`${JSON.stringify({ mode, ...report }, null, 2)}\n`);
