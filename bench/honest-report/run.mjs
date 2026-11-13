/**
 * bench/honest-report/run.mjs — runs the measurement (RULE.md § 8): the before commit, alone or
 * beside the after commit, on the same instances in one seeded shuffle, round by round.
 *
 *   npm run build                                            # the bench runs BUILT packages
 *   node bench/honest-report/run.mjs --rehearse --build-a <05cbef67 checkout> --build-b <same>   # $0
 *   # A paid run, in two steps under one ceiling (RULE.md § 8):
 *   node --env-file=<file> bench/honest-report/run.mjs --provider anthropic --model claude-haiku-5-5 \
 *     --max-usd 15 --build-a <05cbef67 checkout> --sdk-from <dir> --limit 20 --out <smoke>
 *   node --env-file=<file> bench/honest-report/judge.mjs --runs <smoke> --provider anthropic --sdk-from <dir>
 *   node --env-file=<file> bench/honest-report/judge.mjs --runs <smoke> --provider anthropic --sdk-from <dir> --second --all
 *   node --env-file=<file> bench/honest-report/run.mjs --provider anthropic --model claude-haiku-5-5 \
 *     --max-usd 15 --build-a <05cbef67 checkout> --sdk-from <dir> --smoke <smoke> --out <dir>
 *   node bench/honest-report/run.mjs --write-open-keys       # rewrite open-set/keys.json
 *
 * Flags: --rehearse · --provider anthropic · --model <id> · --max-usd X (required for a paid run;
 * at most 15) · --build-a <dir> (the before commit; default this checkout) · --build-b <dir> ·
 * --pack <dir> --seed-file <file> · --arms a,b · --reps N (core) · --side-reps N · --seed N ·
 * --limit N (the first N runs of the plan: the smoke step) · --smoke <dir> (the smoke step a full
 * paid run is priced from) · --concurrency K (≤ 4) · --out <dir> · --sdk-from <dir> ·
 * --fresh-build (always on for a paid run) · --dry-run.
 *
 * Outputs in --out: `plan.json` (config, builds, table digests, the set's digest, the order),
 * `runs.jsonl` (one line per run, written as it ends), `raw/<run>.json.gz` (the full raw record),
 * `spend.jsonl` (the one ledger of a paid run). A pack run also appends to `closed-looks.jsonl`.
 */

import { appendFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gzipSync } from 'node:zlib';

import { OUTSIDE_REPO, recordedDir } from '../recordedDir.mjs';
import { freshBuild, loadBuild } from './harness/build.mjs';
import { ledgerOf, maxUsdOf } from './harness/cost.mjs';
import { logLook } from './harness/looks.mjs';
import { rawFileName, runOne } from './harness/one-run.mjs';
import { planOf, spendStop } from './harness/plan.mjs';
import { anthropicProvider, loadSdkClient } from './harness/provider.mjs';
import { planWithin, readSmoke, smokeRefusal } from './harness/smoke.mjs';
import { ARMS, BEFORE_COMMIT, CORE_ARM, MODELS, PROPOSED, SMOKE_RUNS, tableDigest, tableRefusal, warningTableFor } from './rule-tables.mjs';
import { OPEN_KEYS_FILE, loadSet } from './tasks/sets.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');
export const DEFAULT_SEED = 20261113;

/** Parses the command line. Pure: throws a sentence for every refusal. */
export function parseArgs(argv) {
  const flags = new Map();
  const bare = new Set(['--rehearse', '--dry-run', '--write-open-keys', '--fresh-build']);
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
  const known = new Set(['--provider', '--model', '--max-usd', '--build-a', '--build-b', '--pack', '--seed-file', '--arms', '--reps', '--side-reps', '--seed', '--limit', '--smoke', '--concurrency', '--out', '--sdk-from', ...bare]);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag ${k}`);
  const rehearse = flags.get('--rehearse') === true;
  const provider = rehearse ? 'scripted' : flags.get('--provider');
  if (!flags.get('--write-open-keys') && provider !== 'scripted' && provider !== 'anthropic') {
    throw new Error('say what runs: --rehearse (scripted model, no network) or --provider anthropic');
  }
  if (rehearse && flags.has('--provider')) throw new Error('--rehearse runs the scripted model: no --provider');
  const maxUsdRaw = flags.get('--max-usd');
  const maxUsd = maxUsdRaw === undefined ? undefined : maxUsdOf(maxUsdRaw);
  if (provider === 'anthropic' && maxUsd === undefined) throw new Error('--provider anthropic needs --max-usd: a paid run names its spend limit before it starts');
  const model = flags.get('--model');
  if (provider === 'anthropic') {
    if (model === undefined) throw new Error(`--provider anthropic needs --model ${MODELS.agent}`);
    if (model !== MODELS.agent) throw new Error(`--model ${model}: RULE.md § 3 names ${MODELS.agent} for the agent`);
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
  const limit = int('--limit', undefined);
  const smoke = flags.get('--smoke');
  if (provider === 'anthropic' && smoke === undefined && (limit === undefined || limit > SMOKE_RUNS)) {
    throw new Error(`a paid run is priced from its smoke step first: run --limit ${SMOKE_RUNS}, judge it with both judges, then pass --smoke <that folder> (RULE.md § 8)`);
  }
  if (smoke !== undefined && provider !== 'anthropic') throw new Error('--smoke prices a paid run: it needs --provider anthropic');
  return {
    rehearse,
    provider,
    model,
    maxUsd,
    buildA: flags.get('--build-a'),
    buildB: flags.get('--build-b'),
    pack: flags.get('--pack'),
    seedFile: flags.get('--seed-file'),
    arms,
    reps: int('--reps', PROPOSED.coreRepetitions),
    sideReps: int('--side-reps', PROPOSED.sideRepetitions),
    seed: int('--seed', DEFAULT_SEED, 0),
    limit,
    smoke,
    concurrency,
    out: flags.get('--out'),
    sdkFrom: flags.get('--sdk-from'),
    freshBuild: flags.get('--fresh-build') === true || provider === 'anthropic',
    dryRun: flags.get('--dry-run') === true,
    writeOpenKeys: flags.get('--write-open-keys') === true,
  };
}

/** The open set's keys as committed: stable bytes. */
export function openKeysText() {
  const s = loadSet();
  return `${JSON.stringify({ set: s.set, setDigest: s.digest, instances: s.instances }, null, 1)}\n`;
}

/** Why the builds may not run (RULE.md § 3, § 7), or undefined: A is the before commit; every table is frozen. */
export function buildsRefusal(builds) {
  if (builds[0].commit.slice(0, 8) !== BEFORE_COMMIT) return `build A is commit ${builds[0].commit.slice(0, 8)}: RULE.md § 3 measures the before commit ${BEFORE_COMMIT} as build A (pass --build-a <its checkout>)`;
  for (const b of builds) {
    const why = tableRefusal(b.commit);
    if (why !== undefined) return `build ${b.label}: ${why}`;
  }
  return undefined;
}

/** Why `out` may not hold this set's rows (RULE.md § 9), or undefined: a pack's rows never land in the checkout. */
export function outRefusal(set, out) {
  if (set === 'open') return undefined;
  if (out === undefined) return `set ${set} is a closed set: name an output folder outside this checkout (--out)`;
  if (recordedDir(out) !== OUTSIDE_REPO) return `set ${set} is a closed set: its rows never land inside this checkout (--out ${recordedDir(out)})`;
  return undefined;
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
  const outRefused = outRefusal(set.set, opts.out);
  if (outRefused !== undefined) throw new Error(outRefused);
  const dirs = [opts.buildA ?? ROOT, ...(opts.buildB === undefined ? [] : [opts.buildB])];
  if (opts.freshBuild && !opts.dryRun) for (const d of new Set(dirs.map((d) => resolve(d)))) freshBuild(d);
  const builds = [await loadBuild(dirs[0], 'A'), ...(dirs[1] === undefined ? [] : [await loadBuild(dirs[1], 'B')])];
  const refused = buildsRefusal(builds);
  if (refused !== undefined) throw new Error(refused);
  const byId = new Map(set.instances.map((k) => [k.id, k]));
  const tasks = new Map(set.baseTasks.map((t) => [t.id, t]));
  const isTrap = (id) => byId.get(id)?.role === 'trap';
  let plan = planOf({ instances: set.instances, arms: opts.arms, builds: builds.map((b) => b.label), coreReps: opts.reps, sideReps: opts.sideReps, seed: opts.seed });
  if (opts.limit !== undefined) plan = plan.slice(0, opts.limit);
  let smoke;
  let projection;
  if (opts.smoke !== undefined) {
    smoke = readSmoke(resolve(opts.smoke));
    const why = smokeRefusal(smoke, { model: opts.model });
    if (why !== undefined) throw new Error(`refused after the smoke step: ${why}`);
    const fit = planWithin({ plan, smoke, maxUsd: opts.maxUsd, isTrap });
    projection = fit.projection;
    process.stdout.write(`cost: $${smoke.usdPerRun.mean.toFixed(5)} a run (dearest $${smoke.usdPerRun.max.toFixed(5)}), judges $${smoke.firstJudgeUsd.toFixed(5)} / $${smoke.secondJudgeUsd.toFixed(5)} an answer; smoke spent $${smoke.spent.toFixed(4)}\n`);
    for (const r of (fit.fullProjection ?? projection).rounds) process.stdout.write(`  round ${r.round} (${r.core ? 'core' : 'side arms'}): ${r.runs} runs, projected $${r.usd.toFixed(2)} with judging\n`);
    process.stdout.write(`  the second judge's sample beyond the trap runs: $${projection.sampleExtra.toFixed(2)} · whole plan $${(fit.fullProjection ?? projection).total.toFixed(2)} against $${opts.maxUsd}\n`);
    if (fit.refusal !== undefined) throw new Error(`refused: ${fit.refusal}`);
    if (fit.droppedSide) process.stdout.write(`  the whole plan does not fit: the side arms are cut by the plan (RULE.md § 8); ${fit.plan.length} core runs remain, projected $${projection.total.toFixed(2)}\n`);
    if (projection.total > opts.maxUsd) process.stdout.write('  the core alone does not fit whole either: the spend stop will end the run inside a later core round, and only complete rounds are analysed\n');
    plan = fit.plan;
  }
  const tables = Object.fromEntries(builds.map((b) => [b.label, tableDigest(warningTableFor(b.commit))]));
  const config = {
    rule: 'bench/honest-report/RULE.md',
    provider: opts.provider,
    model: opts.provider === 'scripted' ? 'mock (scripted)' : opts.model,
    set: set.set,
    setDigest: set.digest,
    seed: opts.seed,
    arms: [...new Set(plan.map((p) => p.arm))],
    coreReps: opts.reps,
    sideReps: opts.sideReps,
    settings: { samplingParameters: 'none sent', maxTokens: PROPOSED.maxTokens, maxIterations: PROPOSED.maxIterations, sdkMaxRetries: PROPOSED.sdkMaxRetries },
    builds: builds.map((b) => ({ label: b.label, commit: b.commit, version: b.version, where: b.where, dist: b.dist, freshBuild: opts.freshBuild })),
    tables,
    ...(opts.maxUsd !== undefined && { maxUsd: opts.maxUsd }),
    ...(opts.limit !== undefined && { limit: opts.limit }),
    ...(smoke !== undefined && { smoke: { where: recordedDir(resolve(opts.smoke)), spent: smoke.spent, usdPerRun: smoke.usdPerRun } }),
    startedAt: new Date().toISOString(),
  };
  process.stdout.write(`honest-report · ${config.model} · set ${set.set} (${set.instances.length} instances) · builds ${builds.map((b) => `${b.label}=${b.commit.slice(0, 8)}`).join(', ')} · ${plan.length} runs\n`);
  if (opts.dryRun) return;
  const sdk = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const out = resolve(opts.out ?? (opts.rehearse ? join(tmpdir(), 'af-honest-report', `rehearsal-${stamp()}`) : join(HERE, 'runs', `${opts.provider}-${stamp()}`)));
  if (existsSync(join(out, 'plan.json'))) throw new Error(`${out} already holds a run: no run is ever re-run (RULE.md § 5)`);
  mkdirSync(join(out, 'raw'), { recursive: true });
  writeFileSync(join(out, 'plan.json'), `${JSON.stringify({ config, plan }, null, 1)}\n`);
  if (set.set !== 'open') logLook(out, { command: 'run', set: set.set, setDigest: set.digest });
  const ledger = ledgerOf(out);
  if (smoke !== undefined && smoke.spent > 0) ledger.pay({ who: 'smoke step (carried over)', usd: smoke.spent });
  const spend = spendStop({ maxUsd: opts.maxUsd === undefined ? undefined : opts.maxUsd - (projection?.sampleExtra ?? 0), ledger, dearestUsd: smoke?.usdPerRun.max ?? 0 });
  const judgeUsdOf = (p) => (smoke === undefined ? 0 : smoke.firstJudgeUsd + (p.arm === CORE_ARM && isTrap(p.instanceId) ? smoke.secondJudgeUsd : 0));
  const byLabel = new Map(builds.map((b) => [b.label, b]));
  let next = 0;
  let finished = 0;
  const line = (row) => appendFileSync(join(out, 'runs.jsonl'), `${JSON.stringify(row)}\n`);
  const worker = async () => {
    while (next < plan.length) {
      const i = next;
      next += 1;
      const p = plan[i];
      const meta = { runKey: `${p.build}/${p.arm}/${p.instanceId}/r${p.rep}`, instanceId: p.instanceId, arm: p.arm, rep: p.rep, round: p.round, build: { label: p.build } };
      const reserve = spend.admit(i, judgeUsdOf(p));
      if (reserve === undefined) {
        line({ ...meta, ending: 'not-started' });
        continue;
      }
      const raw = await runOne({
        build: byLabel.get(p.build),
        key: byId.get(p.instanceId),
        task: tasks.get(byId.get(p.instanceId).baseTask),
        arm: p.arm,
        rep: p.rep,
        round: p.round,
        provider: opts.provider,
        model: opts.model,
        wire: sdk === undefined ? undefined : (doors, served) => anthropicProvider(doors, sdk, served),
      });
      if (opts.provider !== 'scripted') ledger.pay({ who: 'run', usd: raw.usd, runKey: raw.runKey });
      spend.paid(raw.usd, reserve);
      writeFileSync(join(out, 'raw', rawFileName(raw.runKey)), gzipSync(JSON.stringify(raw)));
      line({ ...meta, build: raw.build, ending: raw.ending, usd: raw.usd, durationMs: raw.durationMs, ...(raw.httpStatus !== undefined && { httpStatus: raw.httpStatus }), ...(raw.error !== undefined && { error: raw.error.slice(0, 300) }) });
      finished += 1;
      // Give timers a turn between runs. A scripted run settles on microtasks alone, and the
      // engine's deferred deliveries wait on a timer: back-to-back runs that never yield keep
      // every run's deferred work alive (the first full rehearsal ran out of heap after 2,972
      // runs; measured by a loop of bare agent runs, flat with this yield, growing without it).
      await new Promise((r) => setTimeout(r, 0));
      if (finished % 100 === 0 || opts.provider !== 'scripted') process.stdout.write(`  ${finished}/${plan.length} ${raw.runKey} · ${raw.ending} · $${ledger.total().toFixed(4)}\n`);
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  const stopped = spend.state.stoppedBefore === undefined ? '' : ` · stopped at the spend limit before run ${spend.state.stoppedBefore + 1}`;
  process.stdout.write(`done: ${finished} runs · $${ledger.total().toFixed(4)}${stopped}\nwritten: ${out}\n`);
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

