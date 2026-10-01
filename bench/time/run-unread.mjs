/**
 * bench/time/run-unread.mjs — the unread-words line bench (`RULE-unread.md`, rule
 * `time-rule-unread`): the T6b sheet's two unread phrases and two controls, arms `before` (the
 * released 9.134.2 build) and `after` (this build), both T6b's arm `on`, interleaved in one
 * invocation, every number read from the saved record.
 *
 *   npm run build                                                   # arm after: this checkout
 *   node bench/time/run-unread.mjs --before <dir>                   # the mock: each variant once, $0
 *   node --env-file=<file with ANTHROPIC_API_KEY> bench/time/run-unread.mjs --before <dir> \
 *     --provider anthropic --max-usd 0.35 --concurrency 2 --sdk-from <project with @anthropic-ai/sdk>
 *   node bench/time/run-unread.mjs --rescore <out dir>              # re-read saved runs, no call
 *
 * Flags: --provider mock|anthropic · --runs N (default 15 on anthropic) · --seed N (a paid run
 * draws a FRESH one when none is given, and records it) · --max-usd X (required for anthropic) ·
 * --concurrency K (at most 4) · --out <dir> · --sdk-from <dir> · --dry-run · --before <dir> (the
 * root of a built checkout of the reference commit; required to run).
 *
 * It reuses the T6b bench whole: the clock shift and the cap (`run.mjs` · `shiftClock`, `runPlan`
 * with its `prepare` hook), the harness (`harness.mjs` · `runCase`, `maxAnsweredAsks: 0` on the
 * unread cases), the sheet and the simulated person (`cases.mjs`). Only the arms, the cases and
 * the rule are its own (`rule-unread.mjs`).
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
  BUILD_MARK,
  RULE_ID,
  UNREAD_ARMS,
  UNREAD_CASES,
  UNREAD_ONLY,
  aggregateUnread,
  formatUnreadReport,
  formatVerdict,
  judge,
  unreadRowOf,
} from './rule-unread.mjs';
import { runPlan, shiftClock } from './run.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The registered defaults (`RULE-unread.md`, "The protocol"). */
export const DEFAULTS = Object.freeze({
  mockSeed: 20261001,
  anthropicModel: 'claude-haiku-4-5-20251001',
  anthropicRuns: 15,
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
    cases: UNREAD_CASES.map((id) => CASES.find((c) => c.id === id)),
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
      for (const arm of UNREAD_ARMS) round.push({ caseId: c.id, arm, rep });
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

/** One build's doors, from its `dist/esm` — the same names `run.mjs` · `loadDoors` reads. */
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
    englishTimeReader: main.englishTimeReader,
    isInputPause: main.isInputPause,
    mock: providers.mock,
    anthropic: providers.anthropic,
    recordRun: observe.recordRun,
  };
}

/** Whether a build serves the new line (its built `arguments/serve.js` holds the mark). */
function servesNewLine(dir) {
  const f = join(dir, 'dist', 'esm', 'core', 'agent', 'arguments', 'serve.js');
  return existsSync(f) && readFileSync(f, 'utf8').includes(BUILD_MARK);
}

/** `after` = this checkout's build; `before` = the reference build. Each refused if it is the other. */
async function loadDoors(beforeDir) {
  if (beforeDir === undefined)
    throw new Error('--before <dir>: the root of the built reference checkout');
  const root = resolve(HERE, '..', '..');
  const base = resolve(beforeDir);
  if (base === root)
    throw new Error('--before is this checkout: arm before must be the reference build');
  if (!servesNewLine(root))
    throw new Error('arm after: this build serves no new unread line — rebuild (npm run build)');
  if (servesNewLine(base))
    throw new Error('arm before: the reference build already serves the new unread line');
  const [before, after] = await Promise.all([doorsOf(base), doorsOf(root)]);
  return { before, after };
}

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

export function sortRows(rows) {
  return [...rows].sort(
    (a, b) =>
      UNREAD_ARMS.indexOf(a.arm) - UNREAD_ARMS.indexOf(b.arm) ||
      UNREAD_CASES.indexOf(a.caseId) - UNREAD_CASES.indexOf(b.caseId) ||
      a.rep - b.rep,
  );
}

function writeOutputs(dir, { config, spend, rows }) {
  const aggregates = aggregateUnread(rows);
  const arms = new Set(rows.map((r) => r.arm));
  const verdict = arms.has('before') && arms.has('after') ? judge(rows) : undefined;
  const results = { rule: RULE_ID, config, spend, rows, aggregates, ...(verdict && { verdict }) };
  writeFileSync(join(dir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const report = [
    `# Time unread-words bench — ${config.provider} · ${config.model} · seed ${config.seed}`,
    '',
    `Spend: $${spend.usd.toFixed(4)} over ${spend.runs} runs${
      spend.stopped ? ` (stopped at the cap: ${spend.stopped})` : ''
    }.`,
    '',
    formatUnreadReport(aggregates),
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
    const rows = sortRows(readRaws(dir).map(unreadRowOf));
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
    agentArm: 'on',
    concurrency: opts.concurrency,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(opts.maxUsd !== undefined && { maxUsd: opts.maxUsd }),
  };
  const estimate =
    opts.provider === 'mock'
      ? 0
      : plan.length * 1.5 * ((1300 * PRICES[opts.model].input + 120 * PRICES[opts.model].output) / 1e6);
  process.stdout.write(
    `time unread-words bench · ${opts.provider} · ${opts.model} · ${plan.length} runs · seed ${opts.seed}` +
      (opts.provider === 'mock'
        ? ' · $0\n'
        : ` · estimate ≈ $${estimate.toFixed(2)} · cap $${opts.maxUsd.toFixed(2)}\n`),
  );
  if (opts.dryRun) {
    process.stdout.write('dry run: nothing was called.\n');
    return;
  }
  const doors = await loadDoors(opts.before);
  // Preflight: each build arms T6b's arm `on`, or the run is refused before anything is spent.
  for (const arm of UNREAD_ARMS) {
    const d = doors[arm];
    buildAgent(d, 'on', d.mock({ replies: [{ content: 'preflight' }] }), 'mock', buildTools(d, []), ANCHOR);
  }
  const sdkClient = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const dir = resolve(
    opts.out ??
      (opts.provider === 'mock'
        ? join(tmpdir(), 'af-time-unread', `mock-${stamp()}`)
        : join(HERE, 'runs', `unread-${opts.provider}-${stamp()}`)),
  );
  mkdirSync(join(dir, 'raw'), { recursive: true });
  const prepare = (item) => ({
    doors: doors[item.arm],
    arm: 'on',
    ...(UNREAD_ONLY.includes(item.caseId) && { maxAnsweredAsks: 0 }),
  });
  const { raws, spend } = await runPlan({
    plan,
    doors: doors.after,
    opts: { ...opts, prepare },
    sdkClient,
    dir,
    log: (s) => process.stdout.write(s),
  });
  const rows = sortRows(raws.map(unreadRowOf));
  const { report } = writeOutputs(dir, { config, spend, rows });
  process.stdout.write(`${report}\nwritten: ${dir}\nspend: $${spend.usd.toFixed(4)}\n`);
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((err) => {
    const detail = process.env.AF_BENCH_DEBUG === '1' ? err?.stack : err?.message;
    process.stderr.write(`time unread bench: ${detail ?? err}\n`);
    process.exit(1);
  });
}
