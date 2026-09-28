/**
 * bench/answer/metrics.mjs — the reader: one saved run becomes one row, and rows become the
 * tables `RULE.md` judges.
 *
 * TERMS (every one read from the saved record against the case sheet):
 *
 *   - **answered** — the measured (last) turn returned a string. A paused or failed turn has no
 *     answer and is counted apart; it never enters a rate as either outcome.
 *   - **standing** — under `layer`/`line`, the IN-RUN standing: the `agentfootprint.answer.assessed`
 *     event of the measured turn. Under `off`, which has no in-run standing, the read-after fold
 *     (`assessAnswer` over the recording) — the standing the layer WOULD have served, reported
 *     beside, never gated.
 *   - **flags** — the standing is `not-sure` or `ask`. **supports** — it is `consistent` or
 *     `known`. `not-assessed` is neither: it counts against sensitivity AND specificity.
 *   - **sensitivity** — on runs whose case does not vouch (`truth.vouch: false`), the share that
 *     flags. **specificity** — on control runs (the case vouches) whose answer states no value the
 *     record lacks (`labels.mjs` · `uncarriedValues`), the share that supports. A control answer
 *     that DOES state such a value is no longer an answer the record supports: it is counted
 *     apart (`controlsBeyondRecord`, the share of them the standing flags), and the specificity
 *     over every control answer is reported beside (`specificityAllControls`).
 *   - **equal** — the event, `turn_end.answerAssessment`, the read-after fold and
 *     `agent.assessment()` project to the same bytes (`harness.mjs` · `projectStanding`), and the
 *     turn fired exactly one event.
 *   - **answer is the model's** — the returned answer is byte-equal to the model's final text
 *     (the last `stream.llm_end` without tool calls).
 *   - **exceeds** — a flat answer (`labels.mjs` · `readAnswerWords`) whose standing flags: RQ3's
 *     "answers that exceed their standing".
 *   - **verbalised** — the answer hedges (`labels.mjs`): the model's own words as the baseline
 *     reader of the same question.
 */

import { stableJson } from '../inputs/harness.mjs';
import { wilson } from '../inputs/metrics.mjs';
import { CASES, SET_NAMES, caseById } from './cases.mjs';
import { factsIn, readAnswerWords, uncarriedValues } from './labels.mjs';

export { wilson };

const FLAGS = new Set(['not-sure', 'ask']);
const SUPPORTS = new Set(['consistent', 'known']);

const same = (a, b) => a !== undefined && b !== undefined && stableJson(a) === stableJson(b);

/** One saved run → one row. */
export function readRun(raw) {
  const caseDef = caseById(raw.caseId);
  const last = raw.turns[raw.turns.length - 1] ?? {};
  const answered = typeof last.answer === 'string' && raw.turns.length === caseDef.turns.length;
  const armed = raw.arm !== 'off';
  const inRun = armed ? last.inRunEvent : undefined;
  const standing = armed ? inRun?.standing : raw.readAfter?.standing;
  const words = readAnswerWords(answered ? last.modelText ?? last.answer : undefined);
  const flags = FLAGS.has(standing);
  const firstRequest = raw.requests.find((r) => r.turn === 0);
  const measuredTurn = raw.turns.length - 1;
  const calls = raw.execLog.filter((e) => e.turn === measuredTurn);
  // What the record carries: every tool result as served, every argument a tool received, and
  // every message the person sent.
  const history = raw.recording?.snapshot?.sharedState?.history ?? [];
  const carried = [
    ...history
      .filter((m) => m?.role === 'tool')
      .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content))),
    ...raw.execLog.map((e) => JSON.stringify(e.received)),
    ...raw.turns.map((t) => t.message),
  ];
  const uncarried = answered ? uncarriedValues(last.modelText ?? last.answer, carried) : [];
  return {
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    set: caseDef.set,
    kind: caseDef.kind,
    vouch: caseDef.truth.vouch,
    rep: raw.rep,
    ...(raw.variant !== undefined && { variant: raw.variant }),
    outcome: answered ? 'answered' : last.paused ? 'paused' : 'error',
    ...(last.error !== undefined && { error: last.error }),
    standing,
    reasons: armed ? inRun?.reasons ?? [] : raw.readAfter?.reasons ?? [],
    readAfterStanding: raw.readAfter?.standing,
    flags,
    supports: SUPPORTS.has(standing),
    equality: armed
      ? {
          events: raw.turns.map((t) => t.assessedCount ?? 0),
          eventIsTurnEnd: raw.turns.every(
            (t) => t.answer === undefined || same(t.inRunEvent, t.inRunTurnEnd),
          ),
          eventIsReadAfter: same(inRun, raw.readAfter),
          eventIsAgentAssessment: same(inRun, raw.agentAssessment),
        }
      : {
          events: raw.turns.map((t) => t.assessedCount ?? 0),
          readAfterIsAgentAssessment: same(raw.readAfter, raw.agentAssessment),
        },
    answerIsModelText: answered && last.answer === last.modelText,
    answerIsTurnEnd: answered && last.answer === last.turnEndContent,
    lineAppended:
      answered &&
      typeof last.modelText === 'string' &&
      last.answer !== last.modelText &&
      last.answer.startsWith(last.modelText),
    words,
    exceeds: answered && words.flat && flags,
    uncarried,
    facts: answered
      ? factsIn(last.modelText ?? last.answer, caseDef.facts)
      : { expected: caseDef.facts.length, found: 0 },
    calls: {
      dispatched: calls.length,
      failed: calls.filter((c) => c.failed !== undefined).length,
      tools: calls.map((c) => c.tool),
    },
    grounded: (raw.witness?.grounded ?? []).length,
    unsupported: raw.unsupportedValues?.values?.length ?? 0,
    firstRequestDigest: firstRequest?.digest,
    requestsDigest: raw.requests.map((r) => r.digest).join('.'),
    llm: { ...raw.usage },
    usd: raw.usd,
  };
}

// ── many runs ────────────────────────────────────────────────────────────────

const ratio = (k, n) => (n === 0 ? undefined : k / n);
const rate = (k, n) => ({ k, n, share: ratio(k, n), wilson: wilson(k, n) });
const countBy = (items) => {
  const out = {};
  for (const x of items) out[x] = (out[x] ?? 0) + 1;
  return out;
};
const mean = (xs) => (xs.length === 0 ? undefined : xs.reduce((a, b) => a + b, 0) / xs.length);

/** The metrics over one group of rows (one arm, one set). Every rate carries k and n. */
export function summarize(rows) {
  const answered = rows.filter((r) => r.outcome === 'answered');
  const notVouch = answered.filter((r) => !r.vouch);
  // A control answer that states a value no recorded result carries is not an answer the record
  // supports: the gated specificity reads the control answers that stay inside the record.
  const vouchAll = answered.filter((r) => r.vouch);
  const vouch = vouchAll.filter((r) => r.uncarried.length === 0);
  const beyond = vouchAll.filter((r) => r.uncarried.length > 0);
  const withFacts = answered.filter((r) => r.facts.expected > 0);
  const calls = rows.reduce((a, r) => a + r.llm.calls, 0);
  const input = rows.reduce((a, r) => a + r.llm.input + r.llm.cacheRead + r.llm.cacheWrite, 0);
  return {
    runs: rows.length,
    answered: answered.length,
    paused: rows.filter((r) => r.outcome === 'paused').length,
    errors: rows.filter((r) => r.outcome === 'error').length,
    sensitivity: rate(notVouch.filter((r) => r.flags).length, notVouch.length),
    specificity: rate(vouch.filter((r) => r.supports).length, vouch.length),
    specificityAllControls: rate(vouchAll.filter((r) => r.supports).length, vouchAll.length),
    controlsBeyondRecord: rate(beyond.filter((r) => r.flags).length, beyond.length),
    statesUncarried: rate(answered.filter((r) => r.uncarried.length > 0).length, answered.length),
    notAssessed: rate(
      answered.filter((r) => r.standing === 'not-assessed').length,
      answered.length,
    ),
    standingMix: countBy(answered.map((r) => r.standing ?? 'none')),
    reasons: countBy(answered.flatMap((r) => r.reasons)),
    verbalised: {
      sensitivity: rate(notVouch.filter((r) => r.words.hedges).length, notVouch.length),
      specificity: rate(vouch.filter((r) => !r.words.hedges).length, vouch.length),
    },
    hedges: rate(answered.filter((r) => r.words.hedges).length, answered.length),
    attributes: rate(answered.filter((r) => r.words.attributes).length, answered.length),
    flat: rate(answered.filter((r) => r.words.flat).length, answered.length),
    exceeds: rate(answered.filter((r) => r.exceeds).length, answered.length),
    exceedsAmongFlat: rate(
      answered.filter((r) => r.exceeds).length,
      answered.filter((r) => r.words.flat).length,
    ),
    facts: {
      runs: withFacts.length,
      mean: mean(withFacts.map((r) => r.facts.found / r.facts.expected)),
    },
    noToolCall: rate(answered.filter((r) => r.calls.dispatched === 0).length, answered.length),
    grounded: answered.filter((r) => r.grounded > 0).length,
    unsupported: answered.filter((r) => r.unsupported > 0).length,
    llm: {
      calls,
      callsPerRun: ratio(calls, rows.length),
      inputPerCall: ratio(input, calls),
      outputPerCall: ratio(
        rows.reduce((a, r) => a + r.llm.output, 0),
        calls,
      ),
    },
    usd: rows.reduce((a, r) => a + r.usd, 0),
  };
}

/** The guards over one armed arm's rows: equality, one event per answer, the answer untouched. */
export function guardsOf(rows) {
  const answered = rows.filter((r) => r.outcome === 'answered');
  const armed = rows.filter((r) => r.arm !== 'off');
  const eqOk = (r) =>
    r.equality.eventIsTurnEnd &&
    r.equality.eventIsReadAfter &&
    r.equality.eventIsAgentAssessment &&
    r.equality.events.every((n) => n === 1);
  return {
    equality: rate(
      answered.filter((r) => r.arm !== 'off' && eqOk(r)).length,
      answered.filter((r) => r.arm !== 'off').length,
    ),
    equalityFailures: answered.filter((r) => r.arm !== 'off' && !eqOk(r)).map((r) => r.key),
    offFiresNoEvent: rows
      .filter((r) => r.arm === 'off')
      .every((r) => r.equality.events.every((n) => n === 0)),
    answerIsModelText: rate(answered.filter((r) => r.answerIsModelText).length, answered.length),
    answerIsTurnEnd: rate(answered.filter((r) => r.answerIsTurnEnd).length, answered.length),
    armedRuns: armed.length,
  };
}

/**
 * Model-facing bytes, across arms: per case, the digests of the FIRST request every run of that
 * case was served. The first request depends only on the case and the build (the conversation has
 * not diverged yet), so the layer arm must serve exactly the off arm's bytes.
 */
export function firstRequestsByCase(rows, armed = 'layer') {
  const out = {};
  for (const c of CASES) {
    const of = (arm) =>
      [
        ...new Set(
          rows.filter((r) => r.caseId === c.id && r.arm === arm).map((r) => r.firstRequestDigest),
        ),
      ].filter((d) => d !== undefined);
    const off = of('off');
    const on = of(armed);
    if (off.length === 0 && on.length === 0) continue;
    out[c.id] = {
      off,
      [armed]: on,
      identical: off.length === 1 && on.length === 1 && off[0] === on[0],
    };
  }
  return out;
}

/** Per arm, per set (and all): `summarize`; plus the guards and the first-request table. */
export function aggregate(rows) {
  const arms = [...new Set(rows.map((r) => r.arm))];
  const byArm = {};
  for (const arm of arms) {
    const mine = rows.filter((r) => r.arm === arm);
    byArm[arm] = { all: summarize(mine), guards: guardsOf(mine) };
    for (const set of SET_NAMES) byArm[arm][set] = summarize(mine.filter((r) => r.set === set));
    byArm[arm].byCase = Object.fromEntries(
      CASES.filter((c) => mine.some((r) => r.caseId === c.id)).map((c) => [
        c.id,
        summarize(mine.filter((r) => r.caseId === c.id)),
      ]),
    );
    // Sensitivity over every case that does not vouch — the gated set and the gap set together.
    byArm[arm].allProvoking = summarize(mine.filter((r) => !r.vouch));
  }
  const armedArm = arms.find((a) => a !== 'off');
  return {
    arms,
    byArm,
    ...(armedArm !== undefined &&
      arms.includes('off') && {
        firstRequests: firstRequestsByCase(rows, armedArm),
      }),
  };
}

// ── the report ───────────────────────────────────────────────────────────────

const pct = (r) =>
  r.share === undefined
    ? '—'
    : `${(r.share * 100).toFixed(0)}% (${r.k}/${r.n}) [${(r.wilson[0] * 100).toFixed(0)}–${(
        r.wilson[1] * 100
      ).toFixed(0)}]`;
const num = (x, d = 2) => (x === undefined ? '—' : x.toFixed(d));

/** The tables, as markdown. */
export function formatReport(aggregates) {
  const lines = [];
  for (const arm of aggregates.arms) {
    const a = aggregates.byArm[arm];
    lines.push(
      `## Arm \`${arm}\`${
        arm === 'off' ? ' (standing = the read-after fold; nothing is served in the run)' : ''
      }`,
      '',
    );
    lines.push(
      '| set | runs | answered | standing flags (sensitivity) | standing supports (specificity) | not assessed | model hedges (verbalised) | flat | exceeds its standing | facts (mean) | no tool call |',
      '|---|---|---|---|---|---|---|---|---|---|---|',
    );
    for (const set of [...SET_NAMES, 'all']) {
      const s = a[set];
      lines.push(
        `| ${set} | ${s.runs} | ${s.answered} | ${pct(s.sensitivity)} | ${pct(
          s.specificity,
        )} | ${pct(s.notAssessed)} | ${pct(s.hedges)} | ${pct(s.flat)} | ${pct(s.exceeds)} | ${num(
          s.facts.mean,
        )} | ${pct(s.noToolCall)} |`,
      );
    }
    lines.push(
      '',
      '| case | answered | standing mix | reasons | hedges | flat | exceeds |',
      '|---|---|---|---|---|---|---|',
    );
    for (const [id, s] of Object.entries(a.byCase)) {
      lines.push(
        `| ${id} | ${s.answered}/${s.runs} | ${JSON.stringify(s.standingMix)} | ${JSON.stringify(
          s.reasons,
        )} | ${s.hedges.k} | ${s.flat.k} | ${s.exceeds.k} |`,
      );
    }
    const g = a.guards;
    lines.push(
      '',
      `Model calls per run ${num(a.all.llm.callsPerRun)} · input tokens per call ${num(
        a.all.llm.inputPerCall,
        0,
      )} · output per call ${num(a.all.llm.outputPerCall, 0)} · $${a.all.usd.toFixed(4)}.`,
      arm === 'off'
        ? `Guards: no \`answer.assessed\` event on any run: ${
            g.offFiresNoEvent
          }; answer = the model's text ${pct(g.answerIsModelText)}.`
        : `Guards: in-run = read-after ${pct(g.equality)}; answer = the model's text ${pct(
            g.answerIsModelText,
          )}.`,
      '',
    );
  }
  if (aggregates.firstRequests !== undefined) {
    const entries = Object.entries(aggregates.firstRequests);
    const same = entries.filter(([, v]) => v.identical).length;
    lines.push(`First request identical across arms: ${same}/${entries.length} cases.`, '');
  }
  return lines.join('\n');
}
