/**
 * bench/inputs/run.mjs — the inputs-layer bench (honesty step 2): provoking cases and controls,
 * run against the agent as it ships, every number read from the saved record.
 *
 *   npm run build                                   # the bench runs the built package
 *   node bench/inputs/run.mjs                       # the mock: every scripted variant once, $0
 *   node bench/inputs/run.mjs --pin-mock            # …and rewrite bench/inputs/results/mock.json
 *   node --env-file=<file with ANTHROPIC_API_KEY> bench/inputs/run.mjs \
 *     --provider anthropic --max-usd 1.50 [--sdk-from <project with @anthropic-ai/sdk>] \
 *     [--runs 10] [--dry-run]                       # Haiku 4.5, the registered baseline
 *   node bench/inputs/run.mjs --rescore <out dir>   # re-read saved runs; no model call
 *   node bench/inputs/run.mjs --labels <out dir>    # agreement of the window reader with hand labels
 *
 * Flags: --provider mock|anthropic · --model <id> (anthropic: a Haiku 4.5 id, the default
 * claude-haiku-4-5-20251001) · --arms off[,assume,ask,full,full-b] · --cases <id|group>,… · --runs N ·
 * --seed N · --max-usd X (required for anthropic) · --temperature T (sent only when given; the
 * registered runs send none) · --judge step3|step4|step5|step5b|step5c (step5, step5b and step5c plan `ALL_CASES`) · --concurrency K (runs in flight at once,
 * started in the plan's order; default 1, at most 4 — RULE.md, the protocol) · --out <dir> ·
 * --dry-run.
 *
 * WHAT IT WRITES (in --out; default bench/inputs/runs/anthropic-<stamp> for a paid run, the
 * system temp directory for a mock run):
 *   results.json      the config (seed, runs, cap), the spend, one row per run
 *                     (`metrics.mjs` · `readRun`), the aggregates, and a verdict under --judge
 *   report.md         the tables, and the verdict
 *   raw/*.json.gz     each run as it was left: turns, the tools' execution log, request digests,
 *                     usage, the standing, and the recording with its snapshot
 *   blind-sheet.json  the answers for hand labels — arm, case and run hidden — and blind-key.json
 *
 * THE KEY. `--provider anthropic` builds the Anthropic SDK client, which reads ANTHROPIC_API_KEY
 * from the environment itself (`node --env-file=…`); this script only checks that the variable
 * is set, never reads or prints it. The SDK is an optional peer of the package: when this
 * checkout does not have it, `--sdk-from <dir>` loads it from another project's node_modules.
 *
 * THE CAP. A paid run names its cap (`--max-usd`). Before each run the bench projects the next
 * run's cost (the dearest run so far × 1.25, never under $0.03) and stops, on the record, rather
 * than cross the cap. Costs come from each call's reported usage at `harness.mjs` · `PRICES`.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { ALL_ARMS, ALL_CASES, CASES, sheetProblems, sourcesArmed } from './cases.mjs';
import {
  MAX_ITERATIONS,
  MAX_TOKENS,
  PRICES,
  buildTools,
  measureServed,
  measureServedB,
  runCase,
} from './harness.mjs';
import { blindSheet, labelAgreement, shuffled } from './labels.mjs';
import { aggregate, formatReport, formatSourcesReport, readRun } from './metrics.mjs';
import {
  RULE_ID,
  RULE5_ID,
  RULE5B_ID,
  RULE5C_ID,
  formatVerdict,
  judgeStep3,
  judgeStep4,
  judgeStep5,
  judgeStep5b,
  judgeStep5c,
} from './rule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..', '..');

/** The registered defaults (`RULE.md`, "The protocol"). */
export const DEFAULTS = Object.freeze({
  seed: 20260927,
  anthropicModel: 'claude-haiku-4-5-20251001',
  anthropicRuns: 10,
  /** Before any run is observed, the projected cost of one run. */
  priorRunUsd: 0.03,
});

/** The pinned mock baseline — the bench's own byte reference (`test/bench/inputs/unarmed-bytes.test.ts`). */
export const MOCK_PIN = join(HERE, 'results', 'mock.json');

// ── arguments ────────────────────────────────────────────────────────────────

/**
 * Parses and validates the command line. Pure: throws a sentence for every refusal, before
 * anything is built, printed or spent.
 */
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
    throw new Error(
      `--model ${model}: the registered runs are Haiku 4.5 only (${Object.keys(PRICES)
        .filter((m) => m !== 'mock')
        .join(', ')}); another model needs its rates in harness.mjs · PRICES and the owner's word`,
    );
  }
  const arms = (flags.get('--arms') ?? 'off').split(',').map((s) => s.trim());
  for (const arm of arms)
    if (!ALL_ARMS.includes(arm))
      throw new Error(`--arms: unknown arm '${arm}' (${ALL_ARMS.join(', ')})`);
  if (new Set(arms).size !== arms.length) throw new Error('--arms: an arm is named twice');

  // Step 5 (`--judge step5`, or the `full` arm) plans the step-2 sheet AND step 5's cases
  // (`cases.mjs` · `ALL_CASES`); every earlier step keeps the sheet it registered (`CASES`).
  // Step 5's second registration (`--judge step5b`, arm `full-b`, `RULE-step5b.md`) plans the same,
  // and so does its third (`--judge step5c`, the same arm, `RULE-step5c.md`).
  const step5 =
    flags.get('--judge') === 'step5' ||
    flags.get('--judge') === 'step5b' ||
    flags.get('--judge') === 'step5c' ||
    arms.includes('full') ||
    arms.includes('full-b');
  const sheet = step5 ? ALL_CASES : CASES;
  const picked = flags.get('--cases');
  let cases = sheet;
  if (picked !== undefined) {
    const want = picked.split(',').map((s) => s.trim());
    cases = ALL_CASES.filter((c) => want.includes(c.id) || want.includes(c.group));
    const unknown = want.filter((w) => !ALL_CASES.some((c) => c.id === w || c.group === w));
    if (unknown.length > 0) throw new Error(`--cases: no case or group ${unknown.join(', ')}`);
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
    const need = {
      step3: 'assume',
      step4: 'ask',
      step5: 'full',
      step5b: 'full-b',
      step5c: 'full-b',
    }[judge];
    if (need === undefined)
      throw new Error(`--judge must be step3, step4, step5, step5b or step5c, saw '${judge}'`);
    // A rescore reads its arms from the saved run; a new run must plan both.
    if (rescore === undefined && (!arms.includes('off') || !arms.includes(need))) {
      throw new Error(
        `--judge ${judge} compares arms off and ${need} in one interleaved run: pass --arms off,${need}`,
      );
    }
  }
  if (
    flags.get('--pin-mock') === true &&
    (provider !== 'mock' || picked !== undefined || runs !== undefined || arms.join() !== 'off')
  ) {
    throw new Error('--pin-mock pins the default mock baseline only: no --cases, --runs or --arms');
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
 * The run order: repetition by repetition, and within each repetition every (case, arm) pair
 * in a seeded shuffle — the arms interleave, so drift over the evening falls on both. On the
 * mock with no `--runs`, each case runs each of its scripted variants once.
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

/**
 * The file a run's raw record is saved under. Case ids and arms are refused outside
 * `[a-z0-9-]` (`cases.mjs` · `sheetProblems`), so `__` cannot occur inside either and the name
 * is injective.
 */
export function rawFileName(key) {
  return `${key.split('/').join('__')}.json.gz`;
}

// ── the provider ─────────────────────────────────────────────────────────────

/** The Anthropic SDK client — from this checkout, or from `--sdk-from`'s node_modules. */
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
  if (mod === undefined) {
    throw new Error(
      '@anthropic-ai/sdk is not installed in this checkout; pass --sdk-from <a project whose ' +
        'node_modules has it>',
    );
  }
  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  // The client reads ANTHROPIC_API_KEY itself.
  return new Anthropic({ timeout: 120_000, maxRetries: 3 });
}

/** The library's doors, from the BUILT package (self-reference; `npm run build` first). */
async function loadDoors() {
  const [{ Agent, defineTool }, { mock, anthropic }, { recordRun, assessAnswer }] =
    await Promise.all([
      import('agentfootprint'),
      import('agentfootprint/providers'),
      import('agentfootprint/observe'),
    ]);
  return { Agent, defineTool, mock, anthropic, recordRun, assessAnswer };
}

// ── outputs ──────────────────────────────────────────────────────────────────

function stamp() {
  return new Date().toISOString().replace(/[-:]/g, '').replace(/\..*$/, '').replace('T', '-');
}

/** Rows in a fixed order: arm (as given), case (sheet order), repetition. */
function sortRows(rows, arms) {
  const caseIndex = new Map(ALL_CASES.map((c, i) => [c.id, i]));
  return [...rows].sort(
    (a, b) =>
      arms.indexOf(a.arm) - arms.indexOf(b.arm) ||
      caseIndex.get(a.caseId) - caseIndex.get(b.caseId) ||
      a.rep - b.rep,
  );
}

function verdictsOf(judge, aggregates, labels, served) {
  if (judge === 'step3') return [judgeStep3(aggregates, labels)];
  if (judge === 'step4') return [judgeStep4(aggregates)];
  if (judge === 'step5') return [judgeStep5(aggregates, served)];
  if (judge === 'step5b') return [judgeStep5b(aggregates, served)];
  if (judge === 'step5c') return [judgeStep5c(aggregates, served)];
  return [];
}

/** Step 5's reader (`metrics.mjs` · `summarizeSources`) joins the aggregates of a run that armed it. */
function aggregateFor(rows, arms) {
  return aggregate(rows, { sources: arms.some(sourcesArmed) });
}

function writeOutputs(dir, { config, spend, rows, raws, verdicts, served }) {
  const aggregates = aggregateFor(rows, config.arms);
  const rule =
    config.judge === 'step5c'
      ? RULE5C_ID
      : config.judge === 'step5b' || config.arms.includes('full-b')
      ? RULE5B_ID
      : config.judge === 'step5' || config.arms.includes('full')
      ? RULE5_ID
      : RULE_ID;
  const results = {
    rule,
    config,
    spend,
    ...(served !== undefined && { served }),
    rows,
    aggregates,
    verdicts,
  };
  writeFileSync(join(dir, 'results.json'), `${JSON.stringify(results, null, 2)}\n`);
  const report = [
    `# Inputs bench — ${config.provider} · ${config.model} · arms ${config.arms.join(', ')}`,
    '',
    `Spend: $${spend.usd.toFixed(4)}${
      spend.stopped ? ` (stopped at the cap: ${spend.stopped})` : ''
    }.`,
    '',
    formatReport(aggregates),
    formatSourcesReport(aggregates),
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

/** The pinned mock baseline: config without clocks, the rows, the aggregates — byte-stable. */
export function mockPin(rows) {
  return {
    rule: RULE_ID,
    what:
      'The inputs bench on the scripted mock — every variant of every case once, arm off. It measures ' +
      'the harness and the reader, never a model. Pinned by test/bench/inputs/unarmed-bytes.test.ts: ' +
      'an unarmed agent must keep serving these request bytes (requestsDigest) and these rows.',
    config: {
      provider: 'mock',
      model: 'mock',
      arms: ['off'],
      maxIterations: MAX_ITERATIONS,
      maxTokens: MAX_TOKENS,
    },
    rows,
    aggregates: aggregate(rows),
  };
}

// ── the commands ─────────────────────────────────────────────────────────────

async function rescore(dir, judge) {
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  const raws = readdirSync(join(dir, 'raw'))
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, 'raw', f))).toString('utf8')));
  const rows = sortRows(raws.map(readRun), results.config.arms);
  const aggregates = aggregateFor(rows, results.config.arms);
  const verdicts = verdictsOf(judge ?? results.config.judge, aggregates, undefined, results.served);
  const out = writeOutputs(dir, {
    config: results.config,
    spend: results.spend,
    rows,
    raws: undefined,
    verdicts,
    served: results.served,
  });
  process.stdout.write(`${out.report}\n`);
}

async function scoreLabels(dir) {
  const results = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
  const sheet = JSON.parse(readFileSync(join(dir, 'blind-sheet.json'), 'utf8'));
  const key = JSON.parse(readFileSync(join(dir, 'blind-key.json'), 'utf8'));
  const agreement = labelAgreement(sheet, key, results.rows);
  process.stdout.write(`${JSON.stringify(agreement, null, 2)}\n`);
  if (results.config.judge === 'step3') {
    const v = judgeStep3(results.aggregates, agreement);
    process.stdout.write(`${formatVerdict(v)}\n`);
  }
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
  };
  // A generous estimate for the header: 3 model calls a run, 1,500 input and 300 output tokens each.
  const estimate =
    opts.provider === 'mock'
      ? 0
      : plan.length *
        3 *
        ((1500 * PRICES[opts.model].input + 300 * PRICES[opts.model].output) / 1e6);
  process.stdout.write(
    `inputs bench · ${opts.provider} · ${opts.model} · arms ${opts.arms.join(',')} · ` +
      `${plan.length} runs · seed ${opts.seed}` +
      (opts.provider === 'mock'
        ? ' · $0\n'
        : ` · estimate ≈ $${estimate.toFixed(2)} · cap $${opts.maxUsd.toFixed(2)}\n`),
  );
  if (opts.dryRun) {
    process.stdout.write('dry run: nothing was called.\n');
    return undefined;
  }

  const doors = await loadDoors();
  // Preflight: an arm this build cannot declare is refused before anything is written or spent.
  for (const arm of opts.arms) buildTools(doors, arm, [], { turn: 0 });
  // Step 5's S5-9 reads the served decoration, measured on the scripted mock BEFORE any paid
  // call ($0, deterministic: no model behaviour changes it).
  const step5b = opts.judge === 'step5b' || opts.judge === 'step5c' || opts.arms.includes('full-b');
  const served = step5b
    ? await measureServedB(doors, opts.cases)
    : opts.judge === 'step5' || opts.arms.includes('full')
    ? await measureServed(doors, opts.cases)
    : undefined;
  if (step5b) {
    const line = (name) => {
      const x = served[name];
      return (
        `${name} ${x.perRequest.toFixed(
          0,
        )} chars/request · ${x.projection.inputTokensPerRun.toFixed(
          0,
        )} in + ${x.projection.outputTokensPerRun.toFixed(0)} out tokens/run · ` +
        `$${x.projection.usdPerRun.toFixed(5)}/run`
      );
    };
    process.stdout.write(
      `served on the scripted mock (${served.off.projection.runs} runs per agent): ` +
        `${['off', 'ruled', 'fullB'].map(line).join(' | ')}; S5-9 ${(
          served.fullB.perRequest / served.ruled.perRequest
        ).toFixed(4)}\n`,
    );
  } else if (served !== undefined) {
    process.stdout.write(
      `served (system + tools, chars per request): off ${served.off.perRequest.toFixed(0)} · ` +
        `.findings() ${served.findings.perRequest.toFixed(
          0,
        )} · full ${served.full.perRequest.toFixed(0)}\n`,
    );
  }
  const sdkClient = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  // A paid run is a record worth keeping: it lands beside the bench. A mock run proves the bench
  // itself and lands in the system's temp directory, unless --out says otherwise.
  const dir = opts.pinMock
    ? undefined
    : resolve(
        opts.out ??
          (opts.provider === 'mock'
            ? join(tmpdir(), 'af-inputs-bench', `mock-${stamp()}`)
            : join(HERE, 'runs', `${opts.provider}-${stamp()}`)),
      );
  if (dir !== undefined) mkdirSync(join(dir, 'raw'), { recursive: true });

  const byId = new Map(ALL_CASES.map((c) => [c.id, c]));
  const raws = [];
  const spend = { usd: 0, runs: 0 };
  let projected = DEFAULTS.priorRunUsd;
  let inFlight = 0;
  let next = 0;
  // Runs start in the plan's order, `--concurrency` at a time. A run starts only when the spend so
  // far, plus every run still in flight and this one at the projected cost, stays under the cap.
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
      if (dir !== undefined) {
        writeFileSync(join(dir, 'raw', rawFileName(raw.key)), gzipSync(JSON.stringify(raw)));
      }
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
    writeFileSync(MOCK_PIN, `${JSON.stringify(mockPin(rows), null, 2)}\n`);
    process.stdout.write(
      `${formatReport(aggregate(rows))}\npinned: ${MOCK_PIN.slice(ROOT.length + 1)}\n`,
    );
    return undefined;
  }
  const verdicts = verdictsOf(opts.judge, aggregateFor(rows, opts.arms), undefined, served);
  const { report } = writeOutputs(dir, { config, spend, rows, raws, verdicts, served });
  process.stdout.write(`${report}\nwritten: ${dir}\nspend: $${spend.usd.toFixed(4)}\n`);
  return undefined;
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  main().catch((err) => {
    // A refusal is a sentence; the stack only helps when something broke (AF_BENCH_DEBUG=1).
    const detail = process.env.AF_BENCH_DEBUG === '1' ? err?.stack : err?.message;
    process.stderr.write(`inputs bench: ${detail ?? err}\n`);
    process.exit(1);
  });
}
