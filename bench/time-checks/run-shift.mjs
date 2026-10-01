/**
 * bench/time-checks/run-shift.mjs — the pause/shift follow-up bench (`RULE-shift.md`, rule
 * `time-rule-shift`): the T8 sheet's pause case and two of its controls, arms `before` (the
 * reference build, the two-range line) and `after` (this build, the served conclusion)
 * interleaved in one invocation, every number read from the saved record.
 *
 *   npm run build                                                   # arm after: this checkout
 *   node bench/time-checks/run-shift.mjs --before <dir>             # the mock: each variant once, $0
 *   node --env-file=<file with ANTHROPIC_API_KEY> bench/time-checks/run-shift.mjs --before <dir> \
 *     --provider anthropic --max-usd 0.60 --concurrency 4 --sdk-from <project with @anthropic-ai/sdk>
 *   node bench/time-checks/run-shift.mjs --rescore <out dir>        # re-read saved runs, no call
 *
 * Flags: --provider mock|anthropic · --runs N (default 30 on anthropic) · --seed N (a paid run
 * draws a FRESH one when none is given, and records it) · --max-usd X (required for anthropic) ·
 * --concurrency K (at most 4) · --out <dir> · --sdk-from <dir> · --dry-run · --before <dir> (the
 * root of a built checkout of the reference commit; required to run).
 *
 * It reuses the T8 bench whole: the clock shift and the cap (`run.mjs` · `shiftClock`, `runPlan`),
 * the harness (`harness.mjs` · `runCase`), the truth and the labeller (`metrics.mjs` · `readRun`).
 * Only the arms, the cases and the rule are its own (`rule-shift.mjs`).
 */

import { randomInt } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { shuffled } from '../inputs/labels.mjs';
import { ANCHOR, CASES, sheetProblems } from './cases.mjs';
import { MAX_ITERATIONS, MAX_TOKENS, PRICES, buildAgent, buildTools } from './harness.mjs';
import {
  CONCLUSION_MARK,
  RULE_ID,
  SHIFT_ARMS,
  SHIFT_CASES,
  aggregateShift,
  formatShiftReport,
  formatVerdict,
  judge,
  shiftRowOf,
} from './rule-shift.mjs';
import { runPlan, shiftClock } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The registered defaults (`RULE-shift.md`, "The protocol"). */
export const DEFAULTS = Object.freeze({
  mockSeed: 20260930,
  anthropicModel: 'claude-haiku-4-5-20251001',
  anthropicRuns: 30,
});

/** Parses and validates the command line. Pure: throws a sentence for every refusal. */
export function parseArgs(argv, drawSeed = () => randomInt(1, 2 ** 31 - 1)) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) throw new Error(`unexpected argument '${a}'`);
    if (a === '--dry-run') {
      flags.set(a, true);
      continue;
    }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${a} needs a value`);
    flags.set(a, v);
    i += 1;
  }
  const known = [
    '--provider',
    '--runs',
    '--seed',
    '--max-usd',
    '--out',
    '--sdk-from',
    '--rescore',
    '--concurrency',
    '--before',
    '--dry-run',
  ];
  for (const k of flags.keys()) if (!known.includes(k)) throw new Error(`unknown flag ${k}`);
  const provider = flags.get('--provider') ?? 'mock';
  if (provider !== 'mock' && provider !== 'anthropic')
    throw new Error(`--provider must be mock or anthropic, saw '${provider}'`);
  const int = (name, fallback) => {
    const raw = flags.get(name);
    if (raw === undefined) return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 1)
      throw new Error(`${name} must be a positive integer, saw '${raw}'`);
    return n;
  };
  const runs = int('--runs', provider === 'anthropic' ? DEFAULTS.anthropicRuns : undefined);
  const seedGiven = int('--seed', undefined);
  const maxUsdRaw = flags.get('--max-usd');
  const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw);
  if (maxUsdRaw !== undefined && !(Number.isFinite(maxUsd) && maxUsd > 0))
    throw new Error(`--max-usd must be a positive number of dollars, saw '${maxUsdRaw}'`);
  const rescore = flags.get('--rescore');
  if (provider === 'anthropic' && maxUsd === undefined && rescore === undefined)
    throw new Error(
      '--provider anthropic needs --max-usd: a paid run names its cap before it starts',
    );
  const concurrency = int('--concurrency', 1);
  if (concurrency > 4) throw new Error(`--concurrency must be at most 4, saw ${concurrency}`);
  return {
    provider,
    model: provider === 'mock' ? 'mock' : DEFAULTS.anthropicModel,
    cases: CASES.filter((c) => SHIFT_CASES.includes(c.id)),
    runs,
    seed: seedGiven ?? (provider === 'mock' ? DEFAULTS.mockSeed : drawSeed()),
    seedDrawn: seedGiven === undefined && provider !== 'mock',
    concurrency,
    maxUsd,
    out: flags.get('--out'),
    sdkFrom: flags.get('--sdk-from'),
    dryRun: flags.get('--dry-run') === true,
    rescore,
    before: flags.get('--before'),
  };
}

/** Repetition by repetition, every (case, arm) pair in a seeded shuffle — the arms interleave. */
export function planOf({ cases, runs, seed, provider }) {
  const eachVariantOnce = provider === 'mock' && runs === undefined;
  const reps = eachVariantOnce ? Math.max(...cases.map((c) => c.mock.length)) : runs;
  const plan = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const round = [];
    for (const c of cases) {
      if (eachVariantOnce && rep >= c.mock.length) continue;
      for (const arm of SHIFT_ARMS) round.push({ caseId: c.id, arm, rep });
    }
    plan.push(...shuffled(round, seed + rep));
  }
  return plan;
}

async function loadSdkClient(sdkFrom) {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error(
      '--provider anthropic needs ANTHROPIC_API_KEY in the environment (node --env-file=<file>)',
    );
  let mod;
  try {
    mod = await import('@anthropic-ai/sdk');
  } catch {
    // Not installed here — the SDK is an optional peer of the package.
  }
  if (mod === undefined && sdkFrom !== undefined)
    mod = createRequire(join(resolve(sdkFrom), 'package.json'))('@anthropic-ai/sdk');
  if (mod === undefined)
    throw new Error('@anthropic-ai/sdk is not installed here; pass --sdk-from <dir>');
  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  return new Anthropic({ timeout: 120_000, maxRetries: 3 });
}

async function doorsOf(dir) {
  const entry = (name) => pathToFileURL(join(dir, 'dist', 'esm', `${name}.js`)).href;
  const [main, providers, observe] = await Promise.all([
    import(entry('index')),
    import(entry('doors/providers')),
    import(entry('doors/observe')),
  ]);
  return {
    Agent: main.Agent,
    defineTool: main.defineTool,
    describedResult: main.describedResult,
    inMemoryArtifacts: main.inMemoryArtifacts,
    isInputPause: main.isInputPause,
    mock: providers.mock,
    anthropic: providers.anthropic,
    recordRun: observe.recordRun,
  };
}

/** `after` = this checkout's build; `before` = the reference build. Each refused if it is the other. */
async function loadDoors(beforeDir) {
  if (beforeDir === undefined)
    throw new Error('--before <dir>: the root of the built reference checkout');
  const root = resolve(HERE, '..', '..');
  const base = resolve(beforeDir);
  if (base === root)
    throw new Error('--before is this checkout: arm before must be the reference build');
  const concludes = (dir) => {
    const f = join(dir, 'dist', 'esm', 'core', 'agent', 'coverage', 'period.js');
    return existsSync(f) && readFileSync(f, 'utf8').includes(CONCLUSION_MARK);
  };
  if (!concludes(root))
    throw new Error('arm after: this build serves no conclusion — rebuild (npm run build)');
  if (concludes(base))
    throw new Error('arm before: the reference build already serves the conclusion');
  const [before, after] = await Promise.all([doorsOf(base), doorsOf(root)]);
  return { before, after };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

export function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      SHIFT_ARMS.indexOf(a.arm) - SHIFT_ARMS.indexOf(b.arm) ||
      SHIFT_CASES.indexOf(a.caseId) - SHIFT_CASES.indexOf(b.caseId) ||
      a.rep - b.rep,
  );
}

function writeOutputs(dir, { config, spend, rows }) {
  const aggregates = aggregateShift(rows);
  const arms = new Set(rows.map((r) => r.arm));
  const verdict = arms.has('before') && arms.has('after') ? judge(rows) : undefined;
  const results = { rule: RULE_ID, config, spend, rows, aggregates, ...(verdict && { verdict }) };
  writeFileSync(join(dir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const report = [
    `# Time pause/shift bench — ${config.provider} · ${config.model} · seed ${config.seed}`,
    '',
    `Spend: $${spend.usd.toFixed(4)} over ${spend.runs} runs${
      spend.stopped ? ` (stopped at the cap: ${spend.stopped})` : ''
    }.`,
    '',
    formatShiftReport(aggregates),
    '',
    ...(verdict ? [formatVerdict(verdict)] : []),
    '',
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), report);
  return { report };
}

function readRaws(dir) {
  return readdirSync(join(dir, 'raw'))
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, 'raw', f))).toString('utf8')));
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.rescore !== undefined) {
    const dir = resolve(opts.rescore);
    const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    const rows = sortRows(readRaws(dir).map(shiftRowOf));
    process.stdout.write(
      `${writeOutputs(dir, { config: results.config, spend: results.spend, rows }).report}\n`,
    );
    return;
  }
  const problems = sheetProblems();
  if (problems.length > 0)
    throw new Error(`the case sheet is not sound:\n  ${problems.join('\n  ')}`);
  const plan = planOf(opts);
  const realStart = new Date().toISOString();
  const offsetMs = shiftClock(ANCHOR);
  const config = {
    provider: opts.provider,
    model: opts.model,
    cases: opts.cases.map((c) => c.id),
    runs: opts.runs ?? 'each scripted variant once',
    seed: opts.seed,
    ...(opts.seedDrawn && {
      seedDrawn: 'fresh, crypto.randomInt, at the start of this invocation',
    }),
    clock: { anchor: ANCHOR, realStart, offsetMs },
    before: resolve(opts.before ?? ''),
    concurrency: opts.concurrency,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(opts.maxUsd !== undefined && { maxUsd: opts.maxUsd }),
  };
  const estimate =
    opts.provider === 'mock'
      ? 0
      : plan.length *
        2.2 *
        ((1100 * PRICES[opts.model].input + 120 * PRICES[opts.model].output) / 1e6);
  process.stdout.write(
    `time pause/shift bench · ${opts.provider} · ${opts.model} · ${plan.length} runs · seed ${opts.seed}` +
      (opts.provider === 'mock'
        ? ' · $0\n'
        : ` · estimate ≈ $${estimate.toFixed(2)} · cap $${opts.maxUsd.toFixed(2)}\n`),
  );
  if (opts.dryRun) {
    process.stdout.write('dry run: nothing was called.\n');
    return;
  }
  const doors = await loadDoors(opts.before);
  for (const arm of SHIFT_ARMS)
    for (const c of opts.cases)
      buildAgent(
        doors[arm],
        doors[arm].mock({ replies: [{ content: 'preflight' }] }),
        'mock',
        buildTools(doors[arm], c, [], Date.parse(ANCHOR)),
        ANCHOR,
        c.clock !== undefined,
      );
  const sdkClient = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const dir = resolve(
    opts.out ??
      (opts.provider === 'mock'
        ? join(tmpdir(), 'af-time-shift-bench', `mock-${stamp()}`)
        : join(HERE, 'runs', `shift-${opts.provider}-${stamp()}`)),
  );
  mkdirSync(join(dir, 'raw'), { recursive: true });
  const { raws, spend } = await runPlan({
    plan,
    doors,
    opts,
    sdkClient,
    dir,
    log: (s) => process.stdout.write(s),
  });
  const rows = sortRows(raws.map(shiftRowOf));
  const { report } = writeOutputs(dir, { config, spend, rows });
  process.stdout.write(`${report}\nwritten: ${dir}\nspend: $${spend.usd.toFixed(4)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((err) => {
    process.stderr.write(
      `time pause/shift bench: ${
        process.env.AF_BENCH_DEBUG === '1' ? err?.stack : err?.message ?? err
      }\n`,
    );
    process.exit(1);
  });
}
