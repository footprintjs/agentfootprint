/**
 * bench/inputs/metrics.mjs — the reader. Every number the inputs bench prints is computed here,
 * from what a run left behind (`harness.mjs` · `runCase`): the recording's committed history, the
 * tools' own execution log, the answer, the standing fold's verdict and the usage. Pure — no
 * model, no network, no library import — so a saved run can be re-read at any time (`run.mjs
 * --rescore`) and every rule in `RULE.md` is a function of these rows.
 *
 * THE CLASSES (one per call that ran and returned data, for the argument that sets its period):
 *
 *   person            the period the call ran with is one the person's words gave
 *   contradicts       the person gave a period and the call ran with another one
 *   default-unchosen  the person gave none and the call ran with the tool's own default —
 *                     "a default nobody chose" (split: `omitted` = the call left the argument
 *                     out and the default filled it; `sent` = the model sent the default itself)
 *   model-chosen      the person gave none and the call ran with a value the model picked
 *
 * "Ran with" is the tool's own record of the period it applied (`execLog[].effective`), never the
 * model's proposal: a default the tool applied, a value the library filled (step 3) and a value
 * the person answered (step 4) are read from the one place they all land.
 *
 * WHAT IS NOT READ HERE: meaning. A class says whose value ran, measured against the truth the
 * case sheet declared before any run; it never says whether the answer is right. The two text
 * readers — "does the answer state its period" and "does it restate the result's facts" — match
 * declared phrases as whole tokens, and their agreement with blind hand labels is measured
 * (`labelAgreement`) before any rule leans on them.
 */

import {
  DURATION,
  DURATION_PHRASES,
  caseById,
  factsFor,
  isStatedCase,
  statedValues,
  toolSpec,
} from './cases.mjs';

// ── tokens ───────────────────────────────────────────────────────────────────

/**
 * The bench's one tokenizer: lower case; a token is a run of letters and digits, keeping a
 * decimal point or thousands comma BETWEEN digits (`6.3`, `5,310` → `5310`). Everything else
 * separates, so `CHK-5021` is `chk 5021`, `-24h` is `24h` and `{"total":9}` is `total 9`.
 */
export function tokens(text) {
  const out = [];
  for (const m of String(text ?? '')
    .toLowerCase()
    .matchAll(/[a-z0-9]+(?:[.,][0-9]+)*/g)) {
    out.push(m[0].replace(/(?<=\d),(?=\d)/g, ''));
  }
  return out;
}

/** True when `needle`'s tokens occur contiguously, in order, in `hay` (a token array). */
export function containsTokens(hay, needle) {
  if (needle.length === 0 || needle.length > hay.length) return false;
  outer: for (let i = 0; i + needle.length <= hay.length; i += 1) {
    for (let j = 0; j < needle.length; j += 1) if (hay[i + j] !== needle[j]) continue outer;
    return true;
  }
  return false;
}

/** The durations whose declared phrases occur in `text` (`cases.mjs` · `DURATION_PHRASES`). */
export function statedDurations(text) {
  const hay = tokens(text);
  return Object.keys(DURATION_PHRASES).filter((d) =>
    DURATION_PHRASES[d].some((p) => containsTokens(hay, tokens(p))),
  );
}

/**
 * Missing, as the inputs design defines it (`arguments/declare.ts` · `isMissing`, arguments note
 * § 1.1): no own key, or `undefined`, `null`, or a string that is empty after trimming.
 */
export function isMissing(args, argument) {
  if (args === null || typeof args !== 'object') return true;
  if (!Object.prototype.hasOwnProperty.call(args, argument)) return true;
  const v = args[argument];
  return v === undefined || v === null || (typeof v === 'string' && v.trim() === '');
}

/** One period call's class from what ran and what the person said (see the header). */
export function classifyPeriod({ ranWith, stated, defaultValue }) {
  if (stated !== undefined) return stated.includes(ranWith) ? 'person' : 'contradicts';
  return ranWith === defaultValue ? 'default-unchosen' : 'model-chosen';
}

// ── one run ──────────────────────────────────────────────────────────────────

/**
 * The JSON value a tool message starts with, or `undefined`. A store answers with JSON; a
 * refusal, a store error or a library note is text. The library may append a note after a
 * result (the repeated-call note), so the leading value is cut at its own closing bracket before
 * it is parsed — a note never hides the data, and text never passes for data.
 */
export function leadingJson(text) {
  if (typeof text !== 'string') return undefined;
  const s = text.trimStart();
  if (s[0] !== '{' && s[0] !== '[') return undefined;
  let depth = 0;
  let inString = false;
  for (let i = 0; i < s.length; i += 1) {
    const ch = s[i];
    if (inString) {
      if (ch === '\\') i += 1;
      else if (ch === '"') inString = false;
    } else if (ch === '"') inString = true;
    else if (ch === '{' || ch === '[') depth += 1;
    else if (ch === '}' || ch === ']') {
      depth -= 1;
      if (depth === 0) {
        try {
          return JSON.parse(s.slice(0, i + 1));
        } catch {
          return undefined;
        }
      }
    }
  }
  return undefined;
}

/** Index of the last history message the person sent with exactly `content`, or -1. */
function lastPersonMessage(history, content) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    if (history[i]?.role === 'user' && history[i].content === content) return i;
  }
  return -1;
}

/**
 * The argument rows the inputs layer files (steps 3–5; `kind: 'argument'` on the one ledger,
 * arguments note § 5.1). Absent in step 2 — the reader is written against the adopted row shape
 * so the same rows are counted when the layer lands. The CURRENT row per (call, argument) is the
 * last one filed (an `answered` row supersedes the `asked` row before it).
 */
function argumentRows(state) {
  const ledger = Array.isArray(state.findingsLedger) ? state.findingsLedger : [];
  return ledger.filter((r) => r !== null && typeof r === 'object' && r.kind === 'argument');
}

/**
 * The fields of one argument row the bench reads (arguments note § 5.1) — names, enums and a
 * quote's token count; never the value or the quote itself, so a saved row carries nothing the
 * tool's own view would hide. Fields absent on the row stay absent here.
 */
export function rowView(r) {
  const quoteTokens =
    typeof r.quote === 'string' && r.quote !== 'REDACTED' ? tokens(r.quote).length : undefined;
  return {
    ...(r.source !== undefined && { source: r.source }),
    ...(r.asked !== undefined && { asked: r.asked }),
    ...(r.proposed !== undefined && { proposed: true }),
    ...(r.claimed !== undefined && { claimed: r.claimed }),
    ...(r.matched !== undefined && { matched: r.matched }),
    ...(r.reading === true && { reading: true }),
    ...(r.earlier === true && { earlier: true }),
    ...(r.setAside !== undefined && { setAside: r.setAside }),
    ...(r.coincides !== undefined && { coincides: r.coincides }),
    ...(r.failed !== undefined && { failed: r.failed }),
    ...(quoteTokens !== undefined && { quoteTokens }),
  };
}

/** Dropped `from` entries the rows count (`malformed`, arguments note § 2.2). */
function malformedOf(rows) {
  return rows.reduce((s, r) => s + (typeof r.malformed === 'number' ? r.malformed : 0), 0);
}

/**
 * Reads one raw run (`harness.mjs` · `runCase`) into the bench's row. Deterministic: the row
 * carries no clock, no run id and no duration, so the mock's rows are byte-stable and can be
 * pinned (`bench/inputs/results/mock.json`).
 */
export function readRun(raw) {
  const caseDef = caseById(raw.caseId);
  if (caseDef === undefined) throw new Error(`run ${raw.key}: unknown case ${raw.caseId}`);
  const measured = caseDef.turns.length - 1;
  const state = raw.recording?.snapshot?.sharedState ?? {};
  const history = Array.isArray(state.history) ? state.history : [];
  const turn = raw.turns[measured];
  const answer = typeof turn?.answer === 'string' ? turn.answer : undefined;

  // The measured turn: everything after the person's last message.
  const start = lastPersonMessage(history, caseDef.turns[measured]);
  const slice = start < 0 ? [] : history.slice(start + 1);
  const resultOf = new Map();
  for (const m of slice) if (m?.role === 'tool') resultOf.set(m.toolCallId, m.content);
  const ranOf = new Map();
  for (const e of raw.execLog) if (e.turn === measured) ranOf.set(e.toolCallId, e);

  // What the person said, in every turn so far (the case's own messages found on the record).
  const personTokens = history
    .filter((m) => m?.role === 'user' && caseDef.turns.includes(m.content))
    .map((m) => tokens(m.content));

  const rows = argumentRows(state);
  const rowsFor = (id, argument) =>
    rows.filter((r) => r.toolCallId === id && r.argument === argument);

  const proposed = [];
  const periodCalls = [];
  const names = [];
  // Results the run had already seen when a call was made: every earlier turn's, then this
  // turn's in order (a name is `from-result` only when a result carried it BEFORE the call).
  // Only data counts: an error or a refusal that echoes a bad name never carried it.
  const isData = (m) => m?.role === 'tool' && leadingJson(m.content) !== undefined;
  const seenResults = history
    .slice(0, start < 0 ? 0 : start + 1)
    .filter(isData)
    .map((m) => tokens(m.content));
  for (const m of slice) {
    if (m?.role === 'tool') {
      if (isData(m)) seenResults.push(tokens(m.content));
      continue;
    }
    if (m?.role !== 'assistant' || !Array.isArray(m.toolCalls)) continue;
    for (const call of m.toolCalls) {
      const spec = toolSpec(call.name);
      const ran = ranOf.get(call.id);
      const dispatched = ran !== undefined;
      const ok = dispatched && ran.failed === undefined;
      proposed.push({ toolCallId: call.id, tool: call.name, dispatched, ok });
      if (spec?.period !== undefined) {
        const argument = spec.period.argument;
        const stated = statedValues(caseDef, call.name, argument);
        const entry = {
          toolCallId: call.id,
          tool: call.name,
          argument,
          origin: isMissing(call.args, argument) ? 'omitted' : 'sent',
          dispatched,
          ok,
        };
        if (!isMissing(call.args, argument)) entry.sent = String(call.args[argument]);
        if (stated !== undefined) entry.stated = [...stated];
        if (ok) {
          entry.ranWith = ran.effective;
          entry.cls = classifyPeriod({
            ranWith: ran.effective,
            stated,
            defaultValue: spec.period.default,
          });
          const means = caseDef.means[call.name]?.[argument];
          if (means !== undefined) entry.meant = ran.effective === means;
        }
        const pairRows = rowsFor(call.id, argument);
        const current = pairRows[pairRows.length - 1];
        if (current !== undefined) entry.row = rowView(current);
        if (pairRows.some((r) => r.asked !== undefined)) {
          entry.askedFor = true;
          // Step 5 asks for two reasons; which one is kept only on a sources-armed row, so the
          // rows of the arms that came before keep their bytes.
          if (pairRows.some((r) => r.claimed !== undefined))
            entry.askedAs = [...new Set(pairRows.map((r) => r.asked).filter(Boolean))].sort();
        }
        // Step 5: the check's verdict on the model's OWN claim — the first row that carries a
        // `claimed` (an ask that follows keeps it; the answer that supersedes it does not).
        const verdict = pairRows.find((r) => r.claimed !== undefined);
        if (verdict !== undefined && verdict !== current) entry.verdict = rowView(verdict);
        periodCalls.push(entry);
      }
      for (const argument of spec?.names ?? []) {
        if (isMissing(call.args, argument)) continue;
        const value = String(call.args[argument]);
        const needle = tokens(value);
        const cls = personTokens.some((t) => containsTokens(t, needle))
          ? 'said'
          : seenResults.some((t) => containsTokens(t, needle))
          ? 'from-result'
          : 'nobody-said';
        const nameRows = rowsFor(call.id, argument);
        const nameRow = nameRows[nameRows.length - 1];
        names.push({
          toolCallId: call.id,
          tool: call.name,
          argument,
          value,
          cls,
          dispatched,
          ok,
          ...(nameRow !== undefined && { row: rowView(nameRow) }),
        });
      }
    }
  }

  // The answer: which periods it states, and which of the results' facts it restates.
  const okPeriod = periodCalls.filter((c) => c.ok);
  const ranDurations = [...new Set(okPeriod.map((c) => DURATION[c.ranWith]))].sort();
  const said = answer === undefined ? [] : statedDurations(answer);
  const answerTokens = tokens(answer ?? '');
  let factsExpected = 0;
  let factsFound = 0;
  for (const p of proposed) {
    if (!p.ok) continue;
    const result = leadingJson(resultOf.get(p.toolCallId));
    for (const spellings of factsFor(p.tool, result)) {
      factsExpected += 1;
      if (spellings.some((s) => containsTokens(answerTokens, tokens(s)))) factsFound += 1;
    }
  }
  const periodExpected = caseDef.expects.some((t) => toolSpec(t)?.period !== undefined);

  const bySource = {};
  const byAsked = {};
  const byClaimed = {};
  const byFailed = {};
  for (const r of rows) {
    if (r.source !== undefined) bySource[r.source] = (bySource[r.source] ?? 0) + 1;
    if (r.asked !== undefined) byAsked[r.asked] = (byAsked[r.asked] ?? 0) + 1;
    if (r.claimed !== undefined) byClaimed[r.claimed] = (byClaimed[r.claimed] ?? 0) + 1;
    if (r.failed !== undefined) byFailed[r.failed] = (byFailed[r.failed] ?? 0) + 1;
  }
  // Step 5's counts ride the row only when a check filed a claim, so every earlier arm's row
  // (and the pinned mock baseline) keeps its bytes.
  const sourcesCounts =
    Object.keys(byClaimed).length === 0
      ? {}
      : { byClaimed, byFailed, malformed: malformedOf(rows) };

  return {
    key: raw.key,
    arm: raw.arm,
    caseId: raw.caseId,
    group: caseDef.group,
    rep: raw.rep,
    ...(raw.variant !== undefined && { variant: raw.variant }),
    complete: answer !== undefined,
    ...(turn?.paused === true && { paused: true }),
    ...(turn?.error !== undefined && { error: turn.error }),
    ...(raw.mockExhausted === true && { mockExhausted: true }),
    ...(state.stoppedEarly !== undefined && { stoppedEarly: true }),
    toolCalls: {
      proposed: proposed.length,
      dispatched: proposed.filter((p) => p.dispatched).length,
      refused: proposed.filter((p) => !p.dispatched).length,
      failed: proposed.filter((p) => p.dispatched && !p.ok).length,
    },
    periodCalls,
    names,
    periodExpected,
    noPeriodCall: periodExpected && okPeriod.length === 0,
    answer: {
      present: answer !== undefined,
      ranDurations,
      statedDurations: said,
      statesRan: ranDurations.length > 0 && ranDurations.every((d) => said.includes(d)),
      statesOther: said.some((d) => !ranDurations.includes(d)),
      factsExpected,
      factsFound,
      asksInProse: answer !== undefined && okPeriod.length === 0 && answer.includes('?'),
    },
    standing: raw.standing,
    argumentRows: { total: rows.length, bySource, byAsked, ...sourcesCounts },
    llm: { ...raw.usage },
    usd: raw.usd,
    requestsDigest: raw.requests.map((r) => r.digest).join('.'),
  };
}

// ── many runs ────────────────────────────────────────────────────────────────

/** Wilson 95% interval for k of n (`[0, 1]` when n is 0). */
export function wilson(k, n) {
  if (n === 0) return [0, 1];
  const z = 1.959964;
  const p = k / n;
  const denom = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / denom;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / denom;
  // At k = 0 and k = n the bound is exactly 0 or 1; floating point would miss it by an ulp.
  return [k === 0 ? 0 : Math.max(0, centre - half), k === n ? 1 : Math.min(1, centre + half)];
}

const ratio = (k, n) => (n === 0 ? undefined : k / n);

/** The rows a named set of the RULE reads (`RULE.md`, "The sets"). */
export const SETS = Object.freeze({
  /** P1 — no period stated. */
  unstated: (row) => row.group === 'P1',
  /** Every case whose person stated a period in words that fit one value. */
  stated: (row) => isStatedCase(caseById(row.caseId)),
  /** C1 and C2 — where a layer should change nothing. */
  controls: (row) => row.group === 'C1' || row.group === 'C2',
  /** P3 — names the person never said. */
  names: (row) => row.group === 'P3',
  all: () => true,
});

/**
 * The bench's metrics over a set of rows. Every rate carries its numerator and denominator;
 * a rate over nothing is `undefined`, never 0.
 */
export function summarize(rows) {
  const calls = rows.flatMap((r) => r.periodCalls.filter((c) => c.ok));
  const n = (cls) => calls.filter((c) => c.cls === cls).length;
  const defaultUnchosen = n('default-unchosen');
  const withPeriodRuns = rows.filter((r) => r.answer.present && r.answer.ranDurations.length > 0);
  const factRuns = rows.filter((r) => r.answer.present && r.answer.factsExpected > 0);
  const names = rows.flatMap((r) => r.names);
  const llmCalls = rows.reduce((s, r) => s + r.llm.calls, 0);
  const standing = {};
  const reasons = {};
  for (const r of rows) {
    const s = r.standing?.standing ?? (r.standing?.error !== undefined ? 'error' : 'none');
    standing[s] = (standing[s] ?? 0) + 1;
    for (const reason of r.standing?.reasons ?? []) reasons[reason] = (reasons[reason] ?? 0) + 1;
  }
  const periodRuns = rows.filter((r) => r.periodCalls.some((c) => c.ok));
  const namesAnArgument = (r) => (r.standing?.reasons ?? []).some((x) => x.startsWith('argument-'));
  const admitted = calls.filter(
    (c) => c.cls === 'default-unchosen' && c.row?.source === 'default',
  ).length;
  const meantCalls = calls.filter((c) => c.meant !== undefined);
  return {
    runs: rows.length,
    complete: rows.filter((r) => r.complete).length,
    periodCalls: calls.length,
    classes: {
      person: n('person'),
      contradicts: n('contradicts'),
      'default-unchosen': defaultUnchosen,
      'model-chosen': n('model-chosen'),
    },
    defaultUnchosenBy: {
      omitted: calls.filter((c) => c.cls === 'default-unchosen' && c.origin === 'omitted').length,
      sent: calls.filter((c) => c.cls === 'default-unchosen' && c.origin === 'sent').length,
    },
    rates: {
      defaultUnchosen: ratio(defaultUnchosen, calls.length),
      notThePersons: ratio(calls.length - n('person'), calls.length),
      person: ratio(n('person'), calls.length),
    },
    noPeriodCall: {
      runs: rows.filter((r) => r.noPeriodCall).length,
      of: rows.filter((r) => r.periodExpected).length,
      asksInProse: rows.filter((r) => r.noPeriodCall && r.answer.asksInProse).length,
    },
    window: {
      of: withPeriodRuns.length,
      statesRan: withPeriodRuns.filter((r) => r.answer.statesRan).length,
      statesOther: withPeriodRuns.filter((r) => r.answer.statesOther).length,
    },
    names: {
      calls: names.length,
      said: names.filter((x) => x.cls === 'said').length,
      fromResult: names.filter((x) => x.cls === 'from-result').length,
      nobodySaid: names.filter((x) => x.cls === 'nobody-said').length,
    },
    facts: {
      of: factRuns.length,
      mean: ratio(
        factRuns.reduce((s, r) => s + r.answer.factsFound / r.answer.factsExpected, 0),
        factRuns.length,
      ),
    },
    toolCalls: {
      perRun: ratio(
        rows.reduce((s, r) => s + r.toolCalls.proposed, 0),
        rows.length,
      ),
      refused: rows.reduce((s, r) => s + r.toolCalls.refused, 0),
      failed: rows.reduce((s, r) => s + r.toolCalls.failed, 0),
    },
    llm: {
      callsPerRun: ratio(llmCalls, rows.length),
      inputPerCall: ratio(
        rows.reduce((s, r) => s + r.llm.input, 0),
        llmCalls,
      ),
      outputPerCall: ratio(
        rows.reduce((s, r) => s + r.llm.output, 0),
        llmCalls,
      ),
    },
    usd: rows.reduce((s, r) => s + r.usd, 0),
    meant: { of: meantCalls.length, meant: meantCalls.filter((c) => c.meant).length },
    standing,
    reasons,
    periodRuns: periodRuns.length,
    argumentReasonRuns: periodRuns.filter(namesAnArgument).length,
    askedRuns: rows.filter((r) => r.periodCalls.some((c) => c.askedFor === true)).length,
    argumentRows: {
      total: rows.reduce((s, r) => s + r.argumentRows.total, 0),
      admittedDefaults: admitted,
      asked: rows.reduce(
        (s, r) => s + Object.values(r.argumentRows.byAsked).reduce((a, b) => a + b, 0),
        0,
      ),
    },
    stoppedEarly: rows.filter((r) => r.stoppedEarly).length,
    mockExhausted: rows.filter((r) => r.mockExhausted).length,
  };
}

/**
 * `summarize` per arm, per set, and per case — the shape `results.json` stores. With
 * `{ sources: true }` (a run that armed step 5) each arm also carries `sources`: step 5's reader
 * (`summarizeSources`) over `STEP5_SETS`, per set and per case. Without it the shape is the one
 * steps 2–4 registered, byte for byte.
 */
export function aggregate(rows, { sources = false } = {}) {
  const arms = [...new Set(rows.map((r) => r.arm))];
  const out = {};
  for (const arm of arms) {
    const mine = rows.filter((r) => r.arm === arm);
    const ids = [...new Set(mine.map((r) => r.caseId))];
    out[arm] = {
      sets: Object.fromEntries(
        Object.entries(SETS).map(([name, pick]) => [name, summarize(mine.filter(pick))]),
      ),
      cases: Object.fromEntries(
        ids.map((id) => [id, summarize(mine.filter((r) => r.caseId === id))]),
      ),
      ...(sources && {
        sources: {
          sets: Object.fromEntries(
            Object.entries(STEP5_SETS).map(([name, pick]) => [
              name,
              summarizeSources(mine.filter(pick)),
            ]),
          ),
          cases: Object.fromEntries(
            ids.map((id) => [id, summarizeSources(mine.filter((r) => r.caseId === id))]),
          ),
        },
      }),
    };
  }
  return out;
}

// ── step 5: declared sources ─────────────────────────────────────────────────

/**
 * The sets `RULE-step5.md` reads. `unstated`, `stated` and `controls` are `SETS`' own (the stated
 * set now also holds step 5's S5 cases, since it selects by the sheet's truths); the rest are
 * step 5's groups (`cases.mjs` · `STEP5_CASES`).
 */
export const STEP5_SETS = Object.freeze({
  unstated: SETS.unstated,
  stated: SETS.stated,
  fake: (row) => row.group === 'F5',
  /** Every case where the person gave no period: P1 and the fake-quote bait. */
  noPeriodGiven: (row) => row.group === 'P1' || row.group === 'F5',
  limit: (row) => row.group === 'L5',
  turn: (row) => row.group === 'T5',
  controls: SETS.controls,
  all: () => true,
});

/** The row that holds the check's verdict on the model's own claim, or `undefined`. */
function claimRowOf(c) {
  if (c.verdict !== undefined) return c.verdict;
  return c.row?.claimed !== undefined ? c.row : undefined;
}

const TRACED = new Set(['said', 'answered', 'result', 'app']);

/** A claim the check traced: said by quote or phrase, an earlier answer, a result, the app. */
export function traced(r) {
  return r !== undefined && TRACED.has(r.source) && r.reading !== true && r.failed === undefined;
}

/** A value filed as the PERSON's words with no ask: `said` by quote or phrase, not a reading. */
export function saidByQuote(r) {
  return r !== undefined && r.source === 'said' && r.reading !== true;
}

function countBy(list, key) {
  const out = {};
  for (const x of list)
    if (x !== undefined) out[x[key] ?? 'none'] = (out[x[key] ?? 'none'] ?? 0) + 1;
  return out;
}

/**
 * Step 5's reader over a set of rows (`RULE-step5.md`; the arguments note § 7.2 measures). Every
 * count is read from the argument rows the library filed (`rowView`) and the tools' own record
 * of what ran; a rate carries its numerator and denominator, and a rate over nothing is
 * `undefined`. On an arm that never armed sources every claim count is 0 — no row carries one.
 */
export function summarizeSources(rows) {
  const calls = rows.flatMap((r) => r.periodCalls.filter((c) => c.ok));
  const claims = calls.map(claimRowOf).filter((x) => x !== undefined);
  const declared = claims.filter((x) => x.claimed !== 'none');
  const person = calls.filter((c) => c.cls === 'person');
  const periodRuns = rows.filter((r) => r.periodCalls.some((c) => c.ok));
  const namesArgument = (r) => (r.standing?.reasons ?? []).some((x) => x.startsWith('argument-'));
  const nameRows = rows.flatMap((r) => r.names.map((n) => n.row)).filter((x) => x !== undefined);
  const nameClaims = nameRows.filter((x) => x.claimed !== undefined && x.claimed !== 'none');
  return {
    runs: rows.length,
    periodCalls: calls.length,
    claims: {
      of: claims.length,
      declared: declared.length,
      byClaimed: countBy(claims, 'claimed'),
      traced: declared.filter(traced).length,
      failed: countBy(
        declared.filter((x) => x.failed !== undefined),
        'failed',
      ),
      readings: declared.filter((x) => x.reading === true).length,
      matched: countBy(
        declared.filter((x) => x.matched !== undefined),
        'matched',
      ),
      oneTokenQuotes: declared.filter((x) => x.quoteTokens === 1).length,
      hints: claims.filter((x) => x.coincides !== undefined).length,
      setAside: claims.filter((x) => x.setAside !== undefined).length,
    },
    person: {
      of: person.length,
      saidNoAsk: person.filter((c) => saidByQuote(c.row) && c.askedFor !== true).length,
    },
    saidByQuote: calls.filter((c) => saidByQuote(c.row) || c.row?.source === 'app').length,
    asked: {
      runs: rows.filter((r) => r.periodCalls.some((c) => c.askedFor === true)).length,
      calls: calls.filter((c) => c.askedFor === true).length,
      unverified: calls.filter((c) => (c.askedAs ?? []).includes('unverified')).length,
      missing: calls.filter(
        (c) => c.askedFor === true && (c.askedAs === undefined || c.askedAs.includes('missing')),
      ).length,
    },
    standing: {
      periodRuns: periodRuns.length,
      noArgumentReason: periodRuns.filter((r) => !namesArgument(r)).length,
    },
    names: {
      rows: nameRows.length,
      declared: nameClaims.length,
      byClaimed: countBy(nameClaims, 'claimed'),
      traced: nameClaims.filter(traced).length,
      failed: countBy(
        nameClaims.filter((x) => x.failed !== undefined),
        'failed',
      ),
    },
  };
}

// ── the tables ───────────────────────────────────────────────────────────────

const pct = (v) => (v === undefined ? '  -  ' : `${(100 * v).toFixed(0).padStart(3)}%`);
const frac = (k, n) => `${k}/${n}`;

/** One summary as the columns the tables print. */
function columns(s) {
  const du = s.classes['default-unchosen'];
  const [lo, hi] = wilson(du, s.periodCalls);
  return [
    String(s.runs),
    String(s.periodCalls),
    `${pct(s.rates.defaultUnchosen)} [${(100 * lo).toFixed(0)}–${(100 * hi).toFixed(0)}]`,
    `${s.defaultUnchosenBy.omitted}/${s.defaultUnchosenBy.sent}`,
    String(s.classes['model-chosen']),
    String(s.classes.contradicts),
    String(s.classes.person),
    frac(s.noPeriodCall.runs, s.noPeriodCall.of),
    `${frac(s.window.statesRan, s.window.of)} · ${s.window.statesOther}`,
    frac(s.names.nobodySaid, s.names.calls),
    s.facts.mean === undefined ? '-' : s.facts.mean.toFixed(3),
    s.toolCalls.perRun === undefined ? '-' : s.toolCalls.perRun.toFixed(2),
    s.llm.inputPerCall === undefined ? '-' : s.llm.inputPerCall.toFixed(0),
    s.usd.toFixed(4),
    Object.entries(s.standing)
      .map(([k, v]) => `${k} ${v}`)
      .join(', '),
  ];
}

const HEADER = [
  'runs',
  'period calls',
  'default nobody chose',
  'left out/sent',
  'model-chosen',
  'contradicts',
  'person',
  'no period call',
  'answer states window · other',
  'names nobody said',
  'facts',
  'tool calls/run',
  'input tok/call',
  'usd',
  'standing',
];

/** The report: one table per arm (the sets, then the cases), as markdown. */
export function formatReport(aggregates) {
  const lines = [];
  for (const [arm, a] of Object.entries(aggregates)) {
    lines.push(`### arm \`${arm}\``, '');
    lines.push(`| set / case | ${HEADER.join(' | ')} |`);
    lines.push(`|${' --- |'.repeat(HEADER.length + 1)}`);
    for (const [name, s] of Object.entries(a.sets))
      lines.push(`| **${name}** | ${columns(s).join(' | ')} |`);
    for (const [id, s] of Object.entries(a.cases))
      lines.push(`| ${id} | ${columns(s).join(' | ')} |`);
    lines.push('');
  }
  return lines.join('\n');
}

const SOURCES_HEADER = [
  'runs',
  'period calls',
  'claims declared/of',
  'traced/declared',
  'readings',
  'failed',
  "person's value said, no ask",
  "filed as the person's",
  'asked runs · unverified/missing calls',
  'standing names no argument',
  'names: traced/declared',
];

function sourcesColumns(s) {
  const failed = Object.entries(s.claims.failed)
    .map(([k, v]) => `${k} ${v}`)
    .join(', ');
  return [
    String(s.runs),
    String(s.periodCalls),
    frac(s.claims.declared, s.claims.of),
    frac(s.claims.traced, s.claims.declared),
    String(s.claims.readings),
    failed === '' ? '-' : failed,
    frac(s.person.saidNoAsk, s.person.of),
    String(s.saidByQuote),
    `${s.asked.runs} · ${s.asked.unverified}/${s.asked.missing}`,
    frac(s.standing.noArgumentReason, s.standing.periodRuns),
    frac(s.names.traced, s.names.declared),
  ];
}

/** Step 5's tables (`summarizeSources`), one per arm that has them, as markdown. */
export function formatSourcesReport(aggregates) {
  const lines = [];
  for (const [arm, a] of Object.entries(aggregates)) {
    if (a.sources === undefined) continue;
    lines.push(`### arm \`${arm}\` — declared sources (step 5)`, '');
    lines.push(`| set / case | ${SOURCES_HEADER.join(' | ')} |`);
    lines.push(`|${' --- |'.repeat(SOURCES_HEADER.length + 1)}`);
    for (const [name, s] of Object.entries(a.sources.sets))
      lines.push(`| **${name}** | ${sourcesColumns(s).join(' | ')} |`);
    for (const [id, s] of Object.entries(a.sources.cases))
      lines.push(`| ${id} | ${sourcesColumns(s).join(' | ')} |`);
    lines.push('');
  }
  return lines.join('\n');
}
