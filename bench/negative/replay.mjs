#!/usr/bin/env node
/**
 * bench/negative/replay.mjs — the FREE replay (design § 7): the negative-claim grammar and the
 * record-backed prose check over a study's recorded replies, measured against its labels. No
 * model, no network, no cost.
 *
 *   npm run build                                   # the command reads the BUILT package
 *   node bench/negative/replay.mjs <data-dir> [--json <out.json>]
 *
 * `<data-dir>` is the study's data folder (layout: `study.mjs`). It is read, never written, and
 * nothing of it is printed but aggregates: no reply, no case text, no identifier but a case's
 * short code inside the split line.
 *
 * The checker is an ARGUMENT (`replay(study, lib)`): the command line loads it from the built
 * package, the test suite hands it the sources, so no test needs a build.
 *
 * What it prints, per split (tune / held-out cases), per model, per arm role (PLAIN and DECLARED
 * replies test, PROMPT replies tune), per label resolution (rater A, rater B, both agreeing):
 *   - the DETECTOR's recall of replies the raters call a flat negative claim, and how often it
 *     fires on replies they call not flat (reported, not an error rate: it targets scoped
 *     sentences the labels exclude);
 *   - the ABLATION BASELINE ("withhold every detected claim") and DETECTOR + RECORD: missed
 *     overclaims (replies the raters call a flat negative claim AND false) and the correct
 *     true-zero replies a withhold would hold;
 *   - the floors, then the § 7 gates on held-out test-arm replies.
 * Every ratio carries an exact case-level 95% bound (`measure.mjs` · `casesRatio`).
 *
 * The rules are registered in `RULE.md`.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import {
  FLOORS,
  RESOLUTIONS,
  armRole,
  fmt,
  gateVerdicts,
  measureCell,
  modelFamily,
  splitCases,
} from './measure.mjs';
import { loadStudy } from './study.mjs';

const FALLBACK_CLOCK = '2026-01-01T00:00:00Z';

/**
 * The record the prose check reads for a recorded reply. The study's tools declare no `search`,
 * so no recorded call carries a composed row (§ 3.2) — until the per-case tool rewrites exist
 * (RULE.md § Record), the record is the empty one and every detected claim is noted
 * `entity-unresolved`, or the field is noted `too-many-claims` when it exceeds the claim limit.
 */
const recordFor = (reply) => ({
  leg: { namespace: 'replay', runId: 'replay' },
  turn: 1,
  clock: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?Z$/.test(reply.startedAt ?? '')
    ? reply.startedAt
    : FALLBACK_CLOCK,
  calls: [],
  ledgerComplete: true,
  tools: {},
});

/** Read one reply with the checker `lib`: what the grammar found, what the check noted. */
export function readReply(reply, lib) {
  const detection = lib.detectNegativeClaims(reply.reply);
  const rows = lib.judgeProseNegatives({ field: 'reply', text: reply.reply, record: recordFor(reply) });
  const claimRows = rows.filter((r) => r.kind === 'negative-claim');
  const notes = {};
  for (const row of rows) {
    for (const code of row.kind === 'negative-claim' ? row.notes : [row.code]) {
      notes[code] = (notes[code] ?? 0) + 1;
    }
  }
  return {
    ...reply,
    detected: detection.claims.length > 0,
    noted: claimRows.some((r) => r.notes.length > 0) || (notes['too-many-claims'] ?? 0) > 0,
    notes,
  };
}

/** Every cell's measures. `lib` = `{ detectNegativeClaims, judgeProseNegatives }`. */
export function replay(study, lib) {
  const split = splitCases(study.cases);
  const read = study.replies.map((reply) => readReply(reply, lib));
  const cells = [];
  const groups = new Map();
  for (const r of read) {
    const key = [split.get(r.code) ?? 'unsplit', modelFamily(r.model), armRole(r.arm)].join(' · ');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, replies] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const resolution of RESOLUTIONS) {
      cells.push({ cell: key, resolution, ...measureCell(replies, resolution) });
    }
  }
  const heldTest = read.filter(
    (r) => split.get(r.code) === 'held-out' && armRole(r.arm) === 'test-arm',
  );
  const gates = [];
  for (const model of ['haiku', 'sonnet']) {
    const replies = heldTest.filter((r) => modelFamily(r.model) === model);
    for (const resolution of RESOLUTIONS) {
      gates.push({ model, resolution, verdicts: gateVerdicts(measureCell(replies, resolution)) });
    }
  }
  const notes = {};
  for (const r of read) {
    for (const [code, n] of Object.entries(r.notes)) notes[code] = (notes[code] ?? 0) + n;
  }
  const splitLine = {};
  for (const [code, side] of split) splitLine[side] = [...(splitLine[side] ?? []), code].sort();
  return { split: splitLine, cells, gates, notes, replies: read.length, rebuilt: study.rebuilt };
}

/** The report. `versions` = `{ phrases, phrasesHash, statement }`. */
export function print(result, versions) {
  const out = [];
  out.push(
    '# Negative claims — the free replay (PRELIMINARY: labels from two model-rater sessions, not yet checked by a person)',
  );
  out.push('');
  out.push(`grammar ${versions.phrases} · ${versions.phrasesHash} · statement ${versions.statement}`);
  out.push('bounds: exact (Clopper-Pearson) 95%, over cases');
  out.push(
    `floors: positives ≥ ${FLOORS.positives.replies} replies from ≥ ${FLOORS.positives.cases} cases; ` +
      `negatives ≥ ${FLOORS.negatives.replies} from ≥ ${FLOORS.negatives.cases}`,
  );
  out.push(`replies read: ${result.replies}`);
  for (const r of result.rebuilt) {
    out.push(`label key rebuilt by the sheet rule: ${r.items} items over ${r.runs} runs`);
  }
  out.push(
    `split — tune: ${(result.split.tune ?? []).join(' ')} · held-out: ${(result.split['held-out'] ?? []).join(' ')}`,
  );
  out.push(`notes filed: ${JSON.stringify(result.notes)}`);
  out.push('');
  for (const c of result.cells) {
    out.push(
      `## ${c.cell} — labels ${c.resolution} (${c.judged} judged; ${c.disputed} disputed or unlabelled, dropped)`,
    );
    out.push(`  detector  recall of flat claims        ${fmt(c.detector.sensitivity)}`);
    out.push(`            fires on not-flat replies    ${fmt(c.detector.firesOnNotFlat)} (reported, not an error rate)`);
    out.push(`  baseline  missed overclaims            ${fmt(c.baseline.missedOverclaims)}`);
    out.push(`            true zeros held              ${fmt(c.baseline.trueZeroHolds)}`);
    out.push(`  +record   missed overclaims            ${fmt(c.record.missedOverclaims)}`);
    out.push(`            true zeros held              ${fmt(c.record.trueZeroHolds)}`);
    out.push(`            same as baseline: ${c.record.sameAsBaseline}`);
    out.push(
      `  positives ${c.positives} replies from ${c.positiveCases} cases · true zeros ${c.trueZero.replies} replies from ${c.trueZero.cases} cases`,
    );
  }
  out.push('');
  out.push('## Gates — held-out cases, PLAIN and DECLARED replies');
  for (const g of result.gates) {
    const line = g.verdicts.map((v) => `${v.name}: ${v.verdict}`).join(' · ');
    out.push(`  ${g.model} · labels ${g.resolution}: ${line}`);
  }
  return out.join('\n');
}

/** The command line: the checker from the BUILT package. */
async function main(argv) {
  const [dataDir, ...rest] = argv;
  if (dataDir === undefined) {
    process.stderr.write('usage: node bench/negative/replay.mjs <data-dir> [--json <out.json>]\n');
    process.exit(2);
  }
  const dist = '../../dist/esm/integrity/negative-claim';
  const { detectNegativeClaims } = await import(`${dist}/detect.js`);
  const { judgeProseNegatives } = await import(`${dist}/prose.js`);
  const phrases = await import(`${dist}/phrases.js`);
  const { STATEMENT_VERSION } = await import(`${dist}/statement.js`);
  const result = replay(loadStudy(dataDir), { detectNegativeClaims, judgeProseNegatives });
  const versions = {
    phrases: phrases.NEGATIVE_CLAIM_PHRASES_VERSION,
    phrasesHash: phrases.NEGATIVE_CLAIM_PHRASES_HASH,
    statement: STATEMENT_VERSION,
  };
  process.stdout.write(`${print(result, versions)}\n`);
  const at = rest.indexOf('--json');
  if (at !== -1 && rest[at + 1] !== undefined) {
    writeFileSync(rest[at + 1], `${JSON.stringify({ ...result, versions }, null, 2)}\n`);
  }
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) await main(process.argv.slice(2));
