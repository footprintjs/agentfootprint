/** Default is $0 rehearsal. No key access or live module import on that path. */
import { readFileSync, mkdirSync, writeFileSync, openSync, closeSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname, join } from 'node:path';
import { verifyConsumer, verifyKit, sha256 } from './identity.mjs';
import { pilotBudget } from './budget.mjs';
import { modules, canaries, runArm } from './arms.mjs';
import { openJournal } from './journal.mjs';
import { homedir } from 'node:os';
const root = dirname(fileURLToPath(import.meta.url));
export async function pilot({
  consumer,
  output,
  execute = false,
  approvedManifest,
  getLiveTransport,
}) {
  const manifestBytes = readFileSync(join(root, 'manifest.json'));
  const manifest = JSON.parse(manifestBytes),
    manifestHash = sha256(manifestBytes);
  if (execute && approvedManifest !== manifestHash)
    throw new Error('pilot manifest approval mismatch');
  verifyKit(resolve(root, '../../..'), manifest);
  verifyConsumer(consumer, manifest);
  const apis = {
    baseline: modules(consumer, 'baseline'),
    candidate: modules(consumer, 'candidate'),
  };
  const parity = {
    baseline: await canaries(apis.baseline),
    candidate: await canaries(apis.candidate),
  };
  if (JSON.stringify(parity.baseline) !== JSON.stringify(parity.candidate))
    throw new Error('pilot citation rules differ');
  const out = openSync(output, 'wx', 0o600);
  let journal;
  try {
    // One fixed durable live identity, independent of --out. No resume/reset.
    // The 20261020 journal is the aborted smoke's record; this run never opens it.
    if (execute) {
      const state = join(homedir(), '.local/state/agentfootprint/pilots');
      mkdirSync(state, { recursive: true });
      journal = openJournal(join(state, 'findings-cache-phase-c-20261029.ndjson'));
    }
    const events = [],
      results = [];
    const append = (event) => {
      journal?.append(event);
      events.push(event);
    };
    const budget = pilotBudget({ journal: append });
    let status = 'complete';
    try {
      append({
        kind: 'started',
        manifestHash,
        mode: execute ? 'live' : 'rehearsal',
        phaseAPolicy: manifest.phaseAPolicy,
      });
      // Only after identities, policy canaries, exclusive journal + output admission.
      const transport = execute ? await getLiveTransport() : undefined;
      for (const entry of manifest.order) {
        const result = await runArm({
          api: apis[entry.arm],
          arm: entry.arm,
          scenarioId: entry.scenario,
          budget,
          transport,
          partition: entry.partition,
        });
        results.push(result);
        if (result.ended !== 'complete' || budget.snapshot().halted) {
          status = 'incomplete';
          break;
        }
      }
      append({ kind: 'ended', status, completedRuns: results.length, budget: budget.snapshot() });
    } catch {
      status = 'incomplete';
      append({ kind: 'ended', status, completedRuns: results.length, budget: budget.snapshot() });
    }
    const costs = (arm, run) => {
      const rows = events.filter((e) => (!arm || e.arm === arm) && (!run || e.run === run)),
        settled = rows.filter((e) => e.kind === 'settled');
      const sum = (key) => settled.reduce((n, e) => n + e.usage.raw[key], 0);
      const notSentCalls = rows.filter((e) => e.kind === 'not-sent').length;
      const unknownCalls =
        rows.filter((e) => e.kind === 'reserved').length - settled.length - notSentCalls;
      const knownNanoUsd = settled.reduce((sum, e) => sum + e.usage.nanoUsd, 0);
      const input =
        sum('input_tokens') + sum('cache_creation_input_tokens') + sum('cache_read_input_tokens');
      return {
        unknownCalls,
        notSentCalls,
        measuredCostNanoUsd:
          execute && status === 'complete' && unknownCalls === 0 ? knownNanoUsd : null,
        knownCostLowerBoundNanoUsd: execute ? knownNanoUsd : null,
        scriptedCostNanoUsd: execute ? null : knownNanoUsd,
        rawInput: sum('input_tokens'),
        rawCacheWrite: sum('cache_creation_input_tokens'),
        rawCacheRead: sum('cache_read_input_tokens'),
        rawOutput: sum('output_tokens'),
        cacheReadShare:
          execute && status === 'complete' && unknownCalls === 0 && input
            ? sum('cache_read_input_tokens') / input
            : null,
      };
    };
    const report = {
      schema: 1,
      mode: execute ? 'live' : 'rehearsal',
      manifestHash,
      status,
      parity,
      budget: budget.snapshot(),
      results,
      events,
      measurements: {
        total: costs(),
        byRun: results.map((r) => ({
          arm: r.arm,
          scenario: r.scenario,
          ...costs(r.arm, r.scenario),
        })),
      },
      limitations: [
        'Two paired synthetic cases, one replicate each; not a general benchmark.',
        'Identity outcomes do not prove assertion truth.',
        'Arm cache partitions differ to prevent cross-arm reuse.',
        'All run costs include the first cold call.',
        'Rehearsal usage is scripted, uncached, and proves no hit or saving.',
        'Unfinished runs and unknown charges are not successful measurements.',
      ],
    };
    const serialized = JSON.stringify(report, null, 2) + '\n';
    if (Buffer.byteLength(serialized) > 4_194_304) throw new Error('pilot report byte cap');
    writeFileSync(out, serialized);
    return report;
  } finally {
    journal?.close();
    closeSync(out);
  }
}
async function main() {
  const args = process.argv.slice(2),
    allowed = new Set(['--consumer', '--out', '--approve-manifest', '--execute']),
    opts = {};
  for (let i = 0; i < args.length; i++) {
    const key = args[i];
    if (!allowed.has(key) || key in opts) throw new Error('pilot CLI option refused');
    opts[key] = key === '--execute' ? true : args[++i];
    if (opts[key] === undefined) throw new Error('pilot CLI value missing');
  }
  if (!opts['--consumer'] || !opts['--out'])
    throw new Error(
      'Use --consumer <reviewed-install> --out <new-report.json>. Default: offline rehearsal.',
    );
  const consumer = resolve(opts['--consumer']);
  const report = await pilot({
    consumer,
    output: resolve(opts['--out']),
    execute: opts['--execute'] === true,
    approvedManifest: opts['--approve-manifest'],
    getLiveTransport: async () => {
      const { liveTransport } = await import('./live.mjs');
      return liveTransport(consumer, process.env.ANTHROPIC_API_KEY);
    },
  });
  console.log(
    JSON.stringify({
      mode: report.mode,
      status: report.status,
      calls: report.budget.calls,
      manifestHash: report.manifestHash,
      spentUsd: report.mode === 'rehearsal' ? 0 : 'see raw usage; unknown calls remain reserved',
      reservedMicroUsd: report.budget.reservedMicroUsd,
    }),
  );
  if (report.status !== 'complete') process.exitCode = 1;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url))
  main().catch(() => {
    console.error('Pilot stopped; no automatic retry. Check the private journal/report.');
    process.exitCode = 1;
  });
