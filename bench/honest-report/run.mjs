/**
 * bench/honest-report/run.mjs — runs the measurement (RULE.md § 8): one library build, or two
 * side by side, on the same instances in one seeded shuffle.
 *
 *   npm run build                                          # the bench runs the BUILT package
 *   node bench/honest-report/run.mjs --rehearse --build-b . # $0: scripted model, both "builds"
 *   node --env-file=<file> bench/honest-report/run.mjs --provider anthropic --model <id> \
 *     --max-usd 15 --build-b <a second, built checkout> --sdk-from <dir with @anthropic-ai/sdk> \
 *     [--pack <folder> --seed-file <file>]
 *   node bench/honest-report/run.mjs --write-open-keys     # rewrite open-set/keys.json
 *
 * Flags: --rehearse · --provider anthropic · --model <id> · --max-usd X (required for a paid run)
 * · --build-b <dir> · --pack <dir> --seed-file <file> · --arms a,b · --reps N (core) ·
 * --side-reps N · --seed N · --limit N (the first N runs of the plan; a smoke run) ·
 * --concurrency K (≤ 4) · --out <dir> · --sdk-from <dir> · --dry-run.
 *
 * Outputs in --out: `plan.json` (config, builds, the set's digest, the order), `runs.jsonl` (one
 * line per run, written as it ends), `raw/<run>.json.gz` (the full raw record). Then:
 * `judge.mjs --runs <out>`, `score.mjs --runs <out>`.
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { PRICES } from '../inputs/harness.mjs';
import { recordedDir } from '../recordedDir.mjs';
import { loadBuild } from './harness/build.mjs';
import { rawFileName, runOne } from './harness/one-run.mjs';
import { planOf, spendStop } from './harness/plan.mjs';
import { anthropicProvider, loadSdkClient } from './harness/provider.mjs';
import { ARMS, PROPOSED, warningTableFor } from './rule-tables.mjs';
import { OPEN_KEYS_FILE, loadSet } from './tasks/sets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const DEFAULT_SEED = 20261113;

/** Parses the command line. Pure: throws a sentence for every refusal. */
export function parseArgs(argv) {
  const flags = new Map();
  const bare = new Set(['--rehearse', '--dry-run', '--write-open-keys']);
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument '${a}'`);
    if (bare.has(a)) {
      flags.set(a, true);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    flags.set(a, v);
    i += 1;
  }
  const known = new Set(['--provider', '--model', '--max-usd', '--build-b', '--pack', '--seed-file', '--arms', '--reps', '--side-reps', '--seed', '--limit', '--concurrency', '--out', '--sdk-from', ...bare]);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag ${k}`);
  const rehearse = flags.get('--rehearse') === true;
  const provider = rehearse ? 'scripted' : flags.get('--provider');
  if (!flags.get('--write-open-keys') && provider !== 'scripted' && provider !== 'anthropic') {
    throw new Error('say what runs: --rehearse (scripted model, no network) or --provider anthropic');
  }
  if (rehearse && flags.has('--provider')) throw new Error('--rehearse runs the scripted model: no --provider');
  const maxUsdRaw = flags.get('--max-usd');
  const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw);
  if (maxUsdRaw !== undefined && !(Number.isFinite(maxUsd) && maxUsd > 0)) throw new Error(`--max-usd must be a positive number of dollars, saw '${maxUsdRaw}'`);
  if (provider === 'anthropic' && maxUsd === undefined) throw new Error('--provider anthropic needs --max-usd: a paid run names its spend limit before it starts');
  const model = flags.get('--model');
  if (provider === 'anthropic') {
    if (model === undefined) throw new Error('--provider anthropic needs --model <dated model id>');
    if (PRICES[model] === undefined) throw new Error(`--model ${model}: no price row; add its rates to bench/inputs/harness.mjs · PRICES first`);
  }
  const arms = (flags.get('--arms') ?? ARMS.map((a) => a.id).join(',')).split(',').map((s) => s.trim());
  for (const arm of arms) if (!ARMS.some((a) => a.id === arm)) throw new Error(`--arms: unknown arm '${arm}'`);
  if (new Set(arms).size !== arms.length) throw new Error('--arms: an arm is named twice');
  const int = (name, fallback, min = 1) => {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) throw new Error(`${name} must be an integer of at least ${min}, saw '${raw}'`);
    return n;
  };
  const concurrency = int('--concurrency', 1);
  if (concurrency > 4) throw new Error('--concurrency must be at most 4');
  if (flags.has('--pack') !== flags.has('--seed-file')) throw new Error('--pack and --seed-file come together');
  return {
    rehearse,
    provider,
    model,
    maxUsd,
    buildB: flags.get('--build-b'),
    pack: flags.get('--pack'),
    seedFile: flags.get('--seed-file'),
    arms,
    reps: int('--reps', PROPOSED.coreRepetitions),
    sideReps: int('--side-reps', PROPOSED.sideRepetitions),
    seed: int('--seed', DEFAULT_SEED, 0),
    limit: int('--limit', undefined),
    concurrency,
    out: flags.get('--out'),
    sdkFrom: flags.get('--sdk-from'),
    dryRun: flags.get('--dry-run') === true,
    writeOpenKeys: flags.get('--write-open-keys') === true,
  };
}

/** The open set's keys as committed: stable bytes. */
export function openKeysText() {
  const s = loadSet();
  return `${JSON.stringify({ set: s.set, seedDigest: s.digest, instances: s.instances }, null, 1)}\n`;
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.writeOpenKeys) {
    writeFileSync(OPEN_KEYS_FILE, openKeysText());
    process.stdout.write(`written: ${recordedDir(OPEN_KEYS_FILE)}\n`);
    return;
  }
  const set = loadSet({ pack: opts.pack, seedFile: opts.seedFile });
  const builds = [await loadBuild(ROOT, 'A')];
  if (opts.buildB !== undefined) builds.push(await loadBuild(opts.buildB, 'B'));
  for (const b of builds) if (warningTableFor(b.commit) === undefined) throw new Error(`build ${b.label} is commit ${b.commit.slice(0, 8)}: RULE.md has no warning table for it; write one first (RULE.md § 7)`);
  const byId = new Map(set.instances.map((k) => [k.id, k]));
  const tasks = new Map(set.baseTasks.map((t) => [t.id, t]));
  let plan = planOf({ instances: set.instances, arms: opts.arms, builds: builds.map((b) => b.label), coreReps: opts.reps, sideReps: opts.sideReps, seed: opts.seed });
  if (opts.limit !== undefined) plan = plan.slice(0, opts.limit);
  const config = {
    rule: 'bench/honest-report/RULE.md',
    provider: opts.provider,
    model: opts.provider === 'scripted' ? 'mock (scripted)' : opts.model,
    set: set.set,
    setDigest: set.digest,
    seed: opts.seed,
    arms: opts.arms,
    coreReps: opts.reps,
    sideReps: opts.sideReps,
    settings: { temperature: PROPOSED.temperature, maxTokens: PROPOSED.maxTokens, maxIterations: PROPOSED.maxIterations, sdkMaxRetries: PROPOSED.sdkMaxRetries },
    builds: builds.map((b) => ({ label: b.label, commit: b.commit, version: b.version, where: b.where })),
    ...(opts.maxUsd !== undefined && { maxUsd: opts.maxUsd }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    startedAt: new Date().toISOString(),
  };
  process.stdout.write(`honest-report · ${config.model} · set ${set.set} (${set.instances.length} instances) · builds ${builds.map((b) => `${b.label}=${b.commit.slice(0, 8)}`).join(', ')} · ${plan.length} runs\n`);
  if (opts.dryRun) return;
  const sdk = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const out = resolve(opts.out ?? (opts.rehearse ? join(tmpdir(), 'af-honest-report', `rehearsal-${stamp()}`) : join(HERE, 'runs', `${opts.provider}-${stamp()}`)));
  mkdirSync(join(out, 'raw'), { recursive: true });
  writeFileSync(join(out, 'plan.json'), `${JSON.stringify({ config, plan }, null, 1)}\n`);
  const spend = spendStop({ maxUsd: opts.maxUsd });
  const byLabel = new Map(builds.map((b) => [b.label, b]));
  let next = 0;
  let finished = 0;
  const line = (row) => appendFileSync(join(out, 'runs.jsonl'), `${JSON.stringify(row)}\n`);
  const worker = async () => {
    while (next < plan.length) {
      const i = next;
      next += 1;
      const p = plan[i];
      const meta = { runKey: `${p.build}/${p.arm}/${p.instanceId}/r${p.rep}`, instanceId: p.instanceId, arm: p.arm, rep: p.rep, build: { label: p.build } };
      if (!spend.admit(i)) {
        line({ ...meta, ending: 'not-started' });
        continue;
      }
      const raw = await runOne({
        build: byLabel.get(p.build),
        key: byId.get(p.instanceId),
        task: tasks.get(byId.get(p.instanceId).baseTask),
        arm: p.arm,
        rep: p.rep,
        provider: opts.provider,
        model: opts.model,
        wire: sdk === undefined ? undefined : (doors, served) => anthropicProvider(doors, sdk, served),
      });
      spend.paid(raw.usd);
      writeFileSync(join(out, 'raw', rawFileName(raw.runKey)), gzipSync(JSON.stringify(raw)));
      line({ ...meta, build: raw.build, ending: raw.ending, usd: raw.usd, durationMs: raw.durationMs });
      finished += 1;
      // Give timers a turn between runs. A scripted run settles on microtasks alone, and the
      // engine's deferred deliveries wait on a timer: back-to-back runs that never yield keep
      // every run's deferred work alive (the first full rehearsal ran out of heap after 2,972
      // runs; measured by a loop of bare agent runs, flat with this yield, growing without it).
      await new Promise((r) => setTimeout(r, 0));
      if (finished % 100 === 0 || opts.provider !== 'scripted') process.stdout.write(`  ${finished}/${plan.length} ${raw.runKey} · ${raw.ending} · $${spend.state.usd.toFixed(4)}\n`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  const stopped = spend.state.stoppedBefore === undefined ? '' : ` · stopped at the spend limit before run ${spend.state.stoppedBefore + 1}`;
  process.stdout.write(`done: ${finished} runs · $${spend.state.usd.toFixed(4)}${stopped}\nwritten: ${out}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  // The evidence gate's dev-mode sentence is the library talking to a developer; the bench reads
  // the record, so the console copy is counted, not printed (the answer bench's habit).
  // The engine's own "Error in pipeline" line for a stage that threw (a scripted service fault,
  // a tool that throws) is the same: the ending is read from the record, the line is counted.
  let silenced = 0;
  const warn = console.warn;
  const error = console.error;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[agentfootprint]')) silenced += 1;
    else warn(...args);
  };
  console.error = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('Error in pipeline')) silenced += 1;
    else error(...args);
  };
  main()
    .then(() => {
      if (silenced > 0) process.stdout.write(`(${silenced} library console lines not printed: dev-mode warnings and pipeline errors)\n`);
    })
    .catch((err) => {
      process.stderr.write(`honest-report: ${process.env.AF_BENCH_DEBUG === '1' ? err?.stack : err?.message ?? err}\n`);
      process.exit(1);
    });
}
