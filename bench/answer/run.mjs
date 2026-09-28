/**
 * bench/answer/run.mjs — the answer-layer bench (honesty step 6): provoking cases and controls,
 * the agent with and without `.answerLayer()`, every number read from the saved record.
 *
 *   npm run build                                   # the bench runs the built package
 *   node bench/answer/run.mjs                       # scripted: every variant once, arms off,layer,line, $0
 *   node bench/answer/run.mjs --pin-mock            # …and rewrite bench/answer/results/mock.json
 *   node --env-file=<file with ANTHROPIC_API_KEY> bench/answer/run.mjs \
 *     --provider anthropic --arms off,layer --judge step6 --max-usd 1.40 --concurrency 3 \
 *     [--sdk-from <project with @anthropic-ai/sdk>] [--runs 10] [--seed N] [--dry-run]
 *   node bench/answer/run.mjs --rescore <out dir>   # re-read saved runs; no model call
 *   node bench/answer/run.mjs --labels <out dir>    # the phrase readers against the hand labels
 *
 * Flags: --provider mock|anthropic · --model <id> (anthropic: Haiku 4.5 only) · --arms
 * off[,layer,line] · --cases <id|set>,… · --runs N · --seed N · --max-usd X (required for
 * anthropic) · --temperature T (sent only when given) · --judge step6 · --concurrency K (≤ 4) ·
 * --out <dir> · --sdk-from <dir> · --dry-run.
 *
 * The plan, the cap and the outputs are the inputs bench's (`../inputs/run.mjs`): repetition by
 * repetition, every (case, arm) pair in a seeded shuffle; a paid run names its cap and stops
 * rather than cross it (the next run projected at the dearest run so far × 1.25, never under
 * $0.03); `results.json`, `report.md`, `raw/*.json.gz`, `blind-sheet.json` + `blind-key.json`.
 *
 * THE KEY. `--provider anthropic` builds the Anthropic SDK client, which reads ANTHROPIC_API_KEY
 * from the environment itself (`node --env-file=…`); this script only checks the variable is set.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { shuffled } from '../inputs/labels.mjs';
import { ARMS, CASES, SET_NAMES, sheetProblems } from './cases.mjs';
import { MAX_ITERATIONS, MAX_TOKENS, PRICES, runCase } from './harness.mjs';
import { blindSheet, labelAgreement } from './labels.mjs';
import { aggregate, formatReport, readRun } from './metrics.mjs';
import { RULE_ID, formatVerdict, judgeStep6 } from './rule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** The registered defaults (`RULE.md`, "The protocol"). */
export const DEFAULTS = Object.freeze({
  seed: 20260928,
  anthropicModel: 'claude-haiku-4-5-20251001',
  anthropicRuns: 10,
  priorRunUsd: 0.03,
  mockArms: 'off,layer,line',
  anthropicArms: 'off,layer',
});

/** The pinned scripted run — the bench's own byte reference (`test/bench/answer/*`). */
export const MOCK_PIN = join(HERE, 'results', 'mock.json');

// ── arguments ────────────────────────────────────────────────────────────────

/** Parses and validates the command line. Pure: throws a sentence for every refusal. */
export function parseArgs(argv) {
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
    '--arms',
    '--cases',
    '--runs',
    '--seed',
    '--max-usd',
    '--temperature',
    '--judge',
    '--out',
    '--sdk-from',
    '--rescore',
    '--labels',
    '--concurrency',
    ...bare,
  ]);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag ${k}`);

  const provider = flags.get('--provider') ?? 'mock';
  if (provider !== 'mock' && provider !== 'anthropic') {
    throw new Error(`--provider must be mock or anthropic, saw '${provider}'`);
  }
  const model = flags.get('--model') ?? (provider === 'mock' ? 'mock' : DEFAULTS.anthropicModel);
  if (provider === 'mock' && model !== 'mock') throw new Error('--provider mock runs model mock');
  if (provider === 'anthropic' && (PRICES[model] === undefined || model === 'mock')) {
    throw new Error(`--model ${model}: the registered runs are Haiku 4.5 only`);
  }
  const arms = (
    flags.get('--arms') ?? (provider === 'mock' ? DEFAULTS.mockArms : DEFAULTS.anthropicArms)
  )
    .split(',')
    .map((s) => s.trim());
  for (const arm of arms)
    if (!ARMS.includes(arm)) throw new Error(`--arms: unknown arm '${arm}' (${ARMS.join(', ')})`);
  if (new Set(arms).size !== arms.length) throw new Error('--arms: an arm is named twice');

  const picked = flags.get('--cases');
  let cases = CASES;
  if (picked !== undefined) {
    const want = picked.split(',').map((s) => s.trim());
    cases = CASES.filter((c) => want.includes(c.id) || want.includes(c.set));
    const unknown = want.filter((w) => !CASES.some((c) => c.id === w) && !SET_NAMES.includes(w));
    if (unknown.length > 0) throw new Error(`--cases: no case or set ${unknown.join(', ')}`);
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
  const seed = int('--seed', DEFAULTS.seed);
  const maxUsdRaw = flags.get('--max-usd');
  const maxUsd = maxUsdRaw === undefined ? undefined : Number(maxUsdRaw);
  if (maxUsdRaw !== undefined && !(Number.isFinite(maxUsd) && maxUsd > 0)) {
    throw new Error(`--max-usd must be a positive number of dollars, saw '${maxUsdRaw}'`);
  }
  const rescore = flags.get('--rescore');
  const labels = flags.get('--labels');
  if (
    provider === 'anthropic' &&
    maxUsd === undefined &&
    rescore === undefined &&
    labels === undefined
  ) {
    throw new Error(
      '--provider anthropic needs --max-usd: a paid run names its cap before it starts',
    );
  }
  const temperatureRaw = flags.get('--temperature');
  const temperature = temperatureRaw === undefined ? undefined : Number(temperatureRaw);
  if (
    temperatureRaw !== undefined &&
    !(Number.isFinite(temperature) && temperature >= 0 && temperature <= 1)
  ) {
    throw new Error(`--temperature must be between 0 and 1, saw '${temperatureRaw}'`);
  }
  const judge = flags.get('--judge');
  if (judge !== undefined) {
    if (judge !== 'step6') throw new Error(`--judge must be step6, saw '${judge}'`);
    if (rescore === undefined && (!arms.includes('off') || !arms.includes('layer'))) {
      throw new Error(
        '--judge step6 compares arms off and layer in one interleaved run: pass --arms off,layer',
      );
    }
  }
  if (
    flags.get('--pin-mock') === true &&
    (provider !== 'mock' || picked !== undefined || runs !== undefined || flags.has('--arms'))
  ) {
    throw new Error('--pin-mock pins the default scripted run only: no --cases, --runs or --arms');
  }
  const concurrency = int('--concurrency', 1);
  if (concurrency > 4) throw new Error(`--concurrency must be at most 4, saw ${concurrency}`);
  return {
    provider,
    model,
    arms,
    cases,
    runs,
    seed,
    concurrency,
    maxUsd,
    temperature,
    judge,
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
 * a seeded shuffle — the arms interleave. On the mock with no `--runs`, each case runs each of
 * its scripted variants once, under every arm.
 */
export function planOf({ cases, arms, runs, seed, provider }) {
  const eachVariantOnce = provider === 'mock' && runs === undefined;
  const reps = eachVariantOnce ? Math.max(...cases.map((c) => c.mock.length)) : runs;
  const plan = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const round = [];
    for (const c of cases) {
      if (eachVariantOnce && rep >= c.mock.length) continue;
      for (const arm of arms) round.push({ caseId: c.id, arm, rep });
    }
    plan.push(...shuffled(round, seed + rep));
  }
  return plan;
}

/** The file a run's raw record is saved under (ids are `[a-z0-9-]`, so `__` is injective). */
export function rawFileName(key) {
  return `${key.split('/').join('__')}.json.gz`;
}

// ── the provider and the doors ───────────────────────────────────────────────

async function loadSdkClient(sdkFrom) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      '--provider anthropic needs ANTHROPIC_API_KEY in the environment (node --env-file=<file>)',
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
  if (mod === undefined) {
    throw new Error('@anthropic-ai/sdk is not installed in this checkout; pass --sdk-from <dir>');
  }
  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  return new Anthropic({ timeout: 120_000, maxRetries: 3 });
}

/** The library's doors, from the BUILT package (self-reference; `npm run build` first). */
async function loadDoors() {
  const [
    { Agent, defineTool, absent, coverage },
    { mock, anthropic },
    { recordRun, assessAnswer },
  ] = await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/providers'),
    import('agentfootprint/observe'),
  ]);
  return { Agent, defineTool, absent, coverage, mock, anthropic, recordRun, assessAnswer };
}

/**
 * Refuses a build that cannot arm the layer: an arm that names `.answerLayer()` on a build
 * without it would throw at the builder, but a build whose layer fires no event would compare
 * `off` with `off` — so the preflight runs one scripted answer per arm and checks the event.
 */
async function preflight(doors, arms) {
  const { runCase: run } = await import('./harness.mjs');
  const probe = CASES.find((c) => c.id === 'found-hosts');
  for (const arm of arms) {
    const raw = await run({ doors, caseDef: probe, arm, rep: 0, provider: 'mock', model: 'mock' });
    const fired = raw.turns[0]?.assessedCount ?? 0;
    if (arm === 'off' ? fired !== 0 : fired !== 1) {
      throw new Error(
        `arm '${arm}': this build fired ${fired} answer.assessed event(s) on a scripted answer — refusing to run the arm`,
      );
    }
  }
}

// ── outputs ──────────────────────────────────────────────────────────────────

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

/** Rows in a fixed order: arm (as given), case (sheet order), repetition. */
export function sortRows(rows, arms) {
  const caseIndex = new Map(CASES.map((c, i) => [c.id, i]));
  return [...rows].sort(
    (a, b) =>
      arms.indexOf(a.arm) - arms.indexOf(b.arm) ||
      caseIndex.get(a.caseId) - caseIndex.get(b.caseId) ||
      a.rep - b.rep,
  );
}

function writeOutputs(dir, { config, spend, rows, raws, judge }) {
  const aggregates = aggregate(rows);
  const verdicts = judge === 'step6' ? [judgeStep6(aggregates)] : [];
  const results = { rule: RULE_ID, config, spend, rows, aggregates, verdicts };
  writeFileSync(join(dir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const report = [
    `# Answer bench — ${config.provider} · ${config.model} · arms ${config.arms.join(
      ', ',
    )} · seed ${config.seed}`,
    '',
    `Spend: $${spend.usd.toFixed(4)}${
      spend.stopped ? ` (stopped at the cap: ${spend.stopped})` : ''
    }.`,
    '',
    formatReport(aggregates),
    ...verdicts.map(formatVerdict),
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

/** The pinned scripted run: config without clocks, the rows, the aggregates — byte-stable. */
export function mockPin(rows, arms) {
  return {
    rule: RULE_ID,
    what:
      'The answer bench on the scripted mock — every variant of every case once, under every arm. ' +
      'It measures the harness, the reader and the layer`s guards, never a model.',
    config: {
      provider: 'mock',
      model: 'mock',
      arms,
      maxIterations: MAX_ITERATIONS,
      maxTokens: MAX_TOKENS,
    },
    rows: rows.map(({ llm, usd, ...rest }) => ({ ...rest, llm: { calls: llm.calls } })),
    aggregates: aggregate(rows),
  };
}

// ── the commands ─────────────────────────────────────────────────────────────

function readRaws(dir) {
  return readdirSync(join(dir, 'raw'))
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, 'raw', f))).toString('utf8')));
}

async function rescore(dir, judge) {
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  const rows = sortRows(readRaws(dir).map(readRun), results.config.arms);
  const out = writeOutputs(dir, {
    config: results.config,
    spend: results.spend,
    rows,
    raws: undefined,
    judge: judge ?? results.config.judge,
  });
  process.stdout.write(`${out.report}\n`);
}

async function scoreLabels(dir) {
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  const sheet = JSON.parse(readFileSync(join(dir, 'blind-sheet.json'), 'utf8'));
  const key = JSON.parse(readFileSync(join(dir, 'blind-key.json'), 'utf8'));
  process.stdout.write(`${JSON.stringify(labelAgreement(sheet, key, results.rows), null, 2)}\n`);
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.rescore !== undefined) return rescore(resolve(opts.rescore), opts.judge);
  if (opts.labels !== undefined) return scoreLabels(resolve(opts.labels));
  const problems = sheetProblems();
  if (problems.length > 0)
    throw new Error(`the case sheet is not sound:\n  ${problems.join('\n  ')}`);

  const plan = planOf(opts);
  const config = {
    provider: opts.provider,
    model: opts.model,
    arms: opts.arms,
    cases: opts.cases.map((c) => c.id),
    runs: opts.runs ?? 'each scripted variant once',
    seed: opts.seed,
    concurrency: opts.concurrency,
    ...(opts.temperature !== undefined && { temperature: opts.temperature }),
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(opts.maxUsd !== undefined && { maxUsd: opts.maxUsd }),
    ...(opts.judge !== undefined && { judge: opts.judge }),
    startedAt: opts.provider === 'mock' ? undefined : new Date().toISOString(),
  };
  const estimate =
    opts.provider === 'mock'
      ? 0
      : plan.length *
        3 *
        ((1500 * PRICES[opts.model].input + 300 * PRICES[opts.model].output) / 1e6);
  process.stdout.write(
    `answer bench · ${opts.provider} · ${opts.model} · arms ${opts.arms.join(',')} · ${
      plan.length
    } runs · seed ${opts.seed}` +
      (opts.provider === 'mock'
        ? ' · $0\n'
        : ` · estimate ≈ $${estimate.toFixed(2)} · cap $${opts.maxUsd.toFixed(2)}\n`),
  );
  if (opts.dryRun) {
    process.stdout.write('dry run: nothing was called.\n');
    return undefined;
  }

  const doors = await loadDoors();
  await preflight(doors, opts.arms);
  const sdkClient = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const dir = opts.pinMock
    ? undefined
    : resolve(
        opts.out ??
          (opts.provider === 'mock'
            ? join(tmpdir(), 'af-answer-bench', `mock-${stamp()}`)
            : join(HERE, 'runs', `${opts.provider}-${stamp()}`)),
      );
  if (dir !== undefined) mkdirSync(join(dir, 'raw'), { recursive: true });

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
        process.stdout.write(`stopped at the cap: ${spend.stopped}\n`);
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
      const last = raw.turns[raw.turns.length - 1];
      const outcome =
        last.answer !== undefined ? 'answered' : last.paused ? 'paused' : `error: ${last.error}`;
      process.stdout.write(
        `  ${String(spend.runs).padStart(3)}/${plan.length} ${raw.key} · $${raw.usd.toFixed(
          4,
        )} · ${outcome}\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));

  const rows = sortRows(raws.map(readRun), opts.arms);
  if (opts.pinMock) {
    mkdirSync(dirname(MOCK_PIN), { recursive: true });
    writeFileSync(MOCK_PIN, `${JSON.stringify(mockPin(rows, opts.arms), null, 2)}\n`);
    process.stdout.write(
      `${formatReport(aggregate(rows))}\npinned: ${MOCK_PIN.slice(ROOT.length + 1)}\n`,
    );
    return undefined;
  }
  const { report } = writeOutputs(dir, { config, spend, rows, raws, judge: opts.judge });
  process.stdout.write(`${report}\nwritten: ${dir}\nspend: $${spend.usd.toFixed(4)}\n`);
  return undefined;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  // The evidence gate's dev-mode sentence (posture `assist`) is the library talking to a developer;
  // the bench reads the verdict from the record, so the console copy is counted, not printed.
  let silenced = 0;
  const warn = console.warn;
  console.warn = (...args) => {
    if (typeof args[0] === 'string' && args[0].startsWith('[agentfootprint]')) silenced += 1;
    else warn(...args);
  };
  main()
    .then(() => {
      if (silenced > 0)
        process.stdout.write(`(${silenced} dev-mode library warnings not printed)\n`);
    })
    .catch((err) => {
      const detail = process.env.AF_BENCH_DEBUG === '1' ? err?.stack : err?.message;
      process.stderr.write(`answer bench: ${detail ?? err}\n`);
      process.exit(1);
    });
}
