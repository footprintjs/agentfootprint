#!/usr/bin/env node
/**
 * bench/negative/replay.mjs — the FREE replay (design § 7): the negative-claim grammar and the
 * record-backed prose check over a study's recorded replies, measured against its labels. No
 * model, no network, no cost.
 *
 *   npm run build                                   # the replay reads the BUILT package
 *   node bench/negative/replay.mjs <data-dir> [--json <out.json>]
 *
 * `<data-dir>` is the study's data folder (layout: `study.mjs`). It is read, never written, and
 * nothing of it is printed but aggregates: no reply, no case text, no identifier but a case's
 * short code inside the split line.
 *
 * What it prints, per split (tune / held-out cases), per model, per arm role (PLAIN and DECLARED
 * replies test, PROMPT replies tune), per label resolution (rater A, rater B, both agreeing):
 *   - the DETECTOR against "the reply states a flat negative or completeness claim":
 *     sensitivity, specificity, precision;
 *   - the ABLATION BASELINE ("withhold every detected flat claim") against "the reply states a
 *     claim the record cannot support" (flagged): missed overclaims, specificity, and how many
 *     correct true-zero replies it would hold;
 *   - DETECTOR + RECORD (the prose check over the calls' composed rows): the same three;
 *   - true-zero counts and the positive floor; then the § 7 gates on held-out test-arm replies.
 * Every ratio carries a case-clustered 95% bound (`measure.mjs` · `clusteredRatio`).
 *
 * The rules are registered in `RULE.md`.
 */

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

import { detectNegativeClaims } from '../../dist/esm/integrity/negative-claim/detect.js';
import {
  NEGATIVE_CLAIM_PHRASES_HASH,
  NEGATIVE_CLAIM_PHRASES_VERSION,
} from '../../dist/esm/integrity/negative-claim/phrases.js';
import { judgeProseNegatives } from '../../dist/esm/integrity/negative-claim/prose.js';
import { STATEMENT_VERSION } from '../../dist/esm/integrity/negative-claim/statement.js';
import {
  BOOTSTRAP,
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
 * `entity-unresolved`.
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

/** Read one reply: what the grammar found, and what the record-backed check noted. */
export function readReply(reply) {
  const detection = detectNegativeClaims(reply.reply);
  const rows = judgeProseNegatives({ field: 'reply', text: reply.reply, record: recordFor(reply) });
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
    noted: claimRows.some((r) => r.notes.length > 0),
    notes,
  };
}

/** Every cell's measures. */
export function replay(study) {
  const split = splitCases(study.cases);
  const read = study.replies.map(readReply);
  const cells = [];
  const groups = new Map();
  for (const r of read) {
    const parts = [split.get(r.code) ?? 'unsplit', modelFamily(r.model), armRole(r.arm)];
    const key = parts.join(' · ');
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  for (const [key, replies] of [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    for (const resolution of RESOLUTIONS) {
      cells.push({ cell: key, resolution, ...measureCell(replies, resolution) });
    }
  }
  const heldTest = read.filter((r) => split.get(r.code) === 'held-out' && armRole(r.arm) === 'test-arm');
  const gates = [];
  for (const model of ['haiku', 'sonnet']) {
    const replies = heldTest.filter((r) => modelFamily(r.model) === model);
    for (const resolution of RESOLUTIONS) {
      gates.push({ model, resolution, verdicts: gateVerdicts(measureCell(replies, resolution)) });
    }
  }
  const notes = {};
  for (const r of read) for (const [code, n] of Object.entries(r.notes)) notes[code] = (notes[code] ?? 0) + n;
  const splitLine = {};
  for (const [code, side] of split) splitLine[side] = [...(splitLine[side] ?? []), code].sort();
  return { split: splitLine, cells, gates, notes, replies: read.length, rebuilt: study.rebuilt };
}

function print(result) {
  const out = [];
  out.push('# Negative claims — the free replay (PRELIMINARY: model-rater labels, not yet checked by a person)');
  out.push('');
  out.push(`grammar ${NEGATIVE_CLAIM_PHRASES_VERSION} · ${NEGATIVE_CLAIM_PHRASES_HASH}`);
  out.push(`statement ${STATEMENT_VERSION} · bootstrap ${BOOTSTRAP.resamples} case resamples, seed ${BOOTSTRAP.seed}`);
  out.push(`replies read: ${result.replies}`);
  for (const r of result.rebuilt) out.push(`label key rebuilt by the sheet rule: ${r.items} items over ${r.runs} runs`);
  out.push(`split — tune: ${(result.split.tune ?? []).join(' ')} · held-out: ${(result.split['held-out'] ?? []).join(' ')}`);
  out.push(`notes filed: ${JSON.stringify(result.notes)}`);
  out.push('');
  for (const c of result.cells) {
    out.push(`## ${c.cell} — labels ${c.resolution} (${c.replies} replies, ${c.disputed} disputed or unlabelled)`);
    out.push(`  detector  sensitivity ${fmt(c.detector.sensitivity)}`);
    out.push(`            specificity ${fmt(c.detector.specificity)}`);
    out.push(`            precision   ${fmt(c.detector.precision)}`);
    out.push(`  baseline  missed overclaims ${fmt(c.baseline.missedOverclaims)}`);
    out.push(`            specificity       ${fmt(c.baseline.specificity)}`);
    out.push(`            true zeros held   ${fmt(c.baseline.trueZeroHolds)}`);
    out.push(`  +record   missed overclaims ${fmt(c.record.missedOverclaims)}`);
    out.push(`            specificity       ${fmt(c.record.specificity)}`);
    out.push(`            true zeros held   ${fmt(c.record.trueZeroHolds)}`);
    out.push(`            same as baseline: ${c.record.sameAsBaseline}`);
    out.push(`  positives ${c.positives} replies from ${c.positiveCases} cases · true zeros ${c.trueZero.replies} replies from ${c.trueZero.cases} cases`);
  }
  out.push('');
  out.push('## Gates — held-out cases, PLAIN and DECLARED replies');
  for (const g of result.gates) {
    const line = g.verdicts
      .map((v) => `${v.name}: ${v.verdict}${v.lift === undefined ? '' : ` (lift ${(v.lift * 100).toFixed(1)} pts)`}`)
      .join(' · ');
    out.push(`  ${g.model} · labels ${g.resolution}: ${line}`);
  }
  return out.join('\n');
}

const isMain =
  process.argv[1] !== undefined && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isMain) {
  const [dataDir, ...rest] = process.argv.slice(2);
  if (dataDir === undefined) {
    process.stderr.write('usage: node bench/negative/replay.mjs <data-dir> [--json <out.json>]\n');
    process.exit(2);
  }
  const result = replay(loadStudy(dataDir));
  process.stdout.write(`${print(result)}\n`);
  const at = rest.indexOf('--json');
  if (at !== -1 && rest[at + 1] !== undefined) {
    writeFileSync(rest[at + 1], `${JSON.stringify({ ...result }, null, 2)}\n`);
  }
}

export { print };
