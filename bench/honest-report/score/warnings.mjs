/**
 * bench/honest-report/score/warnings.mjs — whether each surface warned, from the surfaces'
 * structured facts (`harness/surfaces.mjs`) and the warning table of the commit that READ them
 * (RULE.md § 7; `rule-tables.mjs` · `WARNING_TABLES`).
 *
 * On every surface a warning must NAME the critical call (RULE.md § 7): S3 through the account's
 * call facts on the critical call ids; S1 and S2 through the WITNESS fields the table names for
 * their source — a source warns only when a witness field holds a critical call's id or tool
 * name. A source that names none reads as its `otherwise` value (doubt, listed or not), however
 * much it says.
 *
 * A fact the table does not name (a new outcome word on a later commit) counts as no warning and
 * is listed in `unmapped`, so the report shows it and nobody is credited for a word the table
 * never saw.
 *
 * Example, `05cbef67`: S3 facts `{ calls: [{ toolCallId: 'c2', outcome: 'failed' }] }` with
 * critical ids `['c2']` → `{ warned: true }`; the same with outcome `ran` → `{ warned: false }`.
 * Example, an after table with witness `['reasons[].toolCallId']`: an assessment whose reasons
 * hold `{ toolCallId: 'c2' }` warns when `c2` is critical; one that names `c9` is only listed.
 */

import { DOUBT_STANDINGS } from '../rule-tables.mjs';

const doubtOf = (standing) => DOUBT_STANDINGS.includes(standing);

/**
 * The string values of `value` at `path`: dotted keys, `[]` after a key for every element of the
 * list there. Example: `valuesAt({ reasons: [{ toolCallId: 'c2' }] }, 'reasons[].toolCallId')`
 * → `['c2']`.
 */
export function valuesAt(value, path) {
  let current = [value];
  for (const part of path.split('.')) {
    const each = part.endsWith('[]');
    const key = each ? part.slice(0, -2) : part;
    const next = [];
    for (const v of current) {
      if (v === null || typeof v !== 'object') continue;
      const got = key === '' ? v : v[key];
      if (each) {
        if (Array.isArray(got)) next.push(...got);
      } else if (got !== undefined) next.push(got);
    }
    current = next;
  }
  return current.filter((v) => typeof v === 'string');
}

/** The critical names a source's witness fields hold: call ids and tool names (RULE.md § 7). */
export function namedCritical(value, witness, critical) {
  const names = new Set([...critical.ids, ...critical.tools]);
  return [...new Set(witness.flatMap((path) => valuesAt(value, path)).filter((v) => names.has(v)))];
}

function verdictOf(value, standing) {
  return { warned: value === 'warning', doubt: value === 'doubt' && doubtOf(standing), ...(value === 'listed' && { listed: true }) };
}

function fromValue(value, standing, unmapped, what) {
  if (value === undefined) {
    unmapped.push(what);
    return { warned: false, doubt: false };
  }
  return verdictOf(value, standing);
}

/** A table source's verdict: a warning when a witness names a critical call, else its `otherwise`. */
function fromSource(source, fact, critical, unmapped, what) {
  if (source === undefined) {
    unmapped.push(what);
    return { warned: false, doubt: false };
  }
  const named = namedCritical(fact.value, source.witness ?? [], critical);
  if (named.length > 0) return { warned: true, doubt: false, named };
  return verdictOf(source.otherwise, fact.standing);
}

export function readS1Warning(s1, table, critical, unmapped) {
  if (s1.addition === 'none') return fromValue(table.S1['no-addition'], undefined, unmapped, 'S1:no-addition');
  if (s1.source === 'other' || s1.source === undefined) return fromValue(table.S1['other-addition'], undefined, unmapped, 'S1:other-addition');
  return fromSource(table.S1.sources?.[s1.source], s1, critical, unmapped, `S1:${s1.source}`);
}

export function readS2Warning(s2, table, critical, unmapped) {
  if (!s2.present) return fromValue(table.S2.absent, undefined, unmapped, 'S2:absent');
  return fromSource(table.S2.present, s2, critical, unmapped, 'S2:present');
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

/**
 * All three surfaces' verdicts for one run.
 * @param {object} surfaces   the run's facts
 * @param {{ ids: string[], tools: string[] }} critical  the critical calls' ids (the world's log) and tool names (the key)
 * @param {object} table      the reading commit's warning table
 */
export function warningsOf(surfaces, critical, table) {
  const unmapped = [];
  return {
    S1: readS1Warning(surfaces.S1, table, critical, unmapped),
    S2: readS2Warning(surfaces.S2, table, critical, unmapped),
    S3: readS3Warning(surfaces.S3, critical.ids, table, unmapped),
    unmapped,
  };
}
