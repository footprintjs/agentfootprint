/**
 * bench/honest-report/judge.mjs — the judge step (RULE.md § 4), separate from scoring: it fills
 * in what each free-text answer claims and appends one line per answer, as it is made, to
 * `judged.jsonl` (the first judge) or `judged-second.jsonl` (the second judge). The scorer reads
 * both.
 *
 *   node bench/honest-report/judge.mjs --runs <dir> --rehearse                  # scripted first judge, $0
 *   node bench/honest-report/judge.mjs --runs <dir> --rehearse --second [--all]  # scripted second judge, $0
 *   node --env-file=<file> bench/honest-report/judge.mjs --runs <dir> --provider anthropic --sdk-from <dir>
 *   node --env-file=<file> bench/honest-report/judge.mjs --runs <dir> --provider anthropic --sdk-from <dir> --second [--all]
 *   node bench/honest-report/judge.mjs --runs <dir> --person-sheet              # the optional twenty
 *
 * The models are the rule's (`MODELS.firstJudge`, `MODELS.secondJudge`), sent no sampling
 * parameter. The spend comes from the run folder's ONE ceiling (`plan.json` · `maxUsd`) and ledger
 * (`spend.jsonl`): the judge names no ceiling of its own.
 *
 * Never loses paid work: each line is appended as it is made; a restart skips every run already
 * judged; a reply the claim cannot be read from is asked once more (recorded), and a second
 * unreadable reply or a failed call is written as `judge-unreadable`; reaching the ceiling stops
 * the step with every line so far kept.
 *
 * The second judge reads, blind to the first judge's claims and to the build and arm, the sample
 * of `judge/sample.mjs`; with `--all` also every primary run (the fallback of RULE.md § 4).
 */

import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { costOfUsage, ledgerOf } from './harness/cost.mjs';
import { logLook } from './harness/looks.mjs';
import { loadSdkClient } from './harness/provider.mjs';
import { JUDGE_PROMPT, PROMPT_DIGEST, claimFromReply, judgeInput } from './judge/prompt.mjs';
import { personSheet, primaryRuns, secondSample } from './judge/sample.mjs';
import { readScripted } from './judge/scripted-sentences.mjs';
import { textToJudge } from './judge/text.mjs';
import { JUDGE_UNREADABLE, MODELS } from './rule-tables.mjs';
import { readJsonl, readRunFolder } from './score/read-runs.mjs';
import { instancesOfFolder } from './score/rows.mjs';

export { textToJudge };

/** RULE.md § 3: output tokens per judge reply; thinking counts toward it. */
export const JUDGE_MAX_TOKENS = 4096;
export const SAMPLE_SEED = 20261113;
export const FIRST_FILE = 'judged.jsonl';
export const SECOND_FILE = 'judged-second.jsonl';

function parseArgs(argv) {
  const flags = new Map();
  const bare = new Set(['--rehearse', '--person-sheet', '--second', '--all']);
  for (let i = 0; i < argv.length; i += 1) {
    if (bare.has(argv[i])) flags.set(argv[i], true);
    else {
      if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`);
      flags.set(argv[i], argv[i + 1]);
      i += 1;
    }
  }
  const known = new Set(['--runs', '--provider', '--sdk-from', '--seed', '--pack', '--seed-file', ...bare]);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag ${k}`);
  if (!flags.has('--runs')) throw new Error('--runs <dir> is required');
  const o = Object.fromEntries([...flags].map(([k, v]) => [k.slice(2), v]));
  if (!o.rehearse && !o['person-sheet'] && o.provider !== 'anthropic') throw new Error('--rehearse, --provider anthropic or --person-sheet');
  if (o.all && !o.second) throw new Error('--all is the second judge\'s fallback: it needs --second');
  return o;
}

/**
 * Judges one answer with a model: one call, and once more when the claim cannot be read from the
 * reply. Returns the line to append (a claim, or `judge-unreadable` with why) and its cost.
 * `ask(request)` is the SDK's `messages.create` (a test passes a fake).
 */
export async function judgeOne({ ask, model, input }) {
  const request = { model, max_tokens: JUDGE_MAX_TOKENS, system: JUDGE_PROMPT, messages: [{ role: 'user', content: input }] };
  const tries = [];
  let usd = 0;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await ask(request);
      const u = response?.usage ?? {};
      usd += costOfUsage({ input: u.input_tokens ?? 0, output: u.output_tokens ?? 0, cacheRead: u.cache_read_input_tokens ?? 0, cacheWrite: u.cache_creation_input_tokens ?? 0 }, model);
      const reply = (response?.content ?? []).filter((b) => b?.type === 'text').map((b) => b.text).join('');
      const claim = claimFromReply(reply);
      tries.push({ servedModel: response?.model, stopReason: response?.stop_reason, ...(claim === undefined && { unreadable: reply.slice(0, 300) }) });
      if (claim !== undefined) return { claim, usd, tries };
    } catch (err) {
      tries.push({ error: String(err?.message ?? err).slice(0, 300) });
    }
  }
  return { unreadable: JUDGE_UNREADABLE, usd, tries };
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const dir = resolve(o.runs);
  const folder = readRunFolder(dir);
  const keys = instancesOfFolder(folder, { pack: o.pack, seedFile: o['seed-file'] });
  if (folder.config.set !== 'open') logLook(dir, { command: o['person-sheet'] ? 'person-sheet' : o.second ? 'judge --second' : 'judge', set: folder.config.set, setDigest: folder.config.setDigest });
  const raws = [...folder.raws()];
  const firstClaims = new Map(readJsonl(join(dir, FIRST_FILE)).filter((j) => j.claim !== undefined).map((j) => [j.runKey, j.claim]));
  const sample = secondSample(raws, firstClaims, keys, Number(o.seed ?? SAMPLE_SEED));
  if (o['person-sheet']) {
    const { sheet, key } = personSheet(raws, sample, keys, Number(o.seed ?? SAMPLE_SEED));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'person-sheet.json'), `${JSON.stringify(sheet, null, 1)}\n`);
    writeFileSync(join(dir, 'person-key.json'), `${JSON.stringify(key, null, 1)}\n`);
    process.stdout.write(`person sheet: ${sheet.rows.length} answers → person-sheet.json (optional; key kept apart in person-key.json)\n`);
    return;
  }
  const second = o.second === true;
  if (second && firstClaims.size === 0) throw new Error('the second judge reads a sample drawn from the first judge\'s claims: run the first judge first');
  const file = join(dir, second ? SECOND_FILE : FIRST_FILE);
  const byKey = new Map(raws.map((r) => [r.runKey, r]));
  const inSample = new Set(sample);
  const order = second ? [...new Set([...sample, ...(o.all ? primaryRuns(raws, keys) : [])])] : raws.map((r) => r.runKey);
  const model = second ? MODELS.secondJudge : MODELS.firstJudge;
  const judge = o.rehearse
    ? { kind: 'scripted', model: 'scripted-sentences', family: 'none (rehearsal stand-in)', promptDigest: PROMPT_DIGEST }
    : { kind: 'model', model, family: 'Anthropic Claude', promptDigest: PROMPT_DIGEST };
  let sdk;
  let ledger;
  let maxUsd;
  if (!o.rehearse) {
    maxUsd = folder.config.maxUsd;
    if (maxUsd === undefined) throw new Error('this run folder names no spend ceiling (plan.json · maxUsd): a paid judge spends only from a paid run\'s ceiling (RULE.md § 8)');
    sdk = await loadSdkClient(o['sdk-from']);
    ledger = ledgerOf(dir);
  }
  const ask = sdk === undefined ? undefined : (req) => sdk.client.messages.create(req);
  const r = await judgeLoop({ order, byKey, keys, file, second, inSample, judge, model, ask, ledger, maxUsd });
  if (r.stopped) process.stdout.write(`stopped at the ceiling ($${ledger.total().toFixed(4)} of $${maxUsd}): every line so far kept; the rest are not judged\n`);
  process.stdout.write(`judged: ${r.written} answers now, ${r.skipped} already judged · judge ${judge.model} (${judge.family}) · prompt ${PROMPT_DIGEST}${ledger ? ` · ledger $${ledger.total().toFixed(4)}` : ''} → ${file}\n`);
}

/**
 * Judges every run of `order` that has model text and no line in `file` yet, appending one line
 * per answer AS IT IS MADE (RULE.md § 4): a restart skips what is judged; reaching the ceiling
 * stops with every line kept. With no `ask` (a rehearsal) the scripted judge reads the scripted
 * sentences. Returns `{ written, skipped, stopped }`.
 */
export async function judgeLoop({ order, byKey, keys, file, second = false, inSample = new Set(), judge, model, ask, ledger, maxUsd }) {
  const done = new Set(readJsonl(file).map((l) => l.runKey));
  let written = 0;
  let skipped = 0;
  let dearest = 0;
  const floor = costOfUsage({ input: 1000, output: 1000 }, model);
  for (const runKey of order) {
    const raw = byKey.get(runKey);
    const text = raw === undefined ? undefined : textToJudge(raw);
    if (text === undefined) continue;
    if (done.has(runKey)) {
      skipped += 1;
      continue;
    }
    const key = keys.get(raw.instanceId);
    const meta = { runKey, arm: raw.arm, role: key.role, ...(second && { inSample: inSample.has(runKey) }) };
    let line;
    if (ask === undefined) line = { ...meta, judge, claim: readScripted(text), usd: 0 };
    else {
      if (ledger.total() + Math.max(floor, dearest * 1.25) > maxUsd) return { written, skipped, stopped: true };
      const r = await judgeOne({ ask, model, input: judgeInput(key, text) });
      ledger.pay({ who: second ? 'second judge' : 'first judge', usd: r.usd, runKey });
      dearest = Math.max(dearest, r.usd);
      line = { ...meta, judge: { ...judge, servedModels: r.tries.map((t) => t.servedModel).filter(Boolean) }, ...(r.claim !== undefined ? { claim: r.claim } : { unreadable: r.unreadable }), reasked: r.tries.length > 1, tries: r.tries, usd: r.usd };
    }
    appendFileSync(file, `${JSON.stringify(line)}\n`);
    done.add(runKey);
    written += 1;
  }
  return { written, skipped, stopped: false };
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`honest-report judge: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}

