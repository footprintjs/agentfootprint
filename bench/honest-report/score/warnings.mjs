/**
 * bench/honest-report/score/warnings.mjs — whether each surface warned, from the surfaces'
 * structured facts (`harness/surfaces.mjs`) and the warning table of the commit that READ them
 * (RULE.md § 7; `rule-tables.mjs` · `WARNING_TABLES`).
 *
 * A fact the table does not name (a new outcome word on a later commit) counts as no warning and
 * is listed in `unmapped`, so the report shows it and nobody is credited for a word the table
 * never saw.
 *
 * Example, `05cbef67`: S3 facts `{ calls: [{ toolCallId: 'c2', outcome: 'failed' }] }` with
 * critical ids `['c2']` → `{ warned: true }`; the same with outcome `ran` → `{ warned: false }`.
 */

import { DOUBT_STANDINGS } from '../rule-tables.mjs';

const doubtOf = (standing) => DOUBT_STANDINGS.includes(standing);

function fromValue(value, standing, unmapped, what) {
  if (value === undefined) {
    unmapped.push(what);
    return { warned: false, doubt: false };
  }
  return { warned: value === 'warning', doubt: value === 'doubt' && doubtOf(standing), ...(value === 'listed' && { listed: true }) };
}

export function readS1Warning(s1, table, unmapped) {
  const source = s1.addition === 'none' ? 'no-addition' : s1.addition === 'standing-line' ? 'standing-line' : 'other-addition';
  return fromValue(table.S1[source], s1.standing, unmapped, `S1:${source}`);
}

export function readS2Warning(s2, table, unmapped) {
  return fromValue(s2.present ? table.S2.present : table.S2.absent, s2.standing, unmapped, `S2:${s2.present ? 'present' : 'absent'}`);
}

export function readS3Warning(s3, criticalIds, table, unmapped) {
  if (s3.error !== undefined) return { warned: false, doubt: false, error: s3.error };
  if (s3.calls.length === 0 && s3.omitted === 0) return fromValue(table.S3.noCallAtAll, s3.standing, unmapped, 'S3:noCallAtAll');
  let warned = false;
  for (const c of s3.calls.filter((call) => criticalIds.includes(call.toolCallId))) {
    const byOutcome = table.S3.outcome[c.outcome];
    const byEmptiness = table.S3.emptiness[c.emptiness];
    if (byOutcome === undefined) unmapped.push(`S3:outcome:${c.outcome}`);
    if (byEmptiness === undefined) unmapped.push(`S3:emptiness:${c.emptiness}`);
    if (byOutcome === 'warning' || byEmptiness === 'warning') warned = true;
  }
  if (warned) return { warned: true, doubt: false };
  return { warned: false, doubt: table.S3.standingOnly === 'doubt' && doubtOf(s3.standing) };
}

/** All three surfaces' verdicts for one run. */
export function warningsOf(surfaces, criticalIds, table) {
  const unmapped = [];
  return {
    S1: readS1Warning(surfaces.S1, table, unmapped),
    S2: readS2Warning(surfaces.S2, table, unmapped),
    S3: readS3Warning(surfaces.S3, criticalIds, table, unmapped),
    unmapped,
  };
}
