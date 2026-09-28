/**
 * bench/results/rule.mjs — `RULE.md` as code: the step-7b verdict, computed from the rows
 * (`metrics.mjs` · `readRun`), never argued. Where this file and `RULE.md` disagree, the page
 * wins and this file is fixed before any paid run reads it; `test/bench/results/rule.test.ts`
 * fails if the margins drift from the page's table.
 */

import { GROUPS, aggregate } from './metrics.mjs';

export const RULE_ID = 'results-rule-7b (registered 2026-09-28)';

/** The registered margins — `RULE.md`, "Margins". */
export const MARGINS = Object.freeze({
  alpha: 0.05,
  provocationFloor: 0.2,
  foldAgreement: 0.95,
  hedgeMargin: 0.1,
  factsDrop: 0.05,
  inputTokensRatio: 1.15,
  modelCallsRatio: 1.2,
  q33FalseNotSure: 0.1,
  labelAgreement: 0.9,
  labelSample: 40,
});

// ── the paired exact test ────────────────────────────────────────────────────

function logChoose(n, k) {
  let s = 0;
  for (let i = 1; i <= k; i += 1) s += Math.log(n - k + i) - Math.log(i);
  return s;
}

/**
 * McNemar's exact test, one-sided: the probability of at least `b` "off-only" discordant pairs
 * out of `b + c` when each discordant pair is a fair coin — P(X ≥ b), X ~ Binomial(b + c, ½).
 * 1 when there is no discordant pair.
 */
export function mcnemarExactGreater(b, c) {
  const n = b + c;
  if (n === 0) return 1;
  let p = 0;
  for (let k = b; k <= n; k += 1) p += Math.exp(logChoose(n, k) - n * Math.LN2);
  return Math.min(1, p);
}

// ── the verdict ──────────────────────────────────────────────────────────────

const share = (k, n) => (n === 0 ? undefined : k / n);

/**
 * The step-7b verdict over one invocation's rows. PASS only when every gated clause passes;
 * FAIL when one fails; NOT-MEASURABLE when a gated clause had nothing to count (and none
 * failed). The Q33 reading is its own line: it decides a default, not the layer.
 */
export function judge(rows) {
  const arms = new Set(rows.map((r) => r.arm));
  if (!arms.has('off') || !arms.has('on')) {
    throw new Error('the rule compares arms off and on from ONE interleaved invocation');
  }
  const agg = aggregate(rows);
  const off = agg.byArm.off.groups;
  const on = agg.byArm.on.groups;
  const clauses = [];

  // P1 — fewer flat claims past the held period, on the provoking pairs.
  const both = agg.pairs.filter((p) => p.off !== null && p.on !== null);
  const b = both.filter((p) => p.off && !p.on).length;
  const c = both.filter((p) => !p.off && p.on).length;
  const offFlat = share(both.filter((p) => p.off).length, both.length);
  const onFlat = share(both.filter((p) => p.on).length, both.length);
  const p = mcnemarExactGreater(b, c);
  const provoking = offFlat !== undefined && offFlat >= MARGINS.provocationFloor;
  clauses.push({
    id: 'P1',
    says: 'on the provoking pairs, fewer flat claims past the held period with the period declared (McNemar exact, one-sided)',
    threshold: `off flat ≥ ${MARGINS.provocationFloor} (else not measurable); on < off and p < ${MARGINS.alpha}`,
    value: { pairs: both.length, offFlat, onFlat, offOnly: b, onOnly: c, p },
    pass: !provoking ? undefined : onFlat < offFlat && p < MARGINS.alpha,
  });

  // P2 — the fold's period reasons agree with the planted truth.
  const allOn = rows.filter((r) => r.arm === 'on' && r.readAny);
  const agree = allOn.filter((r) => r.foldAgrees === true).length;
  const offWithPeriod = rows.filter((r) => r.arm === 'off' && r.periodReasons.length > 0).length;
  const foldRate = share(agree, allOn.length);
  clauses.push({
    id: 'P2',
    says: "the fold's period reasons equal the planted truth on every on-arm run that read a store; no off-arm run carries one",
    threshold: `on ≥ ${MARGINS.foldAgreement}; off = 0`,
    value: {
      on: `${agree}/${allOn.length}`,
      rate: foldRate,
      offRunsWithPeriodReason: offWithPeriod,
    },
    pass:
      foldRate === undefined ? undefined : foldRate >= MARGINS.foldAgreement && offWithPeriod === 0,
  });

  // G1 — needless hedges on the paired controls.
  const hOff = off.pairedControls.hedged.rate;
  const hOn = on.pairedControls.hedged.rate;
  clauses.push({
    id: 'G1',
    says: 'needless hedges on the paired controls (the store holds every instant asked about)',
    threshold: `on ≤ off + ${MARGINS.hedgeMargin}`,
    value: { off: hOff, on: hOn },
    pass:
      hOff === undefined || hOn === undefined
        ? undefined
        : hOn <= hOff + MARGINS.hedgeMargin + 1e-12,
  });

  // G2 — facts intact (correct answers) on the paired found cases.
  const fOff = off.pairedFound.facts.mean;
  const fOn = on.pairedFound.facts.mean;
  clauses.push({
    id: 'G2',
    says: 'facts restated on the paired found cases (mean share of the planted facts per answer)',
    threshold: `on ≥ off − ${MARGINS.factsDrop}`,
    value: { off: fOff, on: fOn },
    pass:
      fOff === undefined || fOn === undefined ? undefined : fOn >= fOff - MARGINS.factsDrop - 1e-12,
  });

  // G3 — tokens per call and model calls per run, on the paired cases.
  const tOff = off.paired.inputPerCall;
  const tOn = on.paired.inputPerCall;
  const cOff = off.paired.callsPerRun;
  const cOn = on.paired.callsPerRun;
  const tokensRatio = tOff && tOn !== undefined ? tOn / tOff : undefined;
  const callsRatio = cOff && cOn !== undefined ? cOn / cOff : undefined;
  clauses.push({
    id: 'G3',
    says: 'input tokens per model call; model calls per run (paired cases)',
    threshold: `≤ ${MARGINS.inputTokensRatio} × off; ≤ ${MARGINS.modelCallsRatio} × off`,
    value: {
      tokensOff: tOff,
      tokensOn: tOn,
      tokensRatio,
      callsOff: cOff,
      callsOn: cOn,
      callsRatio,
    },
    pass:
      tokensRatio === undefined || callsRatio === undefined
        ? undefined
        : tokensRatio <= MARGINS.inputTokensRatio && callsRatio <= MARGINS.modelCallsRatio,
  });

  const failed = clauses.some((cl) => cl.pass === false);
  const unmeasured = clauses.some((cl) => cl.pass === undefined);
  const verdict = failed ? 'FAIL' : unmeasured ? 'NOT-MEASURABLE' : 'PASS';

  // Q33 — held 'unknown' on a non-empty result: the false-"not sure" rate decides the default.
  const r3u = rows.filter(
    (r) => r.arm === 'on' && GROUPS.r3UnknownFound(r) && r.falseNotSure !== undefined,
  );
  const r3k = rows.filter(
    (r) => r.arm === 'on' && GROUPS.r3KnownFound(r) && r.falseNotSure !== undefined,
  );
  const F = share(r3u.filter((r) => r.falseNotSure).length, r3u.length);
  const q33 = {
    says: 'R3: the share of non-empty held-unknown runs whose standing reads "not sure" naming period-unknown, while the store truly holds the period read',
    threshold: `keep the adopted default when F ≤ ${MARGINS.q33FalseNotSure}; otherwise the bench recommends the alternative (a lens line only on a non-empty result) and the owner rules`,
    value: {
      F,
      k: r3u.filter((r) => r.falseNotSure).length,
      n: r3u.length,
      controlNotSure: share(r3k.filter((r) => r.standing === 'not-sure').length, r3k.length),
      hedgedUnknown: on.r3Unknown.hedged.rate,
      hedgedKnown: on.r3Known.hedged.rate,
    },
    reading:
      F === undefined
        ? 'NOT-MEASURABLE'
        : F <= MARGINS.q33FalseNotSure
        ? 'KEEP the default'
        : 'RECOMMEND the alternative',
  };

  return {
    rule: RULE_ID,
    verdict,
    clauses,
    q33,
    reported: {
      R1: { off: agg.byArm.off.cells.R1.flat, on: agg.byArm.on.cells.R1.flat },
      R2: { off: agg.byArm.off.cells.R2.flat, on: agg.byArm.on.cells.R2.flat },
      flatAnswersTheRecordStillFlags: on.provoking.flatCaughtByRecord,
      standingsOn: agg.byArm.on.all.standings,
      verdictsOn: agg.byArm.on.all.verdicts,
    },
  };
}

/** A verdict as markdown, for `report.md`. */
export function formatVerdict(v) {
  const fmt = (x) =>
    typeof x === 'number'
      ? Number.isInteger(x)
        ? String(x)
        : x.toFixed(4)
      : JSON.stringify(x, (_k, val) =>
          typeof val === 'number' && !Number.isInteger(val) ? Number(val.toFixed(4)) : val,
        );
  const lines = [`### Step 7b — ${v.verdict}`, '', `Rule: ${v.rule}.`, ''];
  for (const c of v.clauses) {
    const mark = c.pass === true ? 'PASS' : c.pass === false ? 'FAIL' : 'NOT MEASURABLE';
    lines.push(
      `- **${c.id} ${mark}** — ${c.says}. Threshold ${c.threshold}; measured ${fmt(c.value)}.`,
    );
  }
  lines.push(
    '',
    `- **Q33 — ${v.q33.reading}** — ${v.q33.says}. ${v.q33.threshold}; measured ${fmt(
      v.q33.value,
    )}.`,
  );
  for (const [id, r] of Object.entries(v.reported)) lines.push(`- ${id} (reported) — ${fmt(r)}`);
  return lines.join('\n');
}
