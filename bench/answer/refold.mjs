/**
 * bench/answer/refold.mjs — the answer bench's $0 half: re-fold every recorded run the inputs
 * bench already holds (`bench/inputs/runs/<dir>/raw/*.json.gz`, real Haiku 4.5 runs and scripted
 * ones) with THIS build, and read two things off them before any paid call:
 *
 *   1. **The fold did not move.** Each raw file saved the standing its own build folded at run
 *      time (`raw.standing`, with the inputs sheet's `rowsAt` declarations). Step 6 adds two
 *      witness-row kinds and a reason, all filed only under the answer layer's arm — so over
 *      these unarmed recordings the fold must return the same value, rendering and reasons.
 *      Every disagreement is listed.
 *   2. **What the layer would have served, and the answers that exceed it.** The in-run fold takes
 *      no app declarations, so the standing the layer would have served on these runs is the fold
 *      WITHOUT `rowsAt`; beside it, the fold with them (what `agent.assessment(declarations)`
 *      and the answer account read). Per recording set: the standing mix, and the answers that
 *      state non-existence, completeness or a span flatly (`labels.mjs` · `readAnswerWords`)
 *      while their standing is not sure or ask — RQ3's "exceeds".
 *
 *   npm run build
 *   node bench/answer/refold.mjs            # writes bench/answer/results/refold.json and refold.md
 *
 * Reads recordings only; calls no model.
 */

import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';

import { assessAnswer } from 'agentfootprint/observe';

import { FOLD_DECLARATIONS } from '../inputs/cases.mjs';
import { readAnswerWords } from './labels.mjs';
import { wilson } from '../inputs/metrics.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNS = join(HERE, '..', 'inputs', 'runs');
const OUT = join(HERE, 'results');

const FLAGS = new Set(['not-sure', 'ask']);
const rate = (k, n) => ({ k, n, share: n === 0 ? undefined : k / n, wilson: wilson(k, n) });
const countBy = (xs) => xs.reduce((o, x) => ({ ...o, [x]: (o[x] ?? 0) + 1 }), {});
const reasonsOf = (a) => a.reasons.map((r) => r.reason);

/** One recorded run → one refold row. */
export function refoldRow(dir, raw) {
  const last = raw.turns[raw.turns.length - 1] ?? {};
  const answered = typeof last.answer === 'string';
  const declared = assessAnswer(raw.recording, FOLD_DECLARATIONS);
  const bare = assessAnswer(raw.recording);
  const saved = raw.standing;
  const now = {
    standing: declared.standing,
    assessment: declared.assessment,
    reasons: reasonsOf(declared),
  };
  const same =
    saved !== undefined &&
    saved.error === undefined &&
    saved.standing === now.standing &&
    saved.assessment === now.assessment &&
    JSON.stringify(saved.reasons) === JSON.stringify(now.reasons);
  const words = readAnswerWords(answered ? last.answer : undefined);
  return {
    dir,
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    answered,
    saved,
    now,
    same,
    inRun: { standing: bare.standing, reasons: reasonsOf(bare) },
    words,
    exceedsInRun: answered && words.flat && FLAGS.has(bare.standing),
    exceedsDeclared: answered && words.flat && FLAGS.has(declared.standing),
  };
}

function summarize(rows) {
  const answered = rows.filter((r) => r.answered);
  const flat = answered.filter((r) => r.words.flat);
  return {
    runs: rows.length,
    answered: answered.length,
    foldUnchanged: rate(rows.filter((r) => r.same).length, rows.length),
    inRunMix: countBy(answered.map((r) => r.inRun.standing)),
    declaredMix: countBy(answered.map((r) => r.now.standing)),
    flat: rate(flat.length, answered.length),
    hedges: rate(answered.filter((r) => r.words.hedges).length, answered.length),
    exceedsInRun: rate(answered.filter((r) => r.exceedsInRun).length, answered.length),
    exceedsDeclared: rate(answered.filter((r) => r.exceedsDeclared).length, answered.length),
    flatFlaggedInRun: rate(flat.filter((r) => FLAGS.has(r.inRun.standing)).length, flat.length),
    flatFlaggedDeclared: rate(flat.filter((r) => FLAGS.has(r.now.standing)).length, flat.length),
  };
}

const pct = (r) => (r.share === undefined ? '—' : `${(r.share * 100).toFixed(1)}% (${r.k}/${r.n})`);

function main() {
  if (!existsSync(RUNS)) throw new Error(`no recorded runs at ${RUNS}`);
  const rows = [];
  for (const dir of readdirSync(RUNS).sort()) {
    const rawDir = join(RUNS, dir, 'raw');
    if (!existsSync(rawDir)) continue;
    for (const f of readdirSync(rawDir)
      .filter((x) => x.endsWith('.json.gz'))
      .sort()) {
      const raw = JSON.parse(gunzipSync(readFileSync(join(rawDir, f))).toString('utf8'));
      rows.push(refoldRow(dir, raw));
    }
  }
  const dirs = [...new Set(rows.map((r) => r.dir))];
  const byDir = Object.fromEntries(
    dirs.map((d) => [d, summarize(rows.filter((r) => r.dir === d))]),
  );
  const all = summarize(rows);
  const changed = rows
    .filter((r) => !r.same)
    .map((r) => ({ dir: r.dir, key: r.key, saved: r.saved, now: r.now }));
  const result = {
    what:
      'Every recorded inputs-bench run re-folded with this build ($0): the saved standing against ' +
      "today's fold (with the inputs sheet's rowsAt declarations), the standing the answer layer " +
      'would have served (the fold without declarations), and answers exceeding their standing.',
    all,
    byDir,
    changed,
  };
  writeFileSync(join(OUT, 'refold.json'), `${JSON.stringify(result, null, 2)}\n`);
  const lines = [
    '# The recorded runs, re-folded ($0)',
    '',
    `${rows.length} recorded runs under \`bench/inputs/runs/\`; the fold of this build against the standing each run saved.`,
    '',
    '| set | runs | fold unchanged | in-run standing mix (no declarations) | flat answers | exceed the in-run standing | exceed the declared standing | flat answers the in-run standing flags |',
    '|---|---|---|---|---|---|---|---|',
    ...[...dirs, 'all'].map((d) => {
      const s = d === 'all' ? all : byDir[d];
      return `| ${d} | ${s.runs} | ${pct(s.foldUnchanged)} | ${JSON.stringify(s.inRunMix)} | ${pct(
        s.flat,
      )} | ${pct(s.exceedsInRun)} | ${pct(s.exceedsDeclared)} | ${pct(s.flatFlaggedInRun)} |`;
    }),
    '',
    changed.length === 0
      ? 'No recorded run folds differently today.'
      : `Folds that moved: ${changed.length} (listed in refold.json · changed).`,
    '',
  ];
  writeFileSync(join(OUT, 'refold.md'), lines.join('\n'));
  process.stdout.write(`${lines.join('\n')}\n`);
}

main();
