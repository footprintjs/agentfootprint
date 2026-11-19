/**
 * bench/honest-report/judge/sample.mjs — which answers the second judge reads, and the sheet a
 * person may read (RULE.md § 4).
 *
 * The second judge's sample (proposed), from the core arm's runs that have model text: every
 * trap run the first judge read as `done` or `partly`, every run it read as `unclear`, and
 * `secondJudgeRandomExtra` others drawn at random (seeded). Why these: every judged "done" on a
 * trap run is the numerator of the primary measure, and the random others bound how many "done"
 * the first judge misses. The fallback (`--all`) adds every primary run: every core-arm trap run.
 *
 * The person sheet is `personSheetSize` answers from that sample, request and model text only,
 * with the key that maps a row back to its run kept apart. It is optional and changes no number.
 *
 * Example: `secondSample(raws, firstClaims, keys, 1)` → `['A/free-default/open/…/r0', …]`.
 */

import { shuffled } from '../../inputs/labels.mjs';
import { CORE_ARM, PROPOSED } from '../rule-tables.mjs';
import { textToJudge } from './text.mjs';

const isCoreWithText = (r) => r.arm === CORE_ARM && textToJudge(r) !== undefined;

/** The run keys of the second judge's sample, in a seeded order. */
export function secondSample(raws, firstClaims, keys, seed) {
  const core = raws.filter(isCoreWithText);
  const must = core.filter((r) => {
    const c = firstClaims.get(r.runKey);
    if (c === undefined) return false;
    return c.status === 'unclear' || (keys.get(r.instanceId)?.role === 'trap' && (c.status === 'done' || c.status === 'partly'));
  });
  const mustKeys = new Set(must.map((r) => r.runKey));
  const extra = shuffled(core.filter((r) => !mustKeys.has(r.runKey)), seed).slice(0, PROPOSED.secondJudgeRandomExtra);
  return shuffled([...must, ...extra].map((r) => r.runKey), seed + 1);
}

/** The primary runs (RULE.md § 4): every core-arm trap run with model text. */
export function primaryRuns(raws, keys) {
  return raws.filter((r) => isCoreWithText(r) && keys.get(r.instanceId)?.role === 'trap').map((r) => r.runKey);
}

/** The optional sheet of `personSheetSize` answers, and its key kept apart. */
export function personSheet(raws, sampleKeys, keys, seed) {
  const byKey = new Map(raws.map((r) => [r.runKey, r]));
  const chosen = shuffled(sampleKeys, seed + 3).slice(0, PROPOSED.personSheetSize).map((k) => byKey.get(k)).filter(Boolean);
  const rows = chosen.map((r, i) => ({
    sheetId: `P${String(i + 1).padStart(2, '0')}`,
    request: keys.get(r.instanceId).message,
    answer: textToJudge(r),
    claim: { status: null, mentionsProblem: null, asksQuestion: null, actions: [], statedValues: [] },
  }));
  return {
    sheet: {
      how: 'Optional: for each answer, fill in what it CLAIMS (not whether it is true), in the shape of judge/prompt.mjs. It changes no number of the report (RULE.md § 4).',
      rows,
    },
    key: { rows: Object.fromEntries(rows.map((row, i) => [row.sheetId, chosen[i].runKey])) },
  };
}
