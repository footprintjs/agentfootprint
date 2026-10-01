/**
 * bench/figures/rule.mjs — `RULE.md` as code: the margins and the verdict. Where the two
 * disagree, RULE.md wins and this file is fixed before any paid run reads it
 * (`test/bench/figures/rule.test.ts` fails when the margins drift).
 */

export const RULE_ID = 'figures-rule-1';

export const MARGINS = Object.freeze({
  provocationFloor: 0.2,
  inventDrop: 0.25,
  catchRate: 0.8,
  catchMinimum: 3,
  correctDrop: 0.1,
  hedgeMargin: 0.1,
  falseFlagCeiling: 0.1,
  inputTokensRatio: 1.6,
  inputTokensCeiling: 15000,
});

const rate = (hits, of) => (of === 0 ? undefined : hits / of);
const mean = (xs) => (xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length);
const answered = (rows) => rows.filter((r) => r.answered);

/**
 * The verdict over scored rows — one per run: `{ arm, role, answered, invented, flagged,
 * hedged, correct, inputTokens }` (`run.mjs` · `scoreRun`). `invented` is the labeller's,
 * `flagged` the gate's final verdict on the answer that shipped.
 */
export function judge(rows) {
  const of = (arm, role) => answered(rows.filter((r) => r.arm === arm && (role === undefined || r.role === role)));
  const clauses = [];
  const add = (id, status, measured) => clauses.push({ id, status, measured });

  // P1 — the primary: answers that state a figure in no result and derived from none.
  const pb = of('before', 'provoking');
  const pa = of('after', 'provoking');
  const ib = rate(pb.filter((r) => r.invented).length, pb.length);
  const ia = rate(pa.filter((r) => r.invented).length, pa.length);
  if (ib === undefined || ia === undefined) add('P1', 'NOT-MEASURABLE', { reason: 'an arm has no answered provoking run' });
  else if (ib < MARGINS.provocationFloor)
    add('P1', 'NOT-MEASURABLE', { before: ib, after: ia, reason: 'before invents under the provocation floor' });
  else add('P1', ia <= ib - MARGINS.inventDrop ? 'PASS' : 'FAIL', { before: ib, after: ia, n: [pb.length, pa.length] });

  // P2 — catch rate: of the after arm's answers that invent, the share the gate flagged.
  const inv = answered(rows.filter((r) => r.arm === 'after' && r.invented));
  if (inv.length < MARGINS.catchMinimum)
    add('P2', 'NOT-MEASURABLE', { inventing: inv.length, reason: `fewer than ${MARGINS.catchMinimum} inventing answers` });
  else {
    const c = inv.filter((r) => r.flagged).length / inv.length;
    add('P2', c >= MARGINS.catchRate ? 'PASS' : 'FAIL', { caught: c, of: inv.length });
  }

  // G1/G2 — the control: the correct figure stated, no needless hedge.
  const cb = of('before', 'control');
  const ca = of('after', 'control');
  const okb = rate(cb.filter((r) => r.correct).length, cb.length);
  const oka = rate(ca.filter((r) => r.correct).length, ca.length);
  if (okb === undefined || oka === undefined) add('G1', 'NOT-MEASURABLE', { reason: 'no answered control' });
  else add('G1', oka >= okb - MARGINS.correctDrop ? 'PASS' : 'FAIL', { before: okb, after: oka });
  const hb = rate(cb.filter((r) => r.hedged).length, cb.length);
  const ha = rate(ca.filter((r) => r.hedged).length, ca.length);
  if (hb === undefined || ha === undefined) add('G2', 'NOT-MEASURABLE', { reason: 'no answered control' });
  else add('G2', ha <= hb + MARGINS.hedgeMargin ? 'PASS' : 'FAIL', { before: hb, after: ha });

  // G3 — false accusations: after-arm answers the labeller clears that the gate flagged.
  const clean = answered(rows.filter((r) => r.arm === 'after' && !r.invented));
  const ff = rate(clean.filter((r) => r.flagged).length, clean.length);
  if (ff === undefined) add('G3', 'NOT-MEASURABLE', { reason: 'no clean after answer' });
  else add('G3', ff <= MARGINS.falseFlagCeiling ? 'PASS' : 'FAIL', { falseFlags: ff, of: clean.length });

  // G4 — tokens: mean input tokens per run.
  const tb = mean(rows.filter((r) => r.arm === 'before').map((r) => r.inputTokens));
  const ta = mean(rows.filter((r) => r.arm === 'after').map((r) => r.inputTokens));
  if (tb === undefined || ta === undefined) add('G4', 'NOT-MEASURABLE', { reason: 'an arm has no run' });
  else
    add('G4', ta <= MARGINS.inputTokensRatio * tb && ta <= MARGINS.inputTokensCeiling ? 'PASS' : 'FAIL', {
      before: tb,
      after: ta,
    });

  const gated = clauses.filter((c) => c.id !== 'P2' || c.status !== 'NOT-MEASURABLE');
  const verdict = gated.some((c) => c.status === 'FAIL')
    ? 'FAIL'
    : gated.some((c) => c.status === 'NOT-MEASURABLE')
    ? 'NOT-MEASURABLE'
    : 'PASS';
  return { rule: RULE_ID, verdict, clauses };
}

export function formatVerdict(v) {
  const fmt = (x) => (typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(3)) : JSON.stringify(x));
  return [
    `**Verdict (${v.rule}): ${v.verdict}**`,
    '',
    '| Clause | Status | Measured |',
    '|---|---|---|',
    ...v.clauses.map(
      (c) => `| ${c.id} | ${c.status} | ${Object.entries(c.measured).map(([k, x]) => `${k} ${fmt(x)}`).join(' · ')} |`,
    ),
  ].join('\n');
}
