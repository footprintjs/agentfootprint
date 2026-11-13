/**
 * bench/honest-report/judge.mjs — the judge step (RULE.md § 4), separate from scoring: it fills
 * in what each free-text answer claims and writes `judged.jsonl` in the run folder, which the
 * scorer reads. A person's reading goes in the same shape (`--person-sheet`, then `person.jsonl`).
 *
 *   node bench/honest-report/judge.mjs --runs <dir> --rehearse        # the scripted judge, $0
 *   node --env-file=<file> bench/honest-report/judge.mjs --runs <dir> --provider anthropic \
 *     --model <id> --family <name> --max-usd X --sdk-from <dir>       # the judging model
 *   node bench/honest-report/judge.mjs --runs <dir> --person-sheet [--seed N]
 *
 * The judge sees `judgeInput(key, modelText)` and nothing else. A run with no model text gets no
 * claim (the scorer counts it `no-answer`).
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { PRICES, costOf } from '../inputs/harness.mjs';
import { JUDGE_PROMPT, PROMPT_DIGEST, claimFromReply, judgeInput } from './judge/prompt.mjs';
import { personSheet } from './judge/person-sheet.mjs';
import { readScripted } from './judge/scripted-sentences.mjs';
import { loadSdkClient } from './harness/provider.mjs';
import { readJsonl, readRunFolder } from './score/read-runs.mjs';
import { instancesOfFolder } from './score/rows.mjs';

/**
 * The text the judge reads: the model's own text; for a parsed fixed form, its `summary` (the
 * form's prose; its status and actions are read by code), so the form's effect can be told from
 * the scorer's (RULE.md § 4). Undefined when there is no text.
 */
export function textToJudge(raw) {
  const text = raw.form !== undefined ? raw.form.summary : raw.modelText;
  return typeof text === 'string' && text.trim() !== '' ? text : undefined;
}

function parseArgs(argv) {
  const flags = new Map();
  const bare = new Set(['--rehearse', '--person-sheet']);
  for (let i = 0; i < argv.length; i += 1) {
    if (bare.has(argv[i])) flags.set(argv[i], true);
    else {
      if (argv[i + 1] === undefined) throw new Error(`${argv[i]} needs a value`);
      flags.set(argv[i], argv[i + 1]);
      i += 1;
    }
  }
  const known = new Set(['--runs', '--provider', '--model', '--family', '--max-usd', '--sdk-from', '--seed', '--pack', '--seed-file', ...bare]);
  for (const k of flags.keys()) if (!known.has(k)) throw new Error(`unknown flag ${k}`);
  if (!flags.has('--runs')) throw new Error('--runs <dir> is required');
  const o = Object.fromEntries([...flags].map(([k, v]) => [k.slice(2), v]));
  if (!o.rehearse && !o['person-sheet'] && o.provider !== 'anthropic') throw new Error('--rehearse, --provider anthropic or --person-sheet');
  if (o.provider === 'anthropic') {
    if (o['max-usd'] === undefined || !(Number(o['max-usd']) > 0)) throw new Error('the judging model needs --max-usd');
    if (o.model === undefined || PRICES[o.model] === undefined) throw new Error('--model needs a PRICES row (bench/inputs/harness.mjs)');
    if (o.family === undefined) throw new Error('--family names the judge model family (RULE.md § 4)');
  }
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const dir = resolve(o.runs);
  const folder = readRunFolder(dir);
  const keys = instancesOfFolder(folder, { pack: o.pack, seedFile: o['seed-file'] });
  if (o['person-sheet']) {
    const judged = readJsonl(join(dir, 'judged.jsonl'));
    const { sheet, key } = personSheet([...folder.raws()], judged, keys, Number(o.seed ?? 20261113));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'person-sheet.json'), `${JSON.stringify(sheet, null, 1)}\n`);
    writeFileSync(join(dir, 'person-key.json'), `${JSON.stringify(key, null, 1)}\n`);
    process.stdout.write(`person sheet: ${sheet.rows.length} answers → person-sheet.json (key kept apart in person-key.json)\n`);
    return;
  }
  const judge = o.rehearse
    ? { kind: 'scripted', model: 'scripted-sentences', family: 'none (rehearsal stand-in)', promptDigest: PROMPT_DIGEST }
    : { kind: 'model', model: o.model, family: o.family, promptDigest: PROMPT_DIGEST, temperature: 0 };
  const sdk = o.provider === 'anthropic' ? await loadSdkClient(o['sdk-from']) : undefined;
  const out = [];
  let usd = 0;
  for (const raw of folder.raws()) {
    const text = textToJudge(raw);
    if (text === undefined) continue;
    const key = keys.get(raw.instanceId);
    let claim;
    if (o.rehearse) claim = readScripted(text);
    else {
      if (usd >= Number(o['max-usd'])) throw new Error(`the judge stopped at its spend limit after ${out.length} claims`);
      const response = await sdk.client.messages.create({ model: o.model, max_tokens: 600, temperature: 0, system: JUDGE_PROMPT, messages: [{ role: 'user', content: judgeInput(key, text) }] });
      const reply = (response.content ?? []).filter((b) => b.type === 'text').map((b) => b.text).join('');
      usd += costOf({ input: response.usage?.input_tokens ?? 0, output: response.usage?.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 }, o.model);
      claim = claimFromReply(reply);
      if (claim === undefined) {
        out.push({ runKey: raw.runKey, judge: { ...judge, servedModel: response.model }, unreadable: reply.slice(0, 500) });
        continue;
      }
      out.push({ runKey: raw.runKey, judge: { ...judge, servedModel: response.model }, claim });
      continue;
    }
    out.push({ runKey: raw.runKey, judge, claim });
  }
  writeFileSync(join(dir, 'judged.jsonl'), out.map((l) => JSON.stringify(l)).join('\n') + (out.length > 0 ? '\n' : ''));
  process.stdout.write(`judged: ${out.length} answers · judge ${judge.model} (${judge.family}) · prompt ${PROMPT_DIGEST}${usd > 0 ? ` · $${usd.toFixed(4)}` : ''}\n`);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    process.stderr.write(`honest-report judge: ${err?.message ?? err}\n`);
    process.exit(1);
  });
}
