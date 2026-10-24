/**
 * PR6 normalized input contract (one row per expected scored reply):
 * {id,caseId,model,cell,arm,pairId,labelsComplete:boolean,ownerPending:boolean,
 *  citations:[{valid,correct,trueZero,held,stageId?}],
 *  negativeRequired:boolean,fieldPresent:boolean,
 *  contradictionEligible:boolean,missedContradiction:boolean,
 *  rewordingEligible:boolean,reworded:boolean,
 *  detector:[{positive:boolean,detected:boolean}],
 *  nearMatch?:{substitution,flat,ask,notFound}, usefulness:1..5,tokens,latencyMs}.
 * Every metric flag is a boolean from adjudicated labels/runtime facts; missing
 * values are unknown, never false. One disputed/missing row prevents a pass.
 * `off` rows are the actual delivered baseline, paired by model + pairId, even
 * when collected in a differently named cell. Tokens/latency include correction.
 *
 * Observation rates (citations/sentences), reply rates, and case intervals are
 * DIFFERENT estimands. An error case has ANY eligible error across its repeats;
 * a successful case has ALL eligible observations succeed. CP uses those actual
 * integer case outcomes, never a rounded reply rate. Its interval describes the
 * probability of the registered CASE event, not a per-reply probability.
 */
import { clopperPearson as exactInterval } from '../measure.mjs';

export const CASE_RULE = 'any eligible error fails the case; repetitions are not independent cases';
export const GATES = Object.freeze({
  falseHold: { direction: 'max', point: 0.02, bound: 0.1, cases: 8, replies: 80 },
  citationValidity: { direction: 'min', point: 0.9, bound: 0.8, cases: 1, replies: 1 },
  citationCorrectness: { direction: 'min', point: 0.85, bound: 0.75, cases: 1, replies: 1 },
  missedContradiction: { direction: 'max', point: 0.02, bound: 0.1, cases: 1, replies: 1 },
  fieldDrop: { direction: 'max', point: 0.1, cases: 1, replies: 1 },
  rewording: { direction: 'max', point: 0.05, cases: 1, replies: 1 },
  sensitivity: { direction: 'min', point: 0.85, bound: 0.7, cases: 5, replies: 30 },
  specificity: { direction: 'min', point: 0.95, bound: 0.85, cases: 6, replies: 30 },
  substitution: { direction: 'max', point: 0.05, bound: 0.15, cases: 6, replies: 60 },
});

export function clopperPearson(successes, trials) {
  if (
    !Number.isSafeInteger(successes) ||
    !Number.isSafeInteger(trials) ||
    successes < 0 ||
    trials < successes
  )
    throw new TypeError('CP requires integer case outcomes');
  return trials === 0 ? [null, null] : exactInterval(successes, trials);
}

/** entries: {caseId, replyId, value:boolean}; direction says whether true is good. */
export function caseMetric(entries, direction) {
  if (!['min', 'max'].includes(direction)) throw new TypeError('metric direction required');
  const cases = new Map(),
    replies = new Map();
  for (const item of entries) {
    if (
      typeof item.caseId !== 'string' ||
      !item.caseId ||
      typeof item.replyId !== 'string' ||
      !item.replyId ||
      typeof item.value !== 'boolean'
    )
      throw new TypeError('invalid metric observation');
    const reply = replies.get(item.replyId);
    if (reply && reply.caseId !== item.caseId)
      throw new TypeError('reply cannot belong to two cases');
    replies.set(item.replyId, {
      caseId: item.caseId,
      values: [...(reply?.values ?? []), item.value],
    });
    cases.set(item.caseId, [...(cases.get(item.caseId) ?? []), item.value]);
  }
  const event = (values) => (direction === 'min' ? values.every(Boolean) : values.some(Boolean));
  const rate = (values) => {
    const num = values.filter(Boolean).length,
      den = values.length;
    return { num, den, point: den ? num / den : null };
  };
  const c = rate([...cases.values()].map(event));
  const [low, high] = clopperPearson(c.num, c.den);
  return {
    observations: rate(entries.map((x) => x.value)),
    replies: rate([...replies.values()].map((x) => event(x.values))),
    cases: { ...c, low, high },
    caseRule: CASE_RULE,
  };
}

const passes = (value, threshold, direction) =>
  direction === 'min' ? value + 1e-12 >= threshold : value - 1e-12 <= threshold;

/** The point gate is the observation rate; the bound is explicitly the CASE rate. */
export function evaluateGate(metric, rule) {
  if (metric.cases.den < rule.cases || metric.replies.den < rule.replies)
    return { status: 'below-floor', requiredCases: rule.cases, requiredReplies: rule.replies };
  if (rule.bound !== undefined) {
    const best = clopperPearson(rule.direction === 'min' ? metric.cases.den : 0, metric.cases.den);
    const bestBound = rule.direction === 'min' ? best[0] : best[1];
    if (!passes(bestBound, rule.bound, rule.direction))
      return {
        status: 'insufficient-independent-cases',
        bestPossibleBound: bestBound,
        threshold: rule.bound,
      };
  }
  const pointOK = passes(metric.observations.point, rule.point, rule.direction);
  const bound = rule.direction === 'min' ? metric.cases.low : metric.cases.high;
  const boundOK = rule.bound === undefined || passes(bound, rule.bound, rule.direction);
  return { status: pointOK && boundOK ? 'pass' : 'fail', pointOK, boundOK };
}

const boolean = (x) => typeof x === 'boolean';
const positiveNumber = (x) => typeof x === 'number' && Number.isFinite(x) && x > 0;
function rowProblems(row) {
  const problems = [];
  for (const key of ['id', 'caseId', 'model', 'cell', 'arm', 'pairId'])
    if (typeof row?.[key] !== 'string' || !row[key]) problems.push(`${key} missing`);
  if (row?.labelsComplete !== true) problems.push('missing-labels');
  if (row?.ownerPending !== false) problems.push('pending-owner-adjudication');
  for (const key of [
    'negativeRequired',
    'fieldPresent',
    'contradictionEligible',
    'missedContradiction',
    'rewordingEligible',
    'reworded',
  ])
    if (!boolean(row?.[key])) problems.push(`${key} unknown`);
  if (
    !Array.isArray(row?.citations) ||
    row.citations.some(
      (c) =>
        !c ||
        !['valid', 'correct', 'trueZero', 'held'].every((k) => boolean(c[k])) ||
        (c.correct && !c.valid),
    )
  )
    problems.push('citation labels incomplete/inconsistent');
  if (
    !Array.isArray(row?.detector) ||
    row.detector.some((d) => !d || !boolean(d.positive) || !boolean(d.detected))
  )
    problems.push('detector labels incomplete');
  if (
    row?.nearMatch !== undefined &&
    (!row.nearMatch ||
      !['substitution', 'flat', 'ask', 'notFound'].every((k) => boolean(row.nearMatch[k])))
  )
    problems.push('near-match labels incomplete');
  if (!Number.isInteger(row?.usefulness) || row.usefulness < 1 || row.usefulness > 5)
    problems.push('usefulness missing');
  if (!Number.isSafeInteger(row?.tokens) || row.tokens < 0) problems.push('tokens missing');
  if (!positiveNumber(row?.latencyMs)) problems.push('latency missing');
  return problems;
}

function metricsFor(rows) {
  const observations = Object.fromEntries(Object.keys(GATES).map((k) => [k, []]));
  for (const name of ['nearFlat', 'nearAsk', 'nearNotFound']) observations[name] = [];
  for (const row of rows) {
    const put = (name, value) =>
      observations[name].push({ caseId: row.caseId, replyId: row.id, value });
    for (const c of row.citations) {
      put('citationValidity', c.valid);
      put('citationCorrectness', c.correct);
      // These populations are disjoint: a wrong citation is NEVER a false hold.
      if (c.trueZero && c.correct) put('falseHold', c.held);
    }
    if (row.negativeRequired) put('fieldDrop', !row.fieldPresent);
    if (row.contradictionEligible) put('missedContradiction', row.missedContradiction);
    if (row.rewordingEligible) put('rewording', row.reworded);
    for (const d of row.detector)
      put(d.positive ? 'sensitivity' : 'specificity', d.positive ? d.detected : !d.detected);
    if (row.nearMatch) {
      put('substitution', row.nearMatch.substitution);
      put('nearFlat', row.nearMatch.flat);
      put('nearAsk', row.nearMatch.ask);
      put('nearNotFound', row.nearMatch.notFound);
    }
  }
  return Object.fromEntries(
    Object.entries(observations).map(([name, entries]) => [
      name,
      caseMetric(entries, GATES[name]?.direction ?? 'max'),
    ]),
  );
}

function nearMatchComparison(rows, allRows, baselineArm) {
  if (!rows.every((r) => r.nearMatch)) return { status: 'not-applicable' };
  if (rows[0].arm === baselineArm) return { status: 'baseline' };
  const pairs = rows.map((r) => ({
    row: r,
    matches: allRows.filter(
      (b) => b.model === r.model && b.pairId === r.pairId && b.arm === baselineArm && b.nearMatch,
    ),
  }));
  if (pairs.some((p) => p.matches.length !== 1 || p.matches[0].caseId !== p.row.caseId))
    return { status: 'missing-or-ambiguous-baseline' };
  const flatDifference =
    pairs.reduce(
      (n, p) => n + Number(p.row.nearMatch.flat) - Number(p.matches[0].nearMatch.flat),
      0,
    ) / pairs.length;
  return {
    status: 'measured',
    pairs: pairs.length,
    flatDifference,
    noFlatIncrease: flatDifference <= 0 ? 'pass' : 'fail',
  };
}

function comparisons(rows, allRows, baselineArm) {
  if (rows[0]?.arm === baselineArm) return { status: 'baseline' };
  const paired = rows.map((row) => ({
    row,
    candidates: allRows.filter(
      (other) =>
        other.model === row.model && other.pairId === row.pairId && other.arm === baselineArm,
    ),
  }));
  if (paired.length === 0 || paired.some((p) => p.candidates.length !== 1))
    return { status: 'missing-or-ambiguous-baseline' };
  if (paired.some((p) => p.candidates[0].caseId !== p.row.caseId))
    return { status: 'baseline-case-mismatch' };
  const sum = (key, baseline) =>
    paired.reduce((n, p) => n + (baseline ? p.candidates[0] : p.row)[key], 0);
  const usefulnessDifference = (sum('usefulness', false) - sum('usefulness', true)) / paired.length;
  const baselineTokens = sum('tokens', true),
    baselineLatency = sum('latencyMs', true);
  const tokenRatio = baselineTokens > 0 ? sum('tokens', false) / baselineTokens : null;
  const latencyRatio = baselineLatency > 0 ? sum('latencyMs', false) / baselineLatency : null;
  return {
    status: tokenRatio === null || latencyRatio === null ? 'unmeasured' : 'measured',
    pairs: paired.length,
    usefulnessDifference,
    tokenRatio,
    latencyRatio,
    usefulness: usefulnessDifference >= -0.3 - 1e-12 ? 'pass' : 'fail',
    tokens: tokenRatio === null ? 'unmeasured' : tokenRatio <= 1.15 + 1e-12 ? 'pass' : 'fail',
    latency: latencyRatio === null ? 'unmeasured' : latencyRatio <= 1.3 + 1e-12 ? 'pass' : 'fail',
  };
}

/**
 * Expected IDs must come from the frozen manifest, NOT the rows that happened to
 * complete. No missing run/label/owner decision or failed mock suite can pass.
 */
export function scoreRows(
  rows,
  {
    expectedReplyIds,
    scriptedPassed = false,
    baselineArm = 'off',
    nearMatchBaselineArm = 'count',
  } = {},
) {
  if (!Array.isArray(rows)) throw new TypeError('normalized rows required');
  const problems = [],
    seen = new Set(),
    completeRows = [];
  if (
    !Array.isArray(expectedReplyIds) ||
    expectedReplyIds.length === 0 ||
    expectedReplyIds.some((id) => typeof id !== 'string' || !id) ||
    new Set(expectedReplyIds).size !== expectedReplyIds.length
  )
    problems.push({ reason: 'complete frozen expectedReplyIds required' });
  const expected = new Set(Array.isArray(expectedReplyIds) ? expectedReplyIds : []);
  for (const row of rows) {
    if (seen.has(row?.id)) throw new TypeError('duplicate scored reply id');
    seen.add(row?.id);
    if (!expected.has(row?.id)) problems.push({ id: row?.id, reason: 'unexpected reply' });
    const errors = rowProblems(row);
    if (errors.length) problems.push({ id: row?.id, reason: 'incomplete reply', errors });
    else completeRows.push(row);
  }
  for (const id of expected) if (!seen.has(id)) problems.push({ id, reason: 'missing reply' });
  if (scriptedPassed !== true)
    problems.push({ reason: 'scripted zero-tolerance suite not passed' });
  const complete = problems.length === 0;
  const groups = new Map();
  for (const row of completeRows) {
    const key = JSON.stringify([row.model, row.cell, row.arm]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  return {
    complete,
    problems,
    expectedReplies: expected.size,
    receivedReplies: rows.length,
    scoredReplies: completeRows.length,
    caseRule: CASE_RULE,
    groups: [...groups.values()].map((group) => {
      const metrics = metricsFor(group);
      // Every draft/correction citation remains in the aggregate, with a separate
      // stage view so repair cannot hide an initial correct citation it dropped.
      const stageIds = [
        ...new Set(group.flatMap((r) => r.citations.map((c) => c.stageId ?? 'final'))),
      ];
      const citationStages = Object.fromEntries(
        stageIds.map((stageId) => {
          const stage = metricsFor(
            group.map((r) => ({
              ...r,
              citations: r.citations.filter((c) => (c.stageId ?? 'final') === stageId),
            })),
          );
          return [
            stageId,
            {
              citationValidity: stage.citationValidity,
              citationCorrectness: stage.citationCorrectness,
              falseHold: stage.falseHold,
            },
          ];
        }),
      );
      const gates = Object.fromEntries(
        Object.entries(GATES).map(([name, rule]) => {
          const metric = metrics[name];
          const result = evaluateGate(metric, rule);
          return [
            name,
            complete
              ? result
              : { ...result, statisticalStatus: result.status, status: 'incomplete' },
          ];
        }),
      );
      const comparison = comparisons(group, completeRows, baselineArm);
      const nearComparison = nearMatchComparison(group, completeRows, nearMatchBaselineArm);
      const typed = [
        'falseHold',
        'citationValidity',
        'citationCorrectness',
        'missedContradiction',
        'fieldDrop',
      ];
      return {
        model: group[0].model,
        cell: group[0].cell,
        arm: group[0].arm,
        replies: group.length,
        metrics,
        citationStages,
        gates,
        comparison,
        nearMatchComparison: nearComparison,
        namesMayShip:
          complete &&
          gates.substitution.status === 'pass' &&
          nearComparison.noFlatIncrease === 'pass',
        typedRecommended:
          complete &&
          typed.every((k) => gates[k].status === 'pass') &&
          ['usefulness', 'tokens', 'latency'].every((k) => comparison[k] === 'pass'),
        proseGatesPass:
          complete && ['sensitivity', 'specificity'].every((k) => gates[k].status === 'pass'),
        strictProseGatesPass:
          complete &&
          ['sensitivity', 'specificity', 'rewording'].every((k) => gates[k].status === 'pass'),
      };
    }),
  };
}
