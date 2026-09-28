/**
 * bench/answer/rule.mjs — `RULE.md` as code: the step-6 verdict, computed and never argued.
 *
 * Where this file and `RULE.md` disagree, the page wins and this file is fixed before any paid
 * run reads it. `test/bench/answer/rule.test.ts` fails if `MARGINS` drifts from the page's table.
 */

export const RULE_ID = 'answer-rule-step6';

/** The registered numbers (`RULE.md`, "Margins"). */
export const MARGINS = Object.freeze({
  sensitivity: 0.8,
  specificity: 0.9,
  minRuns: 20,
  equality: 1,
  answerBytes: 1,
  factsDrop: 0.05,
  hedgeRise: 0.1,
  askRise: 0.1,
  inputTokensRatio: 1.1,
  modelCallsRatio: 1.15,
});

const PASS = 'PASS';
const FAIL = 'FAIL';
const NOT_MEASURABLE = 'NOT-MEASURABLE';

/** The verdict over clauses: any FAIL fails; else any NOT-MEASURABLE; else PASS. */
export function verdictOf(clauses) {
  const results = Object.values(clauses).map((c) => c.result);
  if (results.includes(FAIL)) return FAIL;
  if (results.includes(NOT_MEASURABLE)) return NOT_MEASURABLE;
  return PASS;
}

const atLeast = (value, threshold, n, minN = 1) =>
  n < minN || value === undefined ? NOT_MEASURABLE : value >= threshold ? PASS : FAIL;
const atMost = (value, threshold, n, minN = 1) =>
  n < minN || value === undefined ? NOT_MEASURABLE : value <= threshold ? PASS : FAIL;

/** Share of runs in `summary` that paused (the layer never asks; a pause is a tool's). */
const pausedShare = (s) => (s.runs === 0 ? undefined : s.paused / s.runs);

/**
 * The step-6 verdict: arm `off` against arm `layer` from ONE interleaved invocation's
 * aggregates (`metrics.mjs` · `aggregate`).
 */
export function judgeStep6(aggregates) {
  const off = aggregates.byArm.off;
  const on = aggregates.byArm.layer;
  if (off === undefined || on === undefined) {
    throw new Error(
      'judgeStep6 compares arms off and layer from one invocation: both must be present',
    );
  }
  const clauses = {};

  const sens = on.provoking.sensitivity;
  clauses['A-1'] = {
    says: 'in-run standing flags (not sure / ask) the provoking answers',
    value: sens.share,
    k: sens.k,
    n: sens.n,
    threshold: `≥ ${MARGINS.sensitivity} (n ≥ ${MARGINS.minRuns})`,
    result: atLeast(sens.share, MARGINS.sensitivity, sens.n, MARGINS.minRuns),
  };

  const spec = on.control.specificity;
  clauses['A-2'] = {
    says: 'in-run standing supports (consistent / known) the control answers',
    value: spec.share,
    k: spec.k,
    n: spec.n,
    threshold: `≥ ${MARGINS.specificity} (n ≥ ${MARGINS.minRuns})`,
    result: atLeast(spec.share, MARGINS.specificity, spec.n, MARGINS.minRuns),
  };

  const eq = on.guards.equality;
  const offSilent = off.guards.offFiresNoEvent;
  clauses['A-3'] = {
    says: 'in-run == read-after on every answered layer run (event = turn_end = assessAnswer = agent.assessment(), one event per answer); off fires no event',
    value: eq.share,
    k: eq.k,
    n: eq.n,
    offFiresNoEvent: offSilent,
    failures: on.guards.equalityFailures,
    threshold: `= ${MARGINS.equality}, and off silent`,
    result: eq.n === 0 ? NOT_MEASURABLE : eq.share >= MARGINS.equality && offSilent ? PASS : FAIL,
  };

  const firsts = Object.entries(aggregates.firstRequests ?? {});
  const identical = firsts.filter(([, v]) => v.identical).length;
  clauses['A-4'] = {
    says: 'model-facing bytes: every case serves the same first request under off and layer',
    value: firsts.length === 0 ? undefined : identical / firsts.length,
    k: identical,
    n: firsts.length,
    differing: firsts.filter(([, v]) => !v.identical).map(([id]) => id),
    threshold: '= 1',
    result: firsts.length === 0 ? NOT_MEASURABLE : identical === firsts.length ? PASS : FAIL,
  };

  const bytes = on.guards.answerIsModelText;
  clauses['A-5'] = {
    says: "answer bytes: every answered layer run returns the model's final text, byte for byte",
    value: bytes.share,
    k: bytes.k,
    n: bytes.n,
    threshold: `= ${MARGINS.answerBytes}`,
    result: atLeast(bytes.share, MARGINS.answerBytes, bytes.n),
  };

  const fOff = off.control.facts;
  const fOn = on.control.facts;
  clauses['A-6'] = {
    says: 'correct answers: mean facts-in-answer on the controls does not fall',
    off: fOff.mean,
    layer: fOn.mean,
    threshold: `layer ≥ off − ${MARGINS.factsDrop}`,
    result:
      fOff.mean === undefined || fOn.mean === undefined
        ? NOT_MEASURABLE
        : fOn.mean >= fOff.mean - MARGINS.factsDrop
        ? PASS
        : FAIL,
  };

  const hOff = off.control.hedges.share;
  const hOn = on.control.hedges.share;
  const aOff = pausedShare(off.control);
  const aOn = pausedShare(on.control);
  const hedgeOk = hOff !== undefined && hOn !== undefined && hOn <= hOff + MARGINS.hedgeRise;
  const askOk = aOff !== undefined && aOn !== undefined && aOn <= aOff + MARGINS.askRise;
  clauses['A-7'] = {
    says: 'needless hedges and asks on the controls do not rise',
    hedges: { off: hOff, layer: hOn },
    asks: { off: aOff, layer: aOn },
    threshold: `hedges: layer ≤ off + ${MARGINS.hedgeRise}; asks: layer ≤ off + ${MARGINS.askRise}`,
    result:
      hOff === undefined || hOn === undefined || aOff === undefined || aOn === undefined
        ? NOT_MEASURABLE
        : hedgeOk && askOk
        ? PASS
        : FAIL,
  };

  const tOff = off.all.llm.inputPerCall;
  const tOn = on.all.llm.inputPerCall;
  const cOff = off.all.llm.callsPerRun;
  const cOn = on.all.llm.callsPerRun;
  clauses['A-8'] = {
    says: 'overhead: input tokens per model call, and model calls per run',
    inputPerCall: { off: tOff, layer: tOn, ratio: tOff ? tOn / tOff : undefined },
    callsPerRun: { off: cOff, layer: cOn, ratio: cOff ? cOn / cOff : undefined },
    threshold: `≤ ${MARGINS.inputTokensRatio} × off; ≤ ${MARGINS.modelCallsRatio} × off`,
    result:
      !tOff || !cOff || tOn === undefined || cOn === undefined
        ? NOT_MEASURABLE
        : tOn <= MARGINS.inputTokensRatio * tOff && cOn <= MARGINS.modelCallsRatio * cOff
        ? PASS
        : FAIL,
  };

  return {
    step: 6,
    rule: RULE_ID,
    verdict: verdictOf(clauses),
    clauses,
    reported: {
      'R-1 exceeds its standing': {
        layer: {
          provoking: on.provoking.exceeds,
          gap: on.gap.exceeds,
          control: on.control.exceeds,
        },
        off: {
          provoking: off.provoking.exceeds,
          gap: off.gap.exceeds,
          control: off.control.exceeds,
        },
        layerAmongFlat: on.allProvoking.exceedsAmongFlat,
      },
      'R-2 the model’s words as the reader (verbalised baseline, same runs)': {
        layer: {
          sensitivity: on.provoking.verbalised.sensitivity,
          specificity: on.control.verbalised.specificity,
        },
        off: {
          sensitivity: off.provoking.verbalised.sensitivity,
          specificity: off.control.verbalised.specificity,
        },
      },
      'R-3 every case that does not vouch (provoking + gap)': {
        layer: on.allProvoking.sensitivity,
        gap: on.gap.sensitivity,
      },
      'R-4 the off arm read after (what the layer would have served)': {
        sensitivity: off.provoking.sensitivity,
        specificity: off.control.specificity,
      },
      'R-5 standing mix and reasons (layer)': {
        mix: on.all.standingMix,
        reasons: on.all.reasons,
        notAssessed: on.all.notAssessed,
      },
      'R-6 grounded and unsupported (answered runs with any)': {
        layer: { grounded: on.all.grounded, unsupported: on.all.unsupported },
        off: { grounded: off.all.grounded, unsupported: off.all.unsupported },
      },
    },
  };
}

const show = (v) =>
  v === undefined ? '—' : typeof v === 'number' ? v.toFixed(3) : JSON.stringify(v);

/** The verdict as markdown. */
export function formatVerdict(v) {
  const lines = [
    '',
    `## Verdict — ${v.rule}: **${v.verdict}**`,
    '',
    '| clause | says | measured | threshold | result |',
    '|---|---|---|---|---|',
  ];
  for (const [id, c] of Object.entries(v.clauses)) {
    let measured;
    if (c.k !== undefined) measured = `${show(c.value)} (${c.k}/${c.n})`;
    else if (id === 'A-6') measured = `off ${show(c.off)} · layer ${show(c.layer)}`;
    else if (id === 'A-7')
      measured = `hedges off ${show(c.hedges.off)} · layer ${show(c.hedges.layer)}; asks off ${show(
        c.asks.off,
      )} · layer ${show(c.asks.layer)}`;
    else if (id === 'A-8')
      measured = `tokens/call ×${show(c.inputPerCall.ratio)} · calls/run ×${show(
        c.callsPerRun.ratio,
      )}`;
    lines.push(`| ${id} | ${c.says} | ${measured} | ${c.threshold} | ${c.result} |`);
  }
  lines.push(
    '',
    '### Reported, not gated',
    '',
    '```json',
    JSON.stringify(v.reported, null, 2),
    '```',
    '',
  );
  return lines.join('\n');
}
