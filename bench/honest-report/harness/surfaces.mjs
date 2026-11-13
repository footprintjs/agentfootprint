/**
 * bench/honest-report/harness/surfaces.mjs — what each of the three surfaces handed over, as
 * structured FACTS (RULE.md § 7). Whether a fact counts as a warning is the scorer's question
 * (`score/warnings.mjs`, through the commit's table); this file only reads.
 *
 *   S1 Delivered            — did the library add anything to the model's text, and from what
 *                             structured source (the standing line, rendered from
 *                             `turn_end.answerAssessment`)? The added words are never read.
 *   S2 Handed to the app    — `turn_end.answerAssessment`: present or not, its standing, its
 *                             reason codes (codes only: that is all the payload carries).
 *   S3 Available on request — `accountForAnswer(recording, undefined, { runId })`: each call's
 *                             outcome and emptiness, and whether any call was made.
 *
 * Reading the same recording with ANOTHER build's doors is the second reading (`reread.mjs`):
 * S2 and S3 are read again; S1 is what that run delivered and cannot be.
 *
 * Example: a `throws` run on `05cbef67` → S1 `{ addition: 'none' }`, S2 `{ present: false }`,
 * S3 `{ calls: [{ toolCallId: 'c2', outcome: 'failed', … }], … }`.
 */

const TURN_END = 'agentfootprint.agent.turn_end';

/** The events' run id of the measured turn — the account reads one run at a time. */
export function runIdOf(events) {
  return [...events].reverse().find((e) => typeof e?.meta?.runId === 'string')?.meta.runId;
}

/** S1: whether the delivered text holds a library addition, and its structured source. */
export function readS1({ deliveredText, modelText, lineArmed, events }) {
  if (typeof deliveredText !== 'string' || deliveredText === (modelText ?? '')) return { addition: 'none' };
  const assessment = events.find((e) => e.type === TURN_END)?.payload?.answerAssessment;
  if (lineArmed && assessment !== undefined) return { addition: 'standing-line', standing: assessment.standing };
  return { addition: 'other' };
}

/** S2: the assessment the turn's last event hands the app. */
export function readS2(events) {
  const a = events.find((e) => e.type === TURN_END)?.payload?.answerAssessment;
  if (a === undefined || a === null) return { present: false };
  return { present: true, standing: a.standing, reasons: (a.reasons ?? []).map((r) => (typeof r === 'string' ? r : r?.reason)) };
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

/** All three, from one run. */
export function readSurfaces(doors, recording, { deliveredText, modelText, lineArmed }) {
  const events = recording.events ?? [];
  return { S1: readS1({ deliveredText, modelText, lineArmed, events }), S2: readS2(events), S3: readS3(doors, recording) };
}
