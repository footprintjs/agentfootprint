/**
 * bench/figures/run.mjs — the figures bench (RULE.md): the capacity question over the recorded
 * tool result, arms before/after interleaved under a seeded shuffle, every number read from the
 * saved record.
 *
 *   npm run build                                    # the bench runs the built package
 *   node bench/figures/run.mjs                       # scripted mock, every variant once, $0
 *   node --env-file=<file with ANTHROPIC_API_KEY> bench/figures/run.mjs --provider anthropic \
 *     --max-usd 1.80 --sdk-from <project with @anthropic-ai/sdk> [--runs 20] [--concurrency 4]
 *   node bench/figures/run.mjs --rescore <out dir>   # re-read saved runs; no model call
 *
 * THE KEY. The SDK reads ANTHROPIC_API_KEY from the environment; this script only checks it is set.
 * THE CAP. Before each run the bench projects its cost (the dearest run so far × 1.25, never
 * under $0.02) and stops, on the record, rather than cross the cap.
 */

import { randomInt } from 'node:crypto';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { PRICES, costOf, usageOf } from '../inputs/harness.mjs';
import { shuffled } from '../inputs/labels.mjs';
import {
  ARMS,
  CASES,
  FIXTURES,
  SYSTEM_PROMPT,
  TOOL_NAME,
  descriptionOf,
  gateOptions,
  sheetProblems,
  viewOf,
} from './cases.mjs';
import { labelAnswer } from './labels.mjs';
import { RULE_ID, formatVerdict, judge } from './rule.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
export const MODEL = 'claude-haiku-4-5-20251001';
export const MAX_ITERATIONS = 5;
export const MAX_TOKENS = 1024;
/** The control's planted figure: the h700 pool's usable TB. */
export const CONTROL_TARGET = 1090.8;

export function parseArgs(argv, drawSeed = () => randomInt(1, 2 ** 31 - 1)) {
  const flags = new Map();
  for (let i = 0; i < argv.length; i += 2) {
    if (!argv[i].startsWith('--') || argv[i + 1] === undefined) throw new Error(`bad argument ${argv[i]}`);
    flags.set(argv[i], argv[i + 1]);
  }
  const known = ['--provider', '--runs', '--seed', '--max-usd', '--concurrency', '--out', '--sdk-from', '--rescore'];
  for (const k of flags.keys()) if (!known.includes(k)) throw new Error(`unknown flag ${k}`);
  const provider = flags.get('--provider') ?? 'mock';
  if (provider !== 'mock' && provider !== 'anthropic') throw new Error('--provider mock|anthropic');
  const maxUsd = flags.has('--max-usd') ? Number(flags.get('--max-usd')) : undefined;
  if (provider === 'anthropic' && !(maxUsd > 0)) throw new Error('a paid run names its cap: --max-usd');
  const runs = flags.has('--runs') ? Number(flags.get('--runs')) : provider === 'mock' ? undefined : 20;
  const seed = flags.has('--seed') ? Number(flags.get('--seed')) : provider === 'mock' ? 20261001 : drawSeed();
  const concurrency = Number(flags.get('--concurrency') ?? 1);
  if (!(concurrency >= 1 && concurrency <= 4)) throw new Error('--concurrency 1..4');
  return {
    provider,
    model: provider === 'mock' ? 'mock' : MODEL,
    runs,
    seed,
    seedDrawn: !flags.has('--seed') && provider !== 'mock',
    maxUsd,
    concurrency,
    out: flags.get('--out'),
    sdkFrom: flags.get('--sdk-from'),
    rescore: flags.get('--rescore'),
  };
}

/** Repetition by repetition, every (case, arm) pair in a seeded shuffle — the arms interleave. */
export function planOf({ runs, seed, provider }) {
  const reps = provider === 'mock' && runs === undefined ? Math.max(...CASES.map((c) => c.mock.length)) : runs;
  const plan = [];
  for (let rep = 0; rep < reps; rep += 1) {
    const round = [];
    for (const c of CASES) for (const arm of ARMS) round.push({ caseId: c.id, arm, rep });
    plan.push(...shuffled(round, seed + rep));
  }
  return plan;
}

/** A scripted provider: one tool call, then the variant's answers in order. */
function scripted(doors, answers, state) {
  return doors.mock({
    respond: () => {
      const step = state.step++;
      if (step === 0) return { toolCalls: [{ id: 'c1', name: TOOL_NAME, args: { cluster: 'A01' } }] };
      const a = answers[step - 1];
      if (a === undefined) {
        state.exhausted = true;
        return { content: '(the mock script ran out)' };
      }
      return { content: a };
    },
  });
}

/** One (case, arm, rep): a fresh agent over the fixture view; the raw record of what happened. */
export async function runCase({ doors, caseDef, arm, rep, provider, model, sdkClient }) {
  const state = { step: 0, exhausted: false };
  const variant = provider === 'mock' ? caseDef.mock[rep % caseDef.mock.length] : undefined;
  const llm =
    provider === 'mock' ? scripted(doors, variant.answers, state) : doors.anthropic({ _client: sdkClient });
  const view = viewOf(caseDef, arm);
  const toolArgs = [];
  const agent = doors.Agent.create({ provider: llm, model, maxIterations: MAX_ITERATIONS, maxTokens: MAX_TOKENS })
    .system(SYSTEM_PROMPT)
    .tool(
      doors.defineTool({
        name: TOOL_NAME,
        description: descriptionOf(arm),
        inputSchema: FIXTURES.inputSchema,
        execute: async (args) => {
          toolArgs.push(args);
          return view;
        },
      }),
    )
    .namesAndNumbersFromEvidence(gateOptions(arm))
    .build();
  const events = [];
  agent.on('*', (e) => events.push({ type: e.type, payload: e.payload }));
  let answer;
  let error;
  try {
    const out = await agent.run({ message: caseDef.message });
    if (typeof out === 'string') answer = out;
  } catch (err) {
    error = String(err?.message ?? err);
  }
  const usage = usageOf(events);
  const verdicts = events
    .filter((e) => e.type === 'agentfootprint.agent.evidence_checked')
    .map((e) => JSON.parse(JSON.stringify(e.payload)));
  return {
    key: `${arm}/${caseDef.id}/r${rep}`,
    arm,
    caseId: caseDef.id,
    rep,
    provider,
    model,
    ...(variant && { variant: variant.label }),
    ...(state.exhausted && { mockExhausted: true }),
    message: caseDef.message,
    ...(answer !== undefined && { answer }),
    ...(error !== undefined && { error }),
    toolArgs,
    verdicts,
    usage,
    usd: provider === 'mock' ? 0 : costOf(usage, model),
  };
}

/** One raw run → the row the rule reads. Labels come from the record (`labels.mjs`). */
export function scoreRun(raw) {
  const caseDef = CASES.find((c) => c.id === raw.caseId);
  const answered = typeof raw.answer === 'string' && raw.answer.length > 0;
  const label = answered
    ? labelAnswer(raw.answer, FIXTURES.record, caseDef.role === 'control' ? CONTROL_TARGET : undefined)
    : undefined;
  const last = raw.verdicts[raw.verdicts.length - 1];
  return {
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    role: caseDef.role,
    rep: raw.rep,
    answered,
    figures: label?.figures ?? 0,
    invented: (label?.invented.length ?? 0) > 0,
    inventedFigures: label?.invented ?? [],
    hedged: label?.hedged ?? false,
    ...(caseDef.role === 'control' && { correct: label?.correct ?? false }),
    flagged: last?.action === 'flagged' || last?.action === 'refused',
    revised: raw.verdicts.some((v) => v.action === 'revision-asked'),
    inputTokens: raw.usage.input,
    outputTokens: raw.usage.output,
    calls: raw.usage.calls,
    usd: raw.usd,
  };
}

export function aggregate(rows) {
  const out = {};
  for (const arm of ARMS) {
    for (const c of CASES) {
      const rs = rows.filter((r) => r.arm === arm && r.caseId === c.id);
      const a = rs.filter((r) => r.answered);
      out[`${arm}/${c.id}`] = {
        runs: rs.length,
        answered: a.length,
        statesFigure: a.filter((r) => r.figures > 0).length,
        invented: a.filter((r) => r.invented).length,
        flagged: a.filter((r) => r.flagged).length,
        revised: a.filter((r) => r.revised).length,
        hedged: a.filter((r) => r.hedged).length,
        ...(c.role === 'control' && { correct: a.filter((r) => r.correct).length }),
        meanInputTokens: rs.length ? Math.round(rs.reduce((s, r) => s + r.inputTokens, 0) / rs.length) : 0,
      };
    }
  }
  return out;
}

function report(config, spend, rows) {
  const agg = aggregate(rows);
  const verdict = judge(rows);
  const lines = [
    `# Figures bench — ${config.provider} · ${config.model} · seed ${config.seed}`,
    '',
    `Spend: $${spend.usd.toFixed(4)} over ${spend.runs} runs${spend.stopped ? ` (stopped: ${spend.stopped})` : ''}.`,
    '',
    '| arm/case | runs | answered | states a figure | invented | flagged | revised | hedged | correct | mean input tokens |',
    '|---|---|---|---|---|---|---|---|---|---|',
    ...Object.entries(agg).map(
      ([k, a]) =>
        `| ${k} | ${a.runs} | ${a.answered} | ${a.statesFigure} | ${a.invented} | ${a.flagged} | ${a.revised} | ${a.hedged} | ${a.correct ?? '—'} | ${a.meanInputTokens} |`,
    ),
    '',
    formatVerdict(verdict),
    '',
  ];
  return { aggregates: agg, verdict, text: lines.join('\n') };
}

function writeOutputs(dir, config, spend, rows) {
  const r = report(config, spend, rows);
  writeFileSync(
    join(dir, 'results.json'),
    `${JSON.stringify({ rule: RULE_ID, config, spend, rows, aggregates: r.aggregates, verdict: r.verdict }, null, 2)}\n`,
  );
  writeFileSync(join(dir, 'report.md'), r.text);
  return r;
}

async function loadDoors() {
  const [{ Agent, defineTool }, { mock, anthropic }] = await Promise.all([
    import('agentfootprint'),
    import('agentfootprint/providers'),
  ]);
  return { Agent, defineTool, mock, anthropic };
}

async function loadSdkClient(sdkFrom) {
  if (!process.env.ANTHROPIC_API_KEY)
    throw new Error('ANTHROPIC_API_KEY is not set (node --env-file=<file>); the bench never reads the file');
  let mod;
  try {
    mod = await import('@anthropic-ai/sdk');
  } catch {
    if (sdkFrom !== undefined) mod = createRequire(join(resolve(sdkFrom), 'package.json'))('@anthropic-ai/sdk');
  }
  if (mod === undefined) throw new Error('@anthropic-ai/sdk not found; pass --sdk-from <project>');
  const Anthropic = mod.default ?? mod.Anthropic ?? mod;
  return new Anthropic({ timeout: 120_000, maxRetries: 3 });
}

const readRaws = (dir) =>
  readdirSync(join(dir, 'raw'))
    .filter((f) => f.endsWith('.json.gz'))
    .map((f) => JSON.parse(gunzipSync(readFileSync(join(dir, 'raw', f))).toString('utf8')));

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.rescore !== undefined) {
    const dir = resolve(opts.rescore);
    const prior = JSON.parse(readFileSync(join(dir, 'results.json'), 'utf8'));
    const rows = readRaws(dir).map(scoreRun);
    process.stdout.write(`${writeOutputs(dir, prior.config, prior.spend, rows).text}\n`);
    return;
  }
  const problems = sheetProblems();
  if (problems.length) throw new Error(`the sheet is not sound:\n  ${problems.join('\n  ')}`);
  const plan = planOf(opts);
  const doors = await loadDoors();
  const sdkClient = opts.provider === 'anthropic' ? await loadSdkClient(opts.sdkFrom) : undefined;
  const dir =
    opts.out !== undefined
      ? resolve(opts.out)
      : opts.provider === 'mock'
      ? join(tmpdir(), `figures-bench-mock-${process.pid}`)
      : join(HERE, 'runs', `haiku45-${new Date().toISOString().replace(/[-:]/g, '').slice(0, 13)}`);
  mkdirSync(join(dir, 'raw'), { recursive: true });
  const config = {
    provider: opts.provider,
    model: opts.model,
    runs: opts.runs ?? 'each scripted variant once',
    seed: opts.seed,
    ...(opts.seedDrawn && { seedDrawn: 'fresh, crypto.randomInt, at the start of this invocation' }),
    concurrency: opts.concurrency,
    maxIterations: MAX_ITERATIONS,
    maxTokens: MAX_TOKENS,
    ...(opts.maxUsd !== undefined && { maxUsd: opts.maxUsd }),
    plan: plan.length,
  };
  process.stdout.write(`figures bench · ${opts.provider} · ${plan.length} runs · seed ${opts.seed} · out ${dir}\n`);
  const raws = [];
  const spend = { usd: 0, runs: 0 };
  let projected = 0.02;
  let inFlight = 0;
  let next = 0;
  const worker = async () => {
    while (next < plan.length && spend.stopped === undefined) {
      const item = plan[next];
      if (opts.provider !== 'mock' && spend.usd + (inFlight + 1) * projected > opts.maxUsd) {
        spend.stopped = `after ${spend.runs} of ${plan.length} runs, before ${item.arm}/${item.caseId}/r${item.rep}`;
        return;
      }
      next += 1;
      inFlight += 1;
      let raw;
      try {
        raw = await runCase({
          doors,
          caseDef: CASES.find((c) => c.id === item.caseId),
          arm: item.arm,
          rep: item.rep,
          provider: opts.provider,
          model: opts.model,
          sdkClient,
        });
      } finally {
        inFlight -= 1;
      }
      raws.push(raw);
      spend.usd += raw.usd;
      spend.runs += 1;
      projected = Math.max(projected, raw.usd * 1.25);
      writeFileSync(join(dir, 'raw', `${raw.key.split('/').join('__')}.json.gz`), gzipSync(JSON.stringify(raw)));
      process.stdout.write(
        `  ${String(spend.runs).padStart(3)}/${plan.length} ${raw.key} · $${raw.usd.toFixed(4)} · ${
          raw.answer !== undefined ? 'answered' : `error: ${raw.error}`
        }\n`,
      );
    }
  };
  await Promise.all(Array.from({ length: opts.concurrency }, worker));
  const r = writeOutputs(dir, config, spend, raws.map(scoreRun));
  process.stdout.write(`\n${r.text}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    process.stderr.write(`${err?.stack ?? err}\n`);
    process.exit(1);
  });
}

export { PRICES };
