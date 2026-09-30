/**
 * bench/time/run.mjs — the English-reader bench (time design § 13, step T6b): provoking cases and
 * controls, arms off and on interleaved in one invocation, every number read from the saved record
 * and the planted truth.
 *
 *   npm run build                                   # the bench runs the built package
 *   node bench/time/run.mjs                         # the mock: every scripted variant once, $0
 *   node --env-file=<file with ANTHROPIC_API_KEY> bench/time/run.mjs \
 *     --provider anthropic --max-usd 3.00 [--sdk-from <project with @anthropic-ai/sdk>] \
 *     [--runs N] [--concurrency 4] [--dry-run]      # Haiku 4.5, the registered run
 *   node bench/time/run.mjs --rescore <out dir>     # re-read saved runs; no model call
 *
 * Flags: --provider mock|anthropic · --model <id> (a Haiku 4.5 id) · --cases <id|cell>,… ·
 * --runs N · --seed N (a paid run draws a FRESH seed when none is given, and records it) ·
 * --max-usd X (required for anthropic) · --temperature T (sent only when given; the registered
 * run sends none) · --concurrency K (at most 4) · --out <dir> · --dry-run.
 *
 * THE CLOCK. The sheet's truths are planted at `cases.mjs` · `ANCHOR` (Friday 9 Oct 2026, 09:00
 * in Los Angeles). The library reads the dispatch clock from `Date.now()` (§ 7.4), so this script
 * SHIFTS the process clock to start at the anchor (`shiftClock`) before anything runs; each run's
 * `now` is the shifted clock at its start, to the second. The shift is recorded in the config.
 *
 * WHAT IT WRITES (in --out; default bench/time/runs/anthropic-<stamp> for a paid run, the system
 * temp directory for a mock run): results.json (config with the seed, spend, rows, aggregates,
 * the verdict), report.md, raw/*.json.gz.
 *
 * THE KEY. The Anthropic SDK client reads ANTHROPIC_API_KEY from the environment itself
 * (`node --env-file=…`); this script only checks that the variable is set.
 *
 * THE CAP. A paid run names its cap. Before each run the bench projects its cost (the dearest
 * run so far × 1.25, never under $0.02) and stops, on the record, rather than cross the cap.
 */

import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { shuffled } from '../inputs/labels.mjs';
import { ANCHOR, ARMS, CASES, sheetProblems } from './cases.mjs';
import { MAX_ITERATIONS, MAX_TOKENS, PRICES, buildAgent, buildTools, runCase } from './harness.mjs';
import { aggregate, formatReport, readRun } from './metrics.mjs';
import { RULE_ID, formatVerdict, judge } from './rule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));

/** The registered defaults (`RULE.md`, "The protocol"). */
export const DEFAULTS = Object.freeze({
  mockSeed: 20260930,
  anthropicModel: 'claude-haiku-4-5-20251001',
  anthropicRuns: 15,
  priorRunUsd: 0.02,
});

// ── the clock ────────────────────────────────────────────────────────────────

/**
 * Shifts the process clock so `Date.now()` and `new Date()` start at `anchorIso` and advance in
 * real time. Returns the offset in ms. Installed once, before the library runs.
 */
export function shiftClock(anchorIso) {
  const RealDate = globalThis.Date;
  const offset = Date.parse(anchorIso) - RealDate.now();
  class ShiftedDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(RealDate.now() + offset);
      else super(...args);
    }
    static now() {
      return RealDate.now() + offset;
    }
  }
  globalThis.Date = ShiftedDate;
  return offset;
}

/** The run's `now`: the (shifted) clock at its start, to the second. */
export function runNow() {
  return new Date(Math.floor(Date.now() / 1000) * 1000).toISOString();
}

// ── arguments ────────────────────────────────────────────────────────────────

/** Parses and validates the command line. Pure: throws a sentence for every refusal. */
export function parseArgs(argv, drawSeed = () => randomInt(1, 2 ** 31 - 1)) {
  const flags = new Map();
  const bare = new Set(['--dry-run']);
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
  const known = new Set([
    '--provider',
    '--model',
    '--cases',
    '--runs',
    '--seed',
    '--max-usd',
    '--temperature',
    '--out',
    '--sdk-from',
    '--rescore',
    '--concurrency',
    ...bare,
  ]);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag ${k}`);

  const provider = flags.get('--provider') ?? 'mock';
  if (provider !== 'mock' && provider !== 'anthropic')
    throw new Error(`--provider must be mock or anthropic, saw '${provider}'`);
  const model = flags.get('--model') ?? (provider === 'mock' ? 'mock' : DEFAULTS.anthropicModel);
  if (provider === 'mock' && model !== 'mock') throw new Error('--provider mock runs model mock');
  if (provider === 'anthropic' && (PRICES[model] === undefined || model === 'mock'))
    throw new Error(`--model ${model}: the registered run is Haiku 4.5 only`);

  const picked = flags.get('--cases');
  let cases = CASES;
  if (picked !== undefined) {
    const want = picked.split(',').map((s) => s.trim());
    cases = CASES.filter((c) => want.includes(c.id) || want.includes(c.cell));
    const unknown = want.filter((w) => !CASES.some((c) => c.id === w || c.cell === w));
    if (unknown.length > 0) throw new Error(`--cases: no case or cell ${unknown.join(', ')}`);
  }
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
  const seed = seedGiven ?? (provider === 'mock' ? DEFAULTS.mockSeed : drawSeed());
  const maxUsdRaw = flags.get('--max-usd');
  const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw);
  if (maxUsdRaw !== undefined && !(Number.isFinite(maxUsd) && maxUsd > 0))
    throw new Error(`--max-usd must be a positive number of dollars, saw '${maxUsdRaw}'`);
  const rescore = flags.get('--rescore');
  if (provider === 'anthropic' && maxUsd === undefined && rescore === undefined)
    throw new Error(
      '--provider anthropic needs --max-usd: a paid run names its cap before it starts',
    );
  const temperatureRaw = flags.get('--temperature');
  const temperature = temperatureRaw === undefined ? undefined : Number(temperatureRaw);
  if (
    temperatureRaw !== undefined &&
    !(Number.isFinite(temperature) && temperature >= 0 && temperature <= 1)
  )
    throw new Error(`--temperature must be between 0 and 1, saw '${temperatureRaw}'`);
  const concurrency = int('--concurrency', 1);
  if (concurrency > 4) throw new Error(`--concurrency must be at most 4, saw ${concurrency}`);
  return {
    provider,
    model,
    cases,
    runs,
    seed,
    seedDrawn: seedGiven === undefined && provider !== 'mock',
    concurrency,
    maxUsd,
    temperature,
    out: flags.get('--out'),
    sdkFrom: flags.get('--sdk-from'),
    dryRun: flags.get('--dry-run') === true,
    rescore,
  };
}

/**
 * The run order: repetition by repetition, and within each repetition every (case, arm) pair in
 * a seeded shuffle — the arms interleave, so drift over the run falls on both. On the mock with
 * no `--runs`, each case runs each of its scripted variants once, under each arm.
 */
export function planOf({ cases, runs, seed, provider }) {
  const eachVariantOnce = provider === 'mock' && runs === undefined;
  const reps = eachVariantOnce ? Math.max(...cases.map((c) => c.mock.length)) : runs;
  const plan = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const round = [];
    for (const c of cases) {
      if (eachVariantOnce && rep >= c.mock.length) continue;
      for (const arm of ARMS) round.push({ caseId: c.id, arm, rep });
    }
    plan.push(...shuffled(round, seed + rep));
  }
  return plan;
}

/** The raw file a run is saved under (`arm__case__rN.json.gz` — injective: ids are `[a-z0-9-]`). */
export function rawFileName(key) {
  return `${key.split('/').join('__')}.json.gz`;
}

// ── the provider and the doors ───────────────────────────────────────────────

async function loadSdkClient(sdkFrom) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      '--provider anthropic needs ANTHROPIC_API_KEY in the environment (node --env-file=<file>); ' +
        'the bench never reads the file itself',
    );
  }
  let mod;
  try {
    mod = await import('@anthropic-ai/sdk');
  } catch {
    // Not installed here — the SDK is an optional peer of the package.
  }
  if (mod === undefined && sdkFrom !== undefined) {
    mod = createRequire(join(resolve(sdkFrom), 'package.json'))('@anthropic-ai/sdk');
  }
  if (mod === undefined)
    throw new Error(
      '@anthropic-ai/sdk is not installed here; pass --sdk-from <a project whose node_modules has it>',
    );
  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  return new Anthropic({ timeout: 120_000, maxRetries: 3 });
}

/** The library's doors, from the BUILT package (`npm run build` first). */
async function loadDoors() {
  const [{ Agent, defineTool, englishTimeReader, isInputPause }, { mock, anthropic }, { recordRun }] =
    await Promise.all([
      import('agentfootprint'),
      import('agentfootprint/providers'),
      import('agentfootprint/observe'),
    ]);
  return { Agent, defineTool, englishTimeReader, isInputPause, mock, anthropic, recordRun };
}

// ── outputs ──────────────────────────────────────────────────────────────────

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

/** Rows in a fixed order: arm (off, on), case (sheet order), repetition. */
export function sortRows(rows) {
  const caseIndex = new Map(CASES.map((c, i) => [c.id, i]));
  const armIndex = { off: 0, on: 1 };
  return [...rows].sort(
    (a, b) =>
      armIndex[a.arm] - armIndex[b.arm] ||
      caseIndex.get(a.caseId) - caseIndex.get(b.caseId) ||
      a.rep - b.rep,
  );
}

function verdictOf(rows) {
  const arms = new Set(rows.map((r) => r.arm));
  return arms.has('off') && arms.has('on') ? judge(rows) : undefined;
}

function writeOutputs(dir, { config, spend, rows }) {
  const aggregates = aggregate(rows);
  const verdict = verdictOf(rows);
  const results = { rule: RULE_ID, config, spend, rows, aggregates, ...(verdict && { verdict }) };
  writeFileSync(join(dir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const report = [
    `# Time bench (T6b) — ${config.provider} · ${config.model} · seed ${config.seed}`,
    '',
    `Spend: $${spend.usd.toFixed(4)} over ${spend.runs} runs${
      spend.stopped ? ` (stopped at the cap: ${spend.stopped})` : ''
    }.`,
    '',
    formatReport(aggregates),
    '',
    ...(verdict ? [formatVerdict(verdict)] : []),
    '',
  ].join('\n');
  writeFileSync(join(dir, 'report.md'), report);
  return { results, report };
}

// ── the commands ─────────────────────────────────────────────────────────────

function readRaws(dir) {
  return readdirSync(join(dir, 'raw'))
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, 'raw', f))).toString('utf8')));
}

async function rescore(dir) {
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  const rows = sortRows(readRaws(dir).map(readRun));
  const out = writeOutputs(dir, { config: results.config, spend: results.spend, rows });
  process.stdout.write(`${out.report}\n`);
}

/** Runs the plan; returns the raws in completion order and the spend. */
export async function runPlan({ plan, doors, opts, sdkClient, dir, log = () => {} }) {
  const byId = new Map(CASES.map((c) => [c.id, c]));
  const raws = [];
  const spend = { usd: 0, runs: 0 };
  let projected = DEFAULTS.priorRunUsd;
  let inFlight = 0;
  let next = 0;
  const worker = async () => {
    while (next < plan.length && spend.stopped === undefined) {
      const i = next;
      const item = plan[i];
      if (opts.provider !== 'mock' && spend.usd + (inFlight + 1) * projected > opts.maxUsd) {
        spend.stopped = `after ${i} of ${plan.length} runs, before ${item.arm}/${item.caseId}/r${item.rep}`;
        log(`stopped at the cap: ${spend.stopped}\n`);
        return;
      }
      next += 1;
      inFlight += 1;
      let raw;
      try {
        raw = await runCase({
          doors,
          caseDef: byId.get(item.caseId),
          arm: item.arm,
          rep: item.rep,
          provider: opts.provider,
          model: opts.model,
          now: runNow(),
          sdkClient,
          temperature: opts.temperature,
        });
      } finally {
        inFlight -= 1;
      }
      raws.push(raw);
      spend.usd += raw.usd;
      spend.runs += 1;
      projected = Math.max(DEFAULTS.priorRunUsd, projected, raw.usd * 1.25);
      if (dir !== undefined)
        writeFileSync(join(dir, 'raw', rawFileName(raw.key)), gzipSync(JSON.stringify(raw)));
      const outcome =
        raw.answer !== undefined ? 'answered' : raw.stuck ? 'stuck' : `error: ${raw.error}`;
      log(
        `  ${String(spend.runs).padStart(3)}/${plan.length} ${raw.key} · $${raw.usd.toFixed(
          4,
        )} · ${outcome}\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency ?? 1 }, worker));
  return { raws, spend };
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.rescore !== undefined) return rescore(resolve(opts.rescore));
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
    concurrency: opts.concurrency,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(opts.maxUsd !== undefined && { maxUsd: opts.maxUsd }),
  };
  const estimate =
    opts.provider === 'mock'
      ? 0
      : plan.length *
        3 *
        ((1200 * PRICES[opts.model].input + 150 * PRICES[opts.model].output) / 1e6);
  process.stdout.write(
    `time bench · ${opts.provider} · ${opts.model} · ${plan.length} runs · seed ${opts.seed}` +
      (opts.provider === 'mock'
        ? ' · $0\n'
        : ` · estimate ≈ $${estimate.toFixed(2)} · cap $${opts.maxUsd.toFixed(2)}\n`),
  );
  if (opts.dryRun) {
    process.stdout.write('dry run: nothing was called.\n');
    return undefined;
  }

  const doors = await loadDoors();
  // Preflight: an arm this build cannot arm is refused before anything is written or spent.
  for (const arm of ARMS) {
    buildAgent(
      doors,
      arm,
      doors.mock({ replies: [{ content: 'preflight' }] }),
      'mock',
      buildTools(doors, []),
      ANCHOR,
    );
  }
  const sdkClient = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const dir = resolve(
    opts.out ??
      (opts.provider === 'mock'
        ? join(tmpdir(), 'af-time-bench', `mock-${stamp()}`)
        : join(HERE, 'runs', `${opts.provider}-${stamp()}`)),
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
  const rows = sortRows(raws.map(readRun));
  const { report } = writeOutputs(dir, { config, spend, rows });
  process.stdout.write(`${report}\nwritten: ${dir}\nspend: $${spend.usd.toFixed(4)}\n`);
  return undefined;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((err) => {
    const detail = process.env.AF_BENCH_DEBUG === '1' ? err?.stack : err?.message;
    process.stderr.write(`time bench: ${detail ?? err}\n`);
    process.exit(1);
  });
}
