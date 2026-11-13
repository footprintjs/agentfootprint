/**
 * bench/honest-report/harness/surfaces.mjs — what each of the three surfaces handed over, as
 * structured FACTS (RULE.md § 7). Whether a fact counts as a warning is the scorer's question
 * (`score/warnings.mjs`, through the commit's table); this file only reads.
 *
 *   S1 Delivered            — did the library add anything to the model's own text, and from
 *                             which structured SOURCE the commit's table names (for 05cbef67: the
 *                             standing line, rendered from `turn_end.answerAssessment`)? The
 *                             source's whole value is kept; the added words are never read.
 *   S2 Handed to the app    — the source the table names (for 05cbef67:
 *                             `turn_end.answerAssessment`), its whole value kept.
 *   S3 Available on request — `accountForAnswer(recording, undefined, { runId })`: each call's
 *                             outcome and emptiness, and whether any call was made.
 *
 * Why the whole value: a warning must NAME the critical call (RULE.md § 7), so the scorer looks
 * for the call's id or tool in the fields the table calls witnesses; a reader that kept only
 * reason codes could never see a name, whatever a later commit put there.
 *
 * Reading the same recording with ANOTHER build's doors and table is the second reading
 * (`reread.mjs`): S2 and S3 are read again; S1 is what that run delivered and cannot be.
 *
 * Example: a `throws` run on `05cbef67` → S1 `{ addition: 'none' }`, S2 `{ present: false }`,
 * S3 `{ calls: [{ toolCallId: 'c2', outcome: 'failed', … }], … }`.
 */

const clone = (v) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

/** The events' run id of the measured turn — the account reads one run at a time. */
export function runIdOf(events) {
  return [...events].reverse().find((e) => typeof e?.meta?.runId === 'string')?.meta.runId;
}

/** The value a table source names: `payload[field]` of the LAST event of its type, or undefined. */
export function sourceValue(events, source) {
  const e = [...events].reverse().find((x) => x?.type === source.event);
  const v = e?.payload?.[source.field];
  return v === null ? undefined : v;
}

/**
 * S1: whether the delivered text holds a library addition and, when it does, the first source of
 * the table's `S1.sources` that is present (an `armedOnly` source counts only on the arm that
 * switched it on). An addition from no named source is `{ addition: 'present', source: 'other' }`.
 */
export function readS1({ deliveredText, modelText, lineArmed, events, table }) {
  if (typeof deliveredText !== 'string' || deliveredText === (modelText ?? '')) return { addition: 'none' };
  for (const [id, source] of Object.entries(table.S1.sources ?? {})) {
    if (source.armedOnly && !lineArmed) continue;
    const value = sourceValue(events, source);
    if (value !== undefined) return { addition: 'present', source: id, value: clone(value), standing: value?.standing };
  }
  return { addition: 'present', source: 'other' };
}

/** S2: the source the table names as what the run hands the app, its whole value. */
export function readS2(events, table) {
  const value = sourceValue(events, table.S2.present);
  if (value === undefined) return { present: false };
  return { present: true, value: clone(value), standing: value?.standing };
}

/** S3: the account's call facts, or the error the account threw. */
export function readS3(doors, recording) {
  try {
    const account = doors.accountForAnswer(recording, undefined, { runId: runIdOf(recording.events ?? []) });
    const facts = account.facts ?? {};
    return {
      calls: (facts.calls ?? []).map((c) => ({ toolCallId: c.toolCallId, toolName: c.toolName, outcome: c.outcome, emptiness: c.emptiness })),
      omitted: facts.callsOmitted ?? 0,
      standing: facts.standing?.value,
    };
  } catch (err) {
    return { error: String(err?.message ?? err) };
  }
}

/** All three, from one run, through the table of the build that ran it. */
export function readSurfaces(doors, recording, { deliveredText, modelText, lineArmed, table }) {
  const events = recording.events ?? [];
  return { S1: readS1({ deliveredText, modelText, lineArmed, events, table }), S2: readS2(events, table), S3: readS3(doors, recording) };
}
