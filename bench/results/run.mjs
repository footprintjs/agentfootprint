/**
 * bench/results/run.mjs — the results-layer bench (honesty step 7b; cells R1–R3 of
 * docs/design/honesty/results.md § 8.1): provoking cases and controls, arms off and on
 * interleaved in one invocation, every number read from the saved record.
 *
 *   npm run build                                   # the bench runs the built package
 *   node bench/results/run.mjs                      # the mock: every scripted variant once, $0
 *   node bench/results/run.mjs --pin-mock           # …and rewrite bench/results/results/mock.json
 *   node --env-file=<file with ANTHROPIC_API_KEY> bench/results/run.mjs \
 *     --provider anthropic --max-usd 1.75 [--sdk-from <project with @anthropic-ai/sdk>] \
 *     [--runs 20] [--concurrency 4] [--dry-run]     # Haiku 4.5, the registered run
 *   node bench/results/run.mjs --rescore <out dir>  # re-read saved runs; no model call
 *   node bench/results/run.mjs --labels <out dir>   # the labeller against the hand labels
 *
 * Flags: --provider mock|anthropic · --model <id> (a Haiku 4.5 id) · --cases <id|cell>,… ·
 * --runs N · --seed N (a paid run draws a FRESH seed when none is given, and records it) ·
 * --max-usd X (required for anthropic) · --temperature T (sent only when given; the registered
 * run sends none) · --concurrency K (at most 4) · --out <dir> · --dry-run · --pin-mock.
 *
 * WHAT IT WRITES (in --out; default bench/results/runs/anthropic-<stamp> for a paid run, the
 * system temp directory for a mock run): results.json (config with the seed, spend, rows,
 * aggregates, the verdict), report.md, raw/*.json.gz, blind-sheet.json + blind-key.json.
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
import { CASES, sheetProblems } from './cases.mjs';
import { MAX_ITERATIONS, MAX_TOKENS, PRICES, buildAgent, buildTools, runCase } from './harness.mjs';
import { blindSheet, labelAgreement } from './labels.mjs';
import { aggregate, formatReport, readRun } from './metrics.mjs';
import { RULE_ID, formatVerdict, judge } from './rule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** The registered defaults (`RULE.md`, "The protocol"). */
export const DEFAULTS = Object.freeze({
  mockSeed: 20260928,
  anthropicModel: 'claude-haiku-4-5-20251001',
  anthropicRuns: 20,
  priorRunUsd: 0.02,
});

/** The pinned mock run — the bench's own byte reference (`test/bench/results/mock-pin.test.ts`). */
export const MOCK_PIN = join(HERE, 'results', 'mock.json');

// ── arguments ────────────────────────────────────────────────────────────────

/** Parses and validates the command line. Pure: throws a sentence for every refusal. */
export function parseArgs(argv, drawSeed = () => randomInt(1, 2 ** 31 - 1)) {
  const flags = new Map();
  const bare = new Set(['--dry-run', '--pin-mock']);
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
    '--labels',
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
  const labels = flags.get('--labels');
  if (
    provider === 'anthropic' &&
    maxUsd === undefined &&
    rescore === undefined &&
    labels === undefined
  )
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
  if (
    flags.get('--pin-mock') === true &&
    (provider !== 'mock' || picked !== undefined || runs !== undefined || seedGiven !== undefined)
  )
    throw new Error('--pin-mock pins the default mock run only: no --cases, --runs or --seed');
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
    pinMock: flags.get('--pin-mock') === true,
    rescore,
    labels,
  };
}

/**
 * The run order: repetition by repetition, and within each repetition every (case, arm) pair in
 * a seeded shuffle — the arms interleave, so drift over the run falls on both. On the mock with
 * no `--runs`, each case runs each of its scripted variants once, under each of its arms.
 */
export function planOf({ cases, runs, seed, provider }) {
  const eachVariantOnce = provider === 'mock' && runs === undefined;
  const reps = eachVariantOnce ? Math.max(...cases.map((c) => c.mock.length)) : runs;
  const plan = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const round = [];
    for (const c of cases) {
      if (eachVariantOnce && rep >= c.mock.length) continue;
      for (const arm of c.arms) round.push({ caseId: c.id, arm, rep });
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
  const [
    { Agent, defineTool, absent, describedResult },
    { mock, anthropic },
    { recordRun, assessAnswer },
  ] = await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/providers'),
    import('agentfootprint/observe'),
  ]);
  return { Agent, defineTool, absent, describedResult, mock, anthropic, recordRun, assessAnswer };
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

function writeOutputs(dir, { config, spend, rows, raws }) {
  const aggregates = aggregate(rows);
  const verdict = verdictOf(rows);
  const results = { rule: RULE_ID, config, spend, rows, aggregates, ...(verdict && { verdict }) };
  writeFileSync(join(dir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const report = [
    `# Results bench — ${config.provider} · ${config.model} · seed ${config.seed}`,
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
  if (raws !== undefined) {
    const { sheet, key } = blindSheet(raws, config.seed);
    writeFileSync(join(dir, 'blind-sheet.json'), `${JSON.stringify(sheet, null, 2)}\n`);
    writeFileSync(join(dir, 'blind-key.json'), `${JSON.stringify(key, null, 2)}\n`);
  }
  return { results, report };
}

/** The pinned mock run: config without clocks, the rows, the aggregates, the verdict — byte-stable. */
export function mockPin(rows, requestsDigests) {
  return {
    rule: RULE_ID,
    what:
      'The results bench on the scripted mock — every variant of every case once, under each of its arms. ' +
      'It measures the harness, the labeller and the fold, never a model. Pinned by ' +
      'test/bench/results/mock-pin.test.ts: the off arm must keep serving these request bytes.',
    config: {
      provider: 'mock',
      model: 'mock',
      seed: DEFAULTS.mockSeed,
      maxIterations: MAX_ITERATIONS,
      maxTokens: MAX_TOKENS,
    },
    requestsDigests,
    rows,
    aggregates: aggregate(rows),
    verdict: verdictOf(rows),
  };
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
  const out = writeOutputs(dir, {
    config: results.config,
    spend: results.spend,
    rows,
    raws: undefined,
  });
  process.stdout.write(`${out.report}\n`);
}

async function scoreLabels(dir) {
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  const sheet = JSON.parse(readFileSync(join(dir, 'blind-sheet.json'), 'utf8'));
  const key = JSON.parse(readFileSync(join(dir, 'blind-key.json'), 'utf8'));
  process.stdout.write(`${JSON.stringify(labelAgreement(sheet, key, results.rows), null, 2)}\n`);
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
        raw.answer !== undefined ? 'answered' : raw.paused ? 'paused' : `error: ${raw.error}`;
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
  if (opts.labels !== undefined) return scoreLabels(resolve(opts.labels));
  const problems = sheetProblems();
  if (problems.length > 0)
    throw new Error(`the case sheet is not sound:\n  ${problems.join('\n  ')}`);

  const plan = planOf(opts);
  const config = {
    provider: opts.provider,
    model: opts.model,
    cases: opts.cases.map((c) => c.id),
    runs: opts.runs ?? 'each scripted variant once',
    seed: opts.seed,
    ...(opts.seedDrawn && {
      seedDrawn: 'fresh, crypto.randomInt, at the start of this invocation',
    }),
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
        ((1500 * PRICES[opts.model].input + 300 * PRICES[opts.model].output) / 1e6);
  process.stdout.write(
    `results bench · ${opts.provider} · ${opts.model} · ${plan.length} runs · seed ${opts.seed}` +
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
  for (const arm of ['off', 'on']) {
    buildAgent(
      doors,
      arm,
      doors.mock({ replies: [{ content: 'preflight' }] }),
      'mock',
      buildTools(doors, arm, {}, []),
    );
  }
  const sdkClient = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const dir = opts.pinMock
    ? undefined
    : resolve(
        opts.out ??
          (opts.provider === 'mock'
            ? join(tmpdir(), 'af-results-bench', `mock-${stamp()}`)
            : join(HERE, 'runs', `${opts.provider}-${stamp()}`)),
      );
  if (dir !== undefined) mkdirSync(join(dir, 'raw'), { recursive: true });

  const { raws, spend } = await runPlan({
    plan,
    doors,
    opts,
    sdkClient,
    dir,
    log: (s) => process.stdout.write(s),
  });
  const rows = sortRows(raws.map(readRun));
  if (opts.pinMock) {
    const digests = Object.fromEntries(
      [...raws]
        .sort((a, b) => a.key.localeCompare(b.key))
        .map((r) => [r.key, r.requests.map((q) => q.digest).join('.')]),
    );
    mkdirSync(dirname(MOCK_PIN), { recursive: true });
    writeFileSync(MOCK_PIN, `${JSON.stringify(mockPin(rows, digests), null, 2)}\n`);
    process.stdout.write(
      `${formatReport(aggregate(rows))}\npinned: ${MOCK_PIN.slice(ROOT.length + 1)}\n`,
    );
    return undefined;
  }
  const { report } = writeOutputs(dir, { config, spend, rows, raws });
  process.stdout.write(`${report}\nwritten: ${dir}\nspend: $${spend.usd.toFixed(4)}\n`);
  return undefined;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((err) => {
    const detail = process.env.AF_BENCH_DEBUG === '1' ? err?.stack : err?.message;
    process.stderr.write(`results bench: ${detail ?? err}\n`);
    process.exit(1);
  });
}
