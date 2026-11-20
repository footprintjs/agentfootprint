import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { closeSync, openSync, readFileSync, realpathSync, writeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { assertRehearsal, controls, HiddenReplyExposureError, runOne, scripted } from './benchmark.mjs';
import { createBudget, PROJECTED_LIMIT_UNITS, SPEND_LIMIT_UNITS } from './budget.mjs';
import { loadCohort } from './cohorts.mjs';
import { hiddenScripted, hiddenTasks } from './hiddenTasks.mjs';
import { literalClaims } from './literalClaims.mjs';
import { cells, cellKey, limits, paidSchedule, projectPreflight, released16Cells } from './plan.mjs';
import { repeatedHiddenScripted } from './repeatPlay.mjs';
import { summarize } from './score.mjs';
import { tasks } from './tasks.mjs';

function rehearsalInputs(release16) {
  const files = [
    'RULE.md', 'tasks.mjs', 'hiddenTasks.mjs', 'benchmark.mjs',
    'budget.mjs', 'candidate.mjs', 'cohorts.mjs', 'plan.mjs', 'run.mjs', 'score.mjs',
    'terminalAnswer.mjs', 'repeatPlay.mjs', 'replyBoundary.mjs', 'literalClaims.mjs',
    ...(release16
      ? ['RELEASE16-PLAN.md', 'cohorts/released16/package-lock.json']
      : ['PLAN.md', 'PREDICTIONS.md', 'cohorts/after/package-lock.json', 'cohorts/candidate-source.json']),
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
  ...hiddenTasks.filter(({ control }) => !control).map((task) => ({
    task, variant: 'repeat-done', play: repeatedHiddenScripted,
  })),
];

async function rehearse(installed, inputs, selectedCells, parser) {
  const rows = [];
  const { applyOutputSchema } = parser.library;
  for (const { task, variant, play } of taskPlays) {
    for (const { label, arm } of selectedCells) {
      const run = { label, arm, taskId: task.id, variant };
      const result = await runOne(installed[label].library, task, play(task, variant), { arm, applyOutputSchema, limits, run });
      rows.push({ ...run, ...result });
    }
  }
  assertRehearsal(rows, { packedCandidate: installed.candidate?.stamp.archive !== undefined });
  if (installed.released16 !== undefined) {
    for (let i = 0; i < rows.length; i += 2) {
      assert.deepEqual(rows[i].requests[0].request, rows[i + 1].requests[0].request,
        `Paired first request: ${rows[i].taskId}/${rows[i].variant}`);
    }
  }
  const rehearsal = { scriptedRows: rows.length, inputs, cohorts: recordedCohorts(installed),
    transcriptSha256: createHash('sha256').update(JSON.stringify(rows)).digest('hex') };
  return { rows, rehearsal };
}

function readHostedCandidate(sha256) {
  const source = JSON.parse(readFileSync(new URL('./cohorts/candidate-source.json', import.meta.url)));
  assert.equal(source.sha256, sha256, 'Expected the green hosted candidate archive digest');
  assert.match(source.head, /^[0-9a-f]{40}$/);
  assert.match(source.tree, /^[0-9a-f]{40}$/);
  assert.match(source.testedHead, /^[0-9a-f]{40}$/);
  assert.ok(Number.isSafeInteger(source.runId) && source.runId > 0);
  assert.ok(Number.isSafeInteger(source.artifactId) && source.artifactId > 0);
  assert.ok(typeof source.artifactName === 'string' && source.artifactName.trim().length > 0);
  assert.match(source.archiveName, /^[a-zA-Z0-9_.-]+\.tgz$/);
  return source;
}

function verifyRehearsal(installed, inputs, selectedCells, release16) {
  const receiptName = release16 ? 'rehearsal-release16-lock.json' : 'rehearsal-lock.json';
  const receiptData = JSON.parse(readFileSync(new URL(receiptName, import.meta.url)));
  assert.deepEqual(receiptData.inputs, inputs, 'Harness inputs changed after rehearsal');
  assert.deepEqual(receiptData.cohorts, recordedCohorts(installed), 'Rehearse against the exact installed package first');
  assert.equal(receiptData.scriptedRows, taskPlays.length * selectedCells.length, 'The two-cell rehearsal must be complete');
  assert.match(receiptData.transcriptSha256, /^[a-f0-9]{64}$/, 'Rehearsal transcript digest required');
  return receiptData;
}

async function coordinatorRun(installed, inputs, selectedCells, parser, release16) {
  const createProvider = await createPaidFactory();
  const receiptName = release16 ? 'paid-attempts-release16.jsonl' : 'paid-attempts.jsonl';
  const receipt = openSync(new URL(receiptName, import.meta.url), 'wx', 0o600);
  const append = (value) => { writeSync(receipt, `${JSON.stringify(value)}\n`); };
  const budget = createBudget(append);
  const { applyOutputSchema } = parser.library;
  const { preflight, remaining } = paidSchedule(selectedCells);
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
      append({ type: 'exposure', ...run, violation: error.violation, observed: error.reply });
      stop = error.violation === 'unverified-tool-boundary' ? 'critical-reply-unverified' : 'critical-status-exposed';
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
    projection = projectPreflight(rows, remaining, budget.snapshot().chargedUnits, selectedCells);
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
  const release16 = flag === '--release16' && path === undefined && sha256 === undefined;
  const candidateRequested = flag === '--candidate' && path !== undefined && sha256 !== undefined;
  if (!['--rehearse', '--verify-receipt', '--coordinator-run'].includes(mode) || rest.length ||
      (!release16 && !candidateRequested)) {
    throw new Error('Use --rehearse, --verify-receipt, or --coordinator-run with --release16 or --candidate <archive> <sha256>');
  }
  const inputs = rehearsalInputs(release16);
  const selectedCells = release16 ? released16Cells : cells;
  let installed;
  if (release16) {
    installed = { released16: loadCohort('released16') };
  } else {
    const source = readHostedCandidate(sha256);
    const candidate = loadCohort('candidate', { path, sha256 });
    installed = {
      published: loadCohort('published'),
      candidate: { ...candidate, stamp: { ...candidate.stamp, source } },
    };
  }
  const parser = release16 ? installed.released16 : installed.published;
  const verified = mode === '--rehearse' ? undefined
    : verifyRehearsal(installed, inputs, selectedCells, release16);
  if (mode === '--verify-receipt') {
    process.stdout.write(`${JSON.stringify({ mode, rehearsal: verified }, null, 2)}\n`);
    return;
  }
  const result = mode === '--rehearse' ? await rehearse(installed, inputs, selectedCells, parser)
    : await coordinatorRun(installed, inputs, selectedCells, parser, release16);
  const summarizeCells = (rows, allowTerminalObject = false) => {
    const { applyOutputSchema } = parser.library;
    const summarizeSelection = (selected) => ({
      ...summarize(allowTerminalObject ? selected.map((row) => ({ ...row, score: row.supplementalScore })) : selected),
      literalClaims: literalClaims(selected, applyOutputSchema, { allowTerminalObject }),
    });
    return Object.fromEntries(selectedCells.map(({ label, arm }) => {
      const selected = rows.filter((row) => row.label === label && row.arm === arm);
      const byTask = Object.fromEntries([...tasks, ...hiddenTasks].map(({ id }) => [
        id, summarizeSelection(selected.filter(({ task }) => task.id === id)),
      ]));
      return [cellKey(label, arm), { ...summarizeSelection(selected), byTask }];
    }));
  };
  const report = {
    mode, inputs, limits, cohorts: recordedCohorts(installed),
    totals: summarizeCells(result.rows),
    supplementalTotals: summarizeCells(result.rows, true),
    ...result,
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
}

await main();
