/**
 * bench/inputs/rule.mjs — the registered success rule for honesty steps 3 and 4, as code.
 *
 * `RULE.md` is the authority; this file is its transcription, so a step's verdict is computed,
 * never argued. When the two disagree, `RULE.md` wins and this file is fixed first — before any
 * paid run reads it. Every threshold below is in `MARGINS`, registered with `RULE.md` on
 * 2026-09-27, before the first paid call of the inputs bench.
 *
 * Input: `metrics.mjs` · `aggregate(rows)` over ONE invocation that ran both arms interleaved
 * (the protocol's "same day, interleaved"). A verdict is never computed across invocations.
 */

import { wilson } from './metrics.mjs';

export const RULE_ID = 'inputs-rule-1 (registered 2026-09-27)';

/** Every number the rule compares against, in one place. */
export const MARGINS = Object.freeze({
  /** S3-1a — defaults nobody chose that the ledger admits (`source: 'default'`), under `assume`. */
  admittedShare: 0.95,
  /** S3-1b — P1 runs with a period call whose standing names an argument reason, under `assume`. */
  argumentReasonShare: 0.8,
  /** S3-2 — how far the person's-period share may fall on the stated set. */
  personDrop: 0.1,
  /** S3-3, S4-3 — how far mean facts-in-answer may fall. */
  factsDrop: 0.05,
  /** S3-4, S4-4 — the overhead ceilings (armed ÷ off). */
  inputTokensRatio: 1.15,
  modelCallsRatio: 1.2,
  /** S4-1 — the rise in P1 calls that ran with the value the person means. */
  meantGain: 0.3,
  /** S4-2 — the ceiling on stated-set runs the library asked about anyway. */
  needlessAskCeiling: 0.1,
  /** R3-b — the rise that allows the claim "the arm makes answers state their period". */
  windowClaimGain: 0.2,
  /** The one-sided Fisher exact test's level for a claimed rise. */
  alpha: 0.05,
  /** The hand-label bar for any claim resting on the window reader. */
  labelAgreement: 0.9,
  labelSample: 40,
});

// ── Fisher's exact test ─────────────────────────────────────────────────────

function logFactorials(n) {
  const out = new Float64Array(n + 1);
  for (let i = 2; i <= n; i += 1) out[i] = out[i - 1] + Math.log(i);
  return out;
}

/**
 * One-sided Fisher exact p-value that the SECOND proportion (k2 of n2) is higher than the
 * first (k1 of n1): the hypergeometric tail P(X ≥ k2) with the margins fixed.
 */
export function fisherGreater(k1, n1, k2, n2) {
  const N = n1 + n2;
  const K = k1 + k2;
  if (n1 === 0 || n2 === 0) return 1;
  const lf = logFactorials(N);
  const logChoose = (n, k) => lf[n] - lf[k] - lf[n - k];
  const denom = logChoose(N, n2);
  let p = 0;
  for (let x = k2; x <= Math.min(K, n2); x += 1) {
    if (K - x > n1) continue;
    p += Math.exp(logChoose(K, x) + logChoose(N - K, n2 - x) - denom);
  }
  return Math.min(1, p);
}

// ── clauses ─────────────────────────────────────────────────────────────────

const share = (k, n) => (n === 0 ? undefined : k / n);

/**
 * The hand labels clear the bar for a claim that rests on the window reader: at least
 * `labelSample` answers labelled (or every answer of a smaller sheet), and agreement at or above
 * `labelAgreement` (`labels.mjs` · `labelAgreement`).
 */
export function labelsClear(labels) {
  if (labels === undefined || labels.agreement === undefined) return false;
  const enough =
    labels.labelled >= MARGINS.labelSample || (labels.skipped === 0 && labels.labelled > 0);
  return enough && labels.agreement >= MARGINS.labelAgreement;
}

/** One gated clause: `pass` is `undefined` when its denominator is empty (not measurable). */
function clause(id, says, value, threshold, pass) {
  return { id, says, value, threshold, pass };
}

function armsOf(aggregates, armed) {
  const off = aggregates.off;
  const on = aggregates[armed];
  if (off === undefined || on === undefined) {
    throw new Error(
      `the rule compares arms 'off' and '${armed}' from ONE interleaved invocation; ` +
        `this one ran: ${Object.keys(aggregates).join(', ') || 'nothing'}`,
    );
  }
  return { off: off.sets, on: on.sets };
}

/** The verdict over a set of clauses: FAIL on any failure, else NOT-MEASURABLE on any gap, else PASS. */
function verdictOf(clauses) {
  if (clauses.some((c) => c.pass === false)) return 'FAIL';
  if (clauses.some((c) => c.pass === undefined)) return 'NOT-MEASURABLE';
  return 'PASS';
}

/** The shared non-inferiority clauses (facts; overhead). */
function commonClauses(prefix, off, on) {
  const out = [];
  const factsOff = off.all.facts.mean;
  const factsOn = on.all.facts.mean;
  out.push(
    clause(
      `${prefix}-3`,
      'facts in the answer do not fall by more than the margin',
      { off: factsOff, armed: factsOn },
      `armed ≥ off − ${MARGINS.factsDrop}`,
      factsOff === undefined || factsOn === undefined
        ? undefined
        : factsOn >= factsOff - MARGINS.factsDrop,
    ),
  );
  const inOff = off.all.llm.inputPerCall;
  const inOn = on.all.llm.inputPerCall;
  const callsOff = off.all.llm.callsPerRun;
  const callsOn = on.all.llm.callsPerRun;
  out.push(
    clause(
      `${prefix}-4`,
      'input tokens per model call and model calls per run stay under their ceilings',
      { inputPerCall: { off: inOff, armed: inOn }, callsPerRun: { off: callsOff, armed: callsOn } },
      `input ≤ ${MARGINS.inputTokensRatio} × off; calls ≤ ${MARGINS.modelCallsRatio} × off`,
      inOff === undefined || inOn === undefined || callsOff === undefined || callsOn === undefined
        ? undefined
        : inOn <= MARGINS.inputTokensRatio * inOff && callsOn <= MARGINS.modelCallsRatio * callsOff,
    ),
  );
  return out;
}

/** What the unarmed arm shows on P1 — reported beside every verdict (the provocation). */
export function provocation(aggregates) {
  const u = aggregates.off?.sets.unstated;
  if (u === undefined) return undefined;
  const k = u.classes['default-unchosen'];
  return {
    periodCalls: u.periodCalls,
    defaultUnchosen: k,
    rate: share(k, u.periodCalls),
    wilson95: wilson(k, u.periodCalls),
    modelChosen: u.classes['model-chosen'],
    noPeriodCallRuns: u.noPeriodCall.runs,
    of: u.noPeriodCall.of,
  };
}

/**
 * Step 3 (`assume`) — RULE.md § "Step 3". Gated: S3-1a, S3-1b (the gain, on the record), S3-2
 * (the person's stated periods), S3-3 (facts), S3-4 (overhead). Reported: R3-a (left out vs
 * sent), R3-b (answers stating their period, with the claim test).
 */
export function judgeStep3(aggregates, labels) {
  const { off, on } = armsOf(aggregates, 'assume');
  const clauses = [];
  const du = on.unstated.classes['default-unchosen'];
  const admitted = on.unstated.argumentRows.admittedDefaults;
  clauses.push(
    clause(
      'S3-1a',
      'P1 calls that ran on a default nobody chose carry a `default` row',
      { admitted, of: du, share: share(admitted, du) },
      `≥ ${MARGINS.admittedShare}`,
      du === 0 ? undefined : admitted / du >= MARGINS.admittedShare,
    ),
  );
  const runs = on.unstated.periodRuns;
  const named = on.unstated.argumentReasonRuns;
  clauses.push(
    clause(
      'S3-1b',
      "P1 runs with a period call fold to a standing that names the argument (an 'argument-' reason)",
      { named, of: runs, share: share(named, runs), off: off.unstated.argumentReasonRuns },
      `≥ ${MARGINS.argumentReasonShare}`,
      runs === 0 ? undefined : named / runs >= MARGINS.argumentReasonShare,
    ),
  );
  const pOff = off.stated.rates.person;
  const pOn = on.stated.rates.person;
  clauses.push(
    clause(
      'S3-2',
      "on the stated set, the share of period calls that ran with the person's period does not fall by more than the margin",
      {
        off: pOff,
        armed: pOn,
        wilsonOff: wilson(off.stated.classes.person, off.stated.periodCalls),
        wilsonArmed: wilson(on.stated.classes.person, on.stated.periodCalls),
      },
      `armed ≥ off − ${MARGINS.personDrop}`,
      pOff === undefined || pOn === undefined ? undefined : pOn >= pOff - MARGINS.personDrop,
    ),
  );
  clauses.push(...commonClauses('S3', off, on));

  const wOff = off.unstated.window;
  const wOn = on.unstated.window;
  const rise = share(wOn.statesRan, wOn.of) - share(wOff.statesRan, wOff.of);
  const p = fisherGreater(wOff.statesRan, wOff.of, wOn.statesRan, wOn.of);
  return {
    step: 3,
    rule: RULE_ID,
    verdict: verdictOf(clauses),
    clauses,
    provocation: provocation(aggregates),
    reported: {
      'R3-a': {
        says: 'defaults nobody chose, split by how they got there (left out → filled; sent by the model)',
        off: off.unstated.defaultUnchosenBy,
        armed: on.unstated.defaultUnchosenBy,
      },
      'R3-b': {
        says: 'P1 answers that state the period their calls ran with',
        off: wOff,
        armed: wOn,
        rise: Number.isNaN(rise) ? undefined : rise,
        fisherP: p,
        claimAllowed:
          !Number.isNaN(rise) &&
          rise >= MARGINS.windowClaimGain &&
          p < MARGINS.alpha &&
          labelsClear(labels),
        labels:
          labels === undefined ? 'not yet labelled — any claim waits for the hand labels' : labels,
      },
    },
  };
}

/**
 * Step 4 (`ask`) — RULE.md § "Step 4". Gated: S4-1 (the person's period runs), S4-2 (needless
 * asks), S4-3 (facts), S4-4 (overhead). Reported: the ask rate on P1.
 */
export function judgeStep4(aggregates) {
  const { off, on } = armsOf(aggregates, 'ask');
  const clauses = [];
  const mOff = off.unstated.meant;
  const mOn = on.unstated.meant;
  const rise = share(mOn.meant, mOn.of) - share(mOff.meant, mOff.of);
  const p = fisherGreater(mOff.meant, mOff.of, mOn.meant, mOn.of);
  clauses.push(
    clause(
      'S4-1',
      'P1 calls that ran with the period the person means rise by the margin, and the rise is not chance',
      { off: mOff, armed: mOn, rise: Number.isNaN(rise) ? undefined : rise, fisherP: p },
      `rise ≥ ${MARGINS.meantGain} and one-sided Fisher p < ${MARGINS.alpha}`,
      mOff.of === 0 || mOn.of === 0 ? undefined : rise >= MARGINS.meantGain && p < MARGINS.alpha,
    ),
  );
  const asked = on.stated.askedRuns;
  const of = on.stated.runs;
  clauses.push(
    clause(
      'S4-2',
      'on the stated set, runs in which the library asked for a period the person had given stay under the ceiling',
      { asked, of, share: share(asked, of), off: off.stated.askedRuns },
      `≤ ${MARGINS.needlessAskCeiling}`,
      of === 0 ? undefined : asked / of <= MARGINS.needlessAskCeiling,
    ),
  );
  clauses.push(...commonClauses('S4', off, on));
  return {
    step: 4,
    rule: RULE_ID,
    verdict: verdictOf(clauses),
    clauses,
    provocation: provocation(aggregates),
    reported: {
      'R4-a': {
        says: 'P1 runs in which the library asked',
        off: { asked: off.unstated.askedRuns, of: off.unstated.runs },
        armed: { asked: on.unstated.askedRuns, of: on.unstated.runs },
      },
    },
  };
}

/** A verdict as markdown lines, for `report.md`. */
export function formatVerdict(v) {
  const fmt = (x) =>
    typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(3)) : JSON.stringify(x);
  const lines = [`### Step ${v.step} — ${v.verdict}`, '', `Rule: ${v.rule}.`, ''];
  for (const c of v.clauses) {
    const mark = c.pass === true ? 'PASS' : c.pass === false ? 'FAIL' : 'NOT MEASURABLE';
    lines.push(
      `- **${c.id} ${mark}** — ${c.says}. Threshold ${c.threshold}; measured ${fmt(c.value)}.`,
    );
  }
  if (v.provocation !== undefined) {
    lines.push('', `Provocation (off, P1): ${fmt(v.provocation)}.`);
  }
  for (const [id, r] of Object.entries(v.reported)) lines.push(`- ${id} (reported) — ${fmt(r)}`);
  return lines.join('\n');
}
