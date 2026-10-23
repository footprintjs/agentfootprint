/**
 * bench/negative/study.mjs — reads a study's recorded replies and their labels from a data folder
 * the caller names. Nothing from that folder is copied into this repository: the replay prints
 * aggregates only.
 *
 * The layout read (the study's `data/` folder):
 *   cases/<id>.json        — { id, kind, withdrawn?, role? }; a withdrawn case or a spare is not in the bank
 *   runs/<run>/turns.jsonl — one row per turn: turnId, status, exclusion, reply, model, startedAt
 *   runs/<run>/key.jsonl   — turnId → arm, caseId (sealed in the study; read here, never printed)
 *   runs/<run>/sealed/checks(-amended).jsonl — which turns are void
 *   labels/<set>/labels-{a,b}.jsonl — one row per sheet item, by sheetId
 *   labels/<set>/key.jsonl — sheetId → turnId; when a set has none, it is rebuilt by the study's
 *     own sheet rule (`study/labels/sheets.mjs` · `blindSheet`: the analysed turns of the set's
 *     runs, ordered by sha256(`rater-sheet|<run>+<run>…|<turnId>`), runs in time order) and the
 *     rebuilt length must equal the label count. The rule reproduces the one key that exists.
 *
 * A reply's labels: `claimsNonExistence` (the reply states a flat negative or completeness claim,
 * true or not) and `flagged` (it states one that is false — the claim the record cannot support).
 */

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const rows = (file) =>
  existsSync(file)
    ? readFileSync(file, 'utf8')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line))
    : [];

const dirsIn = (dir) =>
  existsSync(dir)
    ? readdirSync(dir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];

/** The short code of a case id: the part before its first hyphen (`c3`). */
export const shortCode = (caseId) => String(caseId).split('-')[0];

/** The trailing `YYYYMMDDTHHMMSSZ` of a run folder, for time order. */
const stampOf = (name) => /(\d{8}T\d{6}Z)$/.exec(name)?.[1] ?? name;

function voidedTurns(runDir) {
  const checks = new Map(rows(join(runDir, 'sealed', 'checks.jsonl')).map((r) => [r.turnId, r]));
  for (const r of rows(join(runDir, 'sealed', 'checks-amended.jsonl'))) checks.set(r.turnId, r);
  return new Set([...checks.values()].filter((r) => r.void).map((r) => r.turnId));
}

/** The study's sheet order over some runs — its key, rebuilt. */
export function rebuildSheetKey(dataDir, runNames) {
  const ordered = [...runNames].sort((a, b) => stampOf(a).localeCompare(stampOf(b)));
  const turnIds = [];
  for (const name of ordered) {
    const dir = join(dataDir, 'runs', name);
    const voided = voidedTurns(dir);
    for (const t of rows(join(dir, 'turns.jsonl'))) {
      if (t.status === 'done' && !t.exclusion && !voided.has(t.turnId)) turnIds.push(t.turnId);
    }
  }
  const seed = `rater-sheet|${ordered.join('+')}`;
  const order = (id) => createHash('sha256').update(`${seed}|${id}`).digest('hex');
  return turnIds
    .sort((a, b) => order(a).localeCompare(order(b)))
    .map((turnId, i) => ({ sheetId: `S${String(i + 1).padStart(4, '0')}`, turnId }));
}

const labelOf = (row) =>
  row === undefined
    ? undefined
    : {
        flat: typeof row.claimsNonExistence === 'boolean' ? row.claimsNonExistence : undefined,
        flagged: typeof row.flagged === 'boolean' ? row.flagged : undefined,
      };

/** The bank of cases, every analysed reply that carries labels, and what was rebuilt. */
export function loadStudy(dataDir) {
  const cases = new Map();
  for (const file of readdirSync(join(dataDir, 'cases')).filter((f) => f.endsWith('.json'))) {
    const c = JSON.parse(readFileSync(join(dataDir, 'cases', file), 'utf8'));
    if (c.withdrawn || c.role === 'spare') continue;
    cases.set(c.id, { code: shortCode(c.id), kind: c.kind });
  }

  const turns = new Map();
  const keyedRuns = [];
  for (const name of dirsIn(join(dataDir, 'runs'))) {
    const dir = join(dataDir, 'runs', name);
    const key = new Map(rows(join(dir, 'key.jsonl')).map((r) => [r.turnId, r]));
    if (key.size === 0) continue;
    keyedRuns.push({ name, turnIds: new Set(key.keys()) });
    for (const t of rows(join(dir, 'turns.jsonl'))) {
      const k = key.get(t.turnId);
      if (k !== undefined) turns.set(t.turnId, { ...t, arm: k.arm, caseId: k.caseId });
    }
  }

  const replies = [];
  const rebuilt = [];
  const sets = dirsIn(join(dataDir, 'labels'));
  const keyed = new Set();
  for (const set of sets) for (const r of rows(join(dataDir, 'labels', set, 'key.jsonl'))) keyed.add(r.turnId);
  for (const set of sets) {
    const dir = join(dataDir, 'labels', set);
    const a = new Map(rows(join(dir, 'labels-a.jsonl')).map((r) => [r.sheetId, r]));
    const b = new Map(rows(join(dir, 'labels-b.jsonl')).map((r) => [r.sheetId, r]));
    if (a.size === 0 && b.size === 0) continue;
    let key = rows(join(dir, 'key.jsonl'));
    if (key.length === 0) {
      const runs = keyedRuns
        .filter((run) => ![...run.turnIds].some((id) => keyed.has(id)))
        .map((run) => run.name);
      key = rebuildSheetKey(dataDir, runs);
      if (key.length !== Math.max(a.size, b.size)) {
        throw new Error(`labels set ${set}: rebuilt key holds ${key.length} items, labels ${a.size}`);
      }
      rebuilt.push({ set, runs: runs.length, items: key.length });
    }
    for (const { sheetId, turnId } of key) {
      const turn = turns.get(turnId);
      const bank = turn === undefined ? undefined : cases.get(turn.caseId);
      if (turn === undefined || bank === undefined) continue;
      replies.push({
        turnId,
        code: bank.code,
        kind: bank.kind,
        arm: turn.arm,
        model: String(turn.model ?? ''),
        startedAt: turn.startedAt,
        reply: String(turn.reply ?? ''),
        labels: { A: labelOf(a.get(sheetId)), B: labelOf(b.get(sheetId)) },
      });
    }
  }
  return { cases: [...cases.values()], replies, rebuilt };
}
