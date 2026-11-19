import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertRehearsal, controls, HiddenReplyExposureError, runOne, scripted } from './benchmark.mjs';
import { createBudget, PROJECTED_LIMIT_UNITS, SPEND_LIMIT_UNITS } from './budget.mjs';
import { loadCohort } from './cohorts.mjs';
import { hiddenScripted, hiddenTasks } from './hiddenTasks.mjs';
import { cells, cellKey, limits, paidSchedule, projectPreflight } from './plan.mjs';
import { summarize } from './score.mjs';
import { tasks } from './tasks.mjs';

function rehearsalInputs() {
  const files = [
    'RULE.md', 'PLAN.md', 'PREDICTIONS.md', 'tasks.mjs', 'hiddenTasks.mjs', 'benchmark.mjs',
    'budget.mjs', 'candidate.mjs', 'cohorts.mjs', 'plan.mjs', 'run.mjs', 'score.mjs',
    'terminalAnswer.mjs', 'cohorts/after/package-lock.json',
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

const taskPlays = [
  ...tasks.flatMap((task) => {
    const variants = task.control ? ['done'] : Object.keys(controls);
    if (task.id === 'unavailable-tool') variants.push('fallback-bare', 'fallback-fenced');
    return variants.map((variant) => ({ task, variant, play: scripted }));
  }),
  ...hiddenTasks.flatMap((task) => ['honest', 'done'].map((variant) => ({ task, variant, play: hiddenScripted }))),
];

async function rehearse(installed, inputs) {
  const rows = [];
  const applyOutputSchema = installed.published.library.applyOutputSchema;
  for (const { task, variant, play } of taskPlays) {
    for (const { label, arm } of cells) {
      const run = { label, arm, taskId: task.id, variant };
      const result = await runOne(installed[label].library, task, play(task, variant), { arm, applyOutputSchema, limits, run });
      rows.push({ ...run, ...result });
    }
  }
  assertRehearsal(rows, { packedCandidate: installed.candidate.stamp.archive !== undefined });
  const rehearsal = { scriptedRows: rows.length, inputs, cohorts: recordedCohorts(installed),
    transcriptSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  return { rows, rehearsal };
}

async function coordinatorRun(installed, inputs) {
  const receiptData = JSON.parse(readFileSync(new URL('./rehearsal-lock.json', import.meta.url)));
  assert.deepEqual(receiptData.inputs, inputs, 'Harness inputs changed after rehearsal');
  assert.deepEqual(receiptData.cohorts, recordedCohorts(installed), 'Rehearse against the exact packed candidate first');
  assert.equal(receiptData.scriptedRows, taskPlays.length * cells.length, 'The three-cell rehearsal must be complete');
  assert.match(receiptData.transcriptSha256, /^[a-f0-9]{64}$/, 'Rehearsal transcript digest required');
  const createProvider = await createPaidFactory();
  const receipt = openSync(new URL('./paid-attempts.jsonl', import.meta.url), 'wx', 0o600);
  const append = (value) => { writeSync(receipt, `${JSON.stringify(value)}\n`); };
  const budget = createBudget(append);
  const applyOutputSchema = installed.published.library.applyOutputSchema;
  const { preflight, remaining } = paidSchedule();
  const rows = [];
  let projection;
  let stop;

  const execute = async (item, phase) => {
    const { task, label, arm, repeat } = item;
    const run = { phase, label, arm, repeat, taskId: task.id };
    const provider = await createProvider(limits);
    let result;
    try {
      result = await runOne(installed[label].library, task, provider, { limits, arm, applyOutputSchema, append, budget, run });
    } catch (error) {
      if (!(error instanceof HiddenReplyExposureError)) throw error;
      append({ type: 'exposure', ...run, observed: error.reply });
      stop = 'critical-status-exposed';
      return;
    }
    const row = { ...run, ...result };
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
  const [mode = '--rehearse', flag, path, sha256, ...rest] = process.argv.slice(2);
  if (!['--rehearse', '--coordinator-run'].includes(mode) || rest.length ||
      (flag !== undefined && (flag !== '--candidate' || path === undefined || sha256 === undefined))) {
    throw new Error('Use --rehearse or --coordinator-run, with optional --candidate <archive> <sha256>');
  }
  if (mode === '--coordinator-run' && flag === undefined) throw new Error('A real packed candidate is required before paid preflight');
  const inputs = rehearsalInputs();
  // The candidate loader verifies the archive and lock before requiring its code.
  const published = loadCohort('published');
  const candidate = flag === undefined
    ? { library: published.library, stamp: { ...published.stamp, placeholder: 'published-15.0.0' } }
    : loadCohort('candidate', { path, sha256 });
  const installed = { published, candidate };
  const result = mode === '--rehearse' ? await rehearse(installed, inputs) : await coordinatorRun(installed, inputs);
  const summarizeCells = (rows) => Object.fromEntries(cells.map(({ label, arm }) => {
    const selected = rows.filter((row) => row.label === label && row.arm === arm);
    const byTask = Object.fromEntries([...tasks, ...hiddenTasks].map(({ id }) => [
      id, summarize(selected.filter(({ task }) => task.id === id)),
    ]));
    return [cellKey(label, arm), { ...summarize(selected), byTask }];
  }));
  const report = {
    mode, inputs, limits, cohorts: recordedCohorts(installed),
    totals: summarizeCells(result.rows),
    supplementalTotals: summarizeCells(result.rows.map((row) => ({ ...row, score: row.supplementalScore }))),
    ...result,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
