import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertRehearsal, controls, runOne, scripted } from './benchmark.mjs';
import { createBudget, PROJECTED_LIMIT_UNITS, SPEND_LIMIT_UNITS } from './budget.mjs';
import { cohorts, loadCohort } from './cohorts.mjs';
import { cellKey, limits, paidSchedule, projectPreflight } from './plan.mjs';
import { summarize } from './score.mjs';
import { arms, tasks } from './tasks.mjs';

function rehearsalInputs() {
  const files = [
    'RULE.md', 'tasks.mjs', 'benchmark.mjs', 'budget.mjs', 'cohorts.mjs',
    'plan.mjs', 'run.mjs', 'score.mjs',
    'cohorts/before/package-lock.json', 'cohorts/after/package-lock.json',
  ];
  return Object.fromEntries(files.map((name) => [
    name, createHash('sha256').update(readFileSync(new URL(name, import.meta.url))).digest('hex'),
  ]));
}

async function createPaidFactory() {
  const filename = fileURLToPath(new URL('./paid-provider.mjs', import.meta.url));
  if (realpathSync(filename) !== filename) throw new Error('The coordinator provider must be inside the bench');
  const { createProvider } = await import('./paid-provider.mjs');
  if (typeof createProvider !== 'function') throw new Error('Provide a createProvider export');
  return createProvider;
}

function recordedCohorts(installed) {
  return Object.fromEntries(Object.entries(installed).map(([label, { stamp }]) => [label, stamp]));
}

async function rehearse(installed) {
  const rows = [];
  const applyOutputSchema = installed.before.library.applyOutputSchema;
  for (const task of tasks) {
    for (const variant of task.control ? ['done'] : Object.keys(controls)) {
      for (const arm of arms) {
        for (const [label, { library }] of Object.entries(installed)) {
          const run = { label, arm, taskId: task.id, variant };
          const result = await runOne(library, task, scripted(task, variant), { arm, applyOutputSchema, limits, run });
          rows.push({ ...run, ...result });
        }
      }
    }
  }
  assertRehearsal(rows);
  return { rows };
}

async function coordinatorRun(installed, inputs) {
  const receiptData = JSON.parse(readFileSync(new URL('./rehearsal-lock.json', import.meta.url)));
  assert.deepEqual(receiptData.inputs, inputs, 'Harness inputs changed after rehearsal');
  assert.equal(receiptData.scriptedRows, 64, 'The four-cell rehearsal must be complete');
  const createProvider = await createPaidFactory();
  const receipt = openSync(new URL('./paid-attempts.jsonl', import.meta.url), 'wx', 0o600);
  const append = (value) => { writeSync(receipt, `${JSON.stringify(value)}\n`); };
  const budget = createBudget(append);
  const applyOutputSchema = installed.before.library.applyOutputSchema;
  const { preflight, remaining } = paidSchedule(Object.keys(installed));
  const rows = [];
  let projection;
  let stop;

  const execute = async (item, phase) => {
    const { task, label, arm, repeat } = item;
    const run = { phase, label, arm, repeat, taskId: task.id };
    const provider = await createProvider(limits);
    const row = { ...run, ...await runOne(installed[label].library, task, provider, {
      limits, arm, applyOutputSchema, append, budget, run,
    }) };
    rows.push(row);
    append({ type: 'row', row });
    if (row.integrityViolation) stop = 'invalid-fake-desk-outcome';
    else if (budget.snapshot().stopped) stop = 'spend-stop';
  };

  try {
    append({
      type: 'plan', inputs, cohorts: recordedCohorts(installed), limits,
      plannedRuns: preflight.length + remaining.length,
      projectedLimitUnits: PROJECTED_LIMIT_UNITS, spendLimitUnits: SPEND_LIMIT_UNITS,
    });
    for (const item of preflight) {
      await execute(item, 'preflight');
      if (stop) break;
    }
    projection = projectPreflight(rows, remaining, budget.snapshot().chargedUnits);
    append({ type: 'preflight', projection });
    process.stderr.write(`${JSON.stringify({ type: 'preflight', projection })}\n`);
    if (!stop && !projection.canContinue) stop = 'preflight-projection';
    if (!stop) {
      for (const item of remaining) {
        await execute(item, 'batch');
        if (stop) break;
      }
    }
    if (stop) append({ type: 'stop', reason: stop, completedRows: rows.length });
  } finally {
    closeSync(receipt);
  }
  if (stop) process.exitCode = 2;
  return { rows, projection, stop, budget: budget.snapshot() };
}

async function main() {
  if (!process.permission || process.permission.has('fs.read', fileURLToPath(new URL('../', import.meta.url)))) {
    throw new Error('Run with filesystem read restricted to the benchmark directory');
  }
  const mode = process.argv[2] ?? '--rehearse';
  if (process.argv.length > 3 || !['--rehearse', '--coordinator-run'].includes(mode)) {
    throw new Error('Use --rehearse or --coordinator-run');
  }
  const inputs = rehearsalInputs();
  const installed = Object.fromEntries(Object.keys(cohorts).map((label) => [label, loadCohort(label)]));
  const result = mode === '--rehearse' ? await rehearse(installed) : await coordinatorRun(installed, inputs);
  const report = {
    mode, inputs, limits, cohorts: recordedCohorts(installed),
    totals: Object.fromEntries(arms.flatMap((arm) => Object.keys(installed).map((label) => [
      cellKey(label, arm), summarize(result.rows.filter((row) => row.label === label && row.arm === arm)),
    ]))),
    ...result,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
