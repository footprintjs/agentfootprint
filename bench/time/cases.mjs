/**
 * bench/time/cases.mjs — the case sheet of the English-reader bench (time design § 13, step T6b):
 * the clock, the two tools, the arms, the cases with their planted truths, the simulated person,
 * the scripted mock's variants, and the sheet's own checks.
 *
 * THE QUESTION. With `.time({ reader: englishTimeReader() })` (the arm `on`) every time phrase a
 * person types in chat is PROPOSED and CONFIRMED — a pre-filled one-click confirmation naming the
 * window and its zone (the owner's decision "Always confirm", TQ29), never filed as said. Does the
 * agent then query the window the person MEANT, against the same agent without the reader (arm
 * `off`, `.time({ zone })` alone), which defaults or misreads? How often is the pre-fill already
 * right (one click) and how often must the person edit it? Do phrases with no time words raise NO
 * confirmation? What do the served sentences cost per call?
 *
 * THE TRUTH IS PLANTED. Each case names the window its person meant (`truth`, a function of the
 * run's clock) and the zone they meant (`zone`). The simulated person (`answerAsk`) answers every
 * ask from that truth alone — never from the model's value — so a right window is one the record
 * shows a tool READ, compared with the plant (`metrics.mjs` · `readRun`). No model judges.
 */

/** The run's zone — the app's `.time({ zone })`. */
export const ZONE = 'America/Los_Angeles';

/**
 * The clock's anchor: Friday 9 Oct 2026, 09:00 PDT. The field sentence "10/09/26 8 AM to 8:40 AM
 * PST" is then one hour past; its day-month reading (10 Sep) and year-first reading (2010) are
 * the misreadings. `run.mjs` shifts the process clock so `Date.now()` starts here; each run's
 * `now` is the shifted clock at its start, floored to the minute (the mock: the anchor itself).
 */
export const ANCHOR = '2026-10-09T16:00:00Z';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (iso) => Date.parse(iso);

/** The system prompt for a run at `nowIso` — the same words in both arms. */
export function systemPrompt(nowIso) {
  const ms = Date.parse(nowIso);
  const local = new Intl.DateTimeFormat('en-US', {
    timeZone: ZONE,
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(new Date(ms));
  return (
    'You are the operations assistant for a backup platform. Answer the person with the tools; ' +
    'call a tool before you answer a question about activity or errors. ' +
    `The current time is ${local} (${ZONE}); in UTC ${new Date(ms).toISOString()}; in epoch ` +
    `milliseconds ${ms}.`
  );
}

/** The two tools, as the library's `defineTool` takes them (`harness.mjs` · `buildTools`). */
export const TOOLS = Object.freeze([
  {
    name: 'client_activity',
    description: 'Client operations (logins, backups, restores) per client over a time window.',
    inputSchema: {
      type: 'object',
      properties: {
        start_time: { type: 'integer', description: 'Window start, epoch milliseconds.' },
        end_time: { type: 'integer', description: 'Window end, epoch milliseconds (exclusive).' },
        client: { type: 'string', description: 'Optional client name to filter on.' },
      },
    },
    askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
    period: {
      forms: [
        {
          kind: 'bounds',
          from: { argument: 'start_time', as: 'epoch-ms' },
          to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
        },
      ],
      direction: 'past',
    },
  },
  {
    name: 'search_logs',
    description: 'Error log lines over a look-back window that ends now.',
    inputSchema: {
      type: 'object',
      properties: {
        window: { type: 'string', description: 'Look-back from now, such as 30m, 2h or 3d.' },
        query: { type: 'string', description: 'Optional text the lines must contain.' },
      },
    },
    askOrAssume: { window: { assume: '1h' } },
    period: { argument: 'window', spelling: 'lookback' },
  },
]);

/** The arms. `off` = `.time({ zone })`; `on` = `.time({ zone, reader: englishTimeReader() })`. */
export const ARMS = Object.freeze(['off', 'on']);

/**
 * The cells: `readable` — a phrase the reader proposes a window for (the gain is measured here);
 * `unreadable` — a phrase v1 reads as unreadable (no pre-fill; the arm must not hurt); `future` —
 * a future date to a past-only tool; `control` — no time words (no confirmation may be raised).
 */
export const CELLS = Object.freeze(['readable', 'unreadable', 'future', 'control']);

/**
 * How a run's first period read is judged against the truth (`metrics.mjs` · `rightOf`):
 * `exact` — both bounds within `tol` ms; `covers` — a look-back-only tool's read holds the truth
 * and starts no more than a day before it (the widest honest covering look-back);
 * `no-future` — no read starts after the run's now; `completed` — the run answered (controls).
 */
export const CRITERIA = Object.freeze(['exact', 'covers', 'no-future', 'completed']);

/** A control's person, asked by a tool's own rule: the last 24 hours. */
const lastDay = (now) => ({ from: now - DAY, to: now });

// The mock's variants — the model's moves the harness must read right, never a model.
const leaveOut = (tool) => ({ label: 'leaves the period out', steps: () => [{ call: tool }] });
const ownBounds = (label, from, to) => ({
  label,
  steps: (now) => [{ call: 'client_activity', args: { start_time: from(now), end_time: to(now) } }],
});
const ownLookback = (label, window) => ({
  label,
  steps: () => [{ call: 'search_logs', args: { window } }],
});

/**
 * The cases. `truth(now)` → `{ from, to }` in epoch ms (the window the person meant), or
 * `undefined` for a control (the person meant no window). `zone` is the zone the person meant.
 * `tol` — how far a bound may sit from the truth's (ms): a minute for said clock times, five
 * minutes where a look-back is read against a later dispatch clock.
 */
export const CASES = Object.freeze([
  {
    id: 'field-pst',
    cell: 'readable',
    message: 'Show client activity 10/09/26 8 AM to 8:40 AM PST',
    tool: 'client_activity',
    criterion: 'exact',
    zone: ZONE,
    truth: () => ({ from: at('2026-10-09T08:00:00-07:00'), to: at('2026-10-09T08:41:00-07:00') }),
    tol: MIN,
    mock: [
      leaveOut('client_activity'),
      ownBounds(
        'reads PST as UTC-8 (an hour off)',
        () => at('2026-10-09T08:00:00-08:00'),
        () => at('2026-10-09T08:40:00-08:00'),
      ),
    ],
  },
  {
    id: 'yesterday',
    cell: 'readable',
    message: 'Show client activity yesterday',
    tool: 'client_activity',
    criterion: 'exact',
    zone: ZONE,
    truth: () => ({ from: at('2026-10-08T00:00:00-07:00'), to: at('2026-10-09T00:00:00-07:00') }),
    tol: MIN,
    mock: [
      leaveOut('client_activity'),
      ownBounds(
        'reads yesterday in UTC',
        () => at('2026-10-08T00:00:00Z'),
        () => at('2026-10-09T00:00:00Z'),
      ),
    ],
  },
  {
    id: 'date-only',
    cell: 'readable',
    message: 'Show client activity on 10/08/26',
    tool: 'client_activity',
    criterion: 'exact',
    zone: ZONE,
    truth: () => ({ from: at('2026-10-08T00:00:00-07:00'), to: at('2026-10-09T00:00:00-07:00') }),
    tol: MIN,
    mock: [
      leaveOut('client_activity'),
      ownBounds(
        'reads the date in UTC',
        () => at('2026-10-08T00:00:00Z'),
        () => at('2026-10-09T00:00:00Z'),
      ),
    ],
  },
  {
    id: 'london',
    cell: 'readable',
    message: 'Show client activity yesterday London time',
    tool: 'client_activity',
    criterion: 'exact',
    zone: 'Europe/London',
    truth: () => ({ from: at('2026-10-08T00:00:00+01:00'), to: at('2026-10-09T00:00:00+01:00') }),
    tol: MIN,
    mock: [
      leaveOut('client_activity'),
      ownBounds(
        'reads the London day right',
        () => at('2026-10-08T00:00:00+01:00'),
        () => at('2026-10-09T00:00:00+01:00'),
      ),
    ],
  },
  {
    id: 'last-2h',
    cell: 'readable',
    message: 'Any errors in the last 2 hours?',
    tool: 'search_logs',
    criterion: 'exact',
    zone: ZONE,
    truth: (now) => ({ from: now - 2 * HOUR, to: now }),
    tol: 5 * MIN,
    mock: [leaveOut('search_logs'), ownLookback('sends 2h itself', '2h')],
  },
  {
    id: 'abs-lookback',
    cell: 'readable',
    message: 'Any errors yesterday 8 AM to 9 AM?',
    tool: 'search_logs',
    criterion: 'covers',
    zone: ZONE,
    truth: () => ({ from: at('2026-10-08T08:00:00-07:00'), to: at('2026-10-08T09:00:00-07:00') }),
    tol: 5 * MIN,
    mock: [leaveOut('search_logs'), ownLookback('sends 1d (misses 8 AM)', '1d')],
  },
  {
    id: 'yesterday-morning',
    cell: 'unreadable',
    message: 'What client activity was there yesterday morning?',
    tool: 'client_activity',
    criterion: 'exact',
    zone: ZONE,
    truth: () => ({ from: at('2026-10-08T06:00:00-07:00'), to: at('2026-10-08T12:00:00-07:00') }),
    tol: MIN,
    mock: [
      leaveOut('client_activity'),
      ownBounds(
        'reads morning as midnight to noon',
        () => at('2026-10-08T00:00:00-07:00'),
        () => at('2026-10-08T12:00:00-07:00'),
      ),
    ],
  },
  {
    id: 'last-week',
    cell: 'unreadable',
    message: 'Any errors last week?',
    tool: 'search_logs',
    criterion: 'exact',
    zone: ZONE,
    truth: (now) => ({ from: now - 7 * DAY, to: now }),
    tol: 5 * MIN,
    mock: [leaveOut('search_logs'), ownLookback('sends 7d', '7d')],
  },
  {
    id: 'future',
    cell: 'future',
    message: 'Show client activity on 10/20/26',
    tool: 'client_activity',
    criterion: 'no-future',
    zone: ZONE,
    truth: () => ({ from: at('2026-10-20T00:00:00-07:00'), to: at('2026-10-21T00:00:00-07:00') }),
    tol: MIN,
    mock: [
      leaveOut('client_activity'),
      ownBounds(
        'sends the future day',
        () => at('2026-10-20T00:00:00-07:00'),
        () => at('2026-10-21T00:00:00-07:00'),
      ),
    ],
  },
  {
    id: 'c-cluster',
    cell: 'control',
    message: 'Show client activity for the payroll cluster',
    tool: 'client_activity',
    criterion: 'completed',
    zone: ZONE,
    truth: undefined,
    asked: lastDay,
    tol: MIN,
    mock: [
      leaveOut('client_activity'),
      ownBounds(
        'sends the last day',
        (now) => now - DAY,
        (now) => now,
      ),
    ],
  },
  {
    id: 'c-node',
    cell: 'control',
    message: 'Which clients were busiest on node 11?',
    tool: 'client_activity',
    criterion: 'completed',
    zone: ZONE,
    truth: undefined,
    asked: lastDay,
    tol: MIN,
    mock: [leaveOut('client_activity')],
  },
  {
    id: 'c-backup',
    cell: 'control',
    message: 'Any errors on the backup service?',
    tool: 'search_logs',
    criterion: 'completed',
    zone: ZONE,
    truth: undefined,
    asked: lastDay,
    tol: MIN,
    mock: [leaveOut('search_logs')],
  },
  {
    id: 'c-504',
    cell: 'control',
    message: 'Find error lines mentioning timeout or 504',
    tool: 'search_logs',
    criterion: 'completed',
    zone: ZONE,
    truth: undefined,
    asked: lastDay,
    tol: MIN,
    mock: [leaveOut('search_logs'), ownLookback('sends 24h', '24h')],
  },
]);

/** The case by id. */
export function caseOf(id) {
  const c = CASES.find((x) => x.id === id);
  if (c === undefined) throw new Error(`no case '${id}'`);
  return c;
}

// ── the simulated person ─────────────────────────────────────────────────────

/** An ISO range `from/to` (the time ask's own spelling) → epoch ms, or `undefined`. */
export function parseIsoRange(text) {
  if (typeof text !== 'string') return undefined;
  const parts = text.split('/');
  if (parts.length !== 2) return undefined;
  const from = Date.parse(parts[0]);
  const to = Date.parse(parts[1]);
  return Number.isFinite(from) && Number.isFinite(to) ? { from, to } : undefined;
}

/** Whether two windows agree within `tol` ms on both bounds. */
export function sameWindow(a, b, tol) {
  return a !== undefined && b !== undefined && Math.abs(a.from - b.from) <= tol && Math.abs(a.to - b.to) <= tol;
}

/** `ms` as an ISO instant with the numeric offset of `zone` at that instant. */
export function isoInZone(ms, zone) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: zone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
      .formatToParts(new Date(ms))
      .map((p) => [p.type, p.value]),
  );
  const wall = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMin = Math.round((wall - Math.floor(ms / 1000) * 1000) / MIN);
  const sign = offsetMin < 0 ? '-' : '+';
  const abs = Math.abs(offsetMin);
  const off = `${sign}${String(Math.floor(abs / 60)).padStart(2, '0')}:${String(abs % 60).padStart(2, '0')}`;
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}${off}`;
}

/**
 * The window the case's person means, at the run's `now` (epoch ms): the planted truth, or — for
 * a control asked by a tool's own rule — the last 24 hours.
 */
export function meantWindow(caseDef, now) {
  return caseDef.truth !== undefined ? caseDef.truth(now) : caseDef.asked(now);
}

/**
 * The simulated person's reply to one ask (`awaitingInput`), from the case's truth alone:
 * - a `zone` field → the zone they meant;
 * - a `time-range` field (the confirmation) → the FIRST option when it is their window (the
 *   one-click confirmation: `prefill-right`), another option when that one is (`other-option`),
 *   else their own window typed in their zone (`edited`);
 * - a tool's own ask for `start_time` / `end_time` → their window's bound, epoch ms;
 * - anything else → an empty string, counted `unknown`.
 * Returns `{ reply, fields: [{ id, kind, pick? }] }`.
 */
export function answerAsk(caseDef, awaitingInput, now) {
  const meant = meantWindow(caseDef, now);
  const marker = awaitingInput?.context?.agentfootprint?.fields ?? [];
  const values = {};
  const fields = [];
  for (const field of awaitingInput?.fields ?? []) {
    if (field.format === 'zone') {
      values[field.id] = caseDef.zone;
      fields.push({ id: field.id, kind: 'zone', answered: caseDef.zone });
      continue;
    }
    if (field.format === 'time-range') {
      const options = (field.enum ?? []).map(parseIsoRange);
      const tol = caseDef.tol;
      let pick;
      let value;
      if (options.length > 0 && sameWindow(options[0], meant, tol)) {
        pick = 'prefill-right';
        value = field.enum[0];
      } else {
        const i = options.findIndex((o) => sameWindow(o, meant, tol));
        if (i > 0) {
          pick = 'other-option';
          value = field.enum[i];
        } else {
          pick = 'edited';
          value = `${isoInZone(meant.from, caseDef.zone)}/${isoInZone(meant.to, caseDef.zone)}`;
        }
      }
      values[field.id] = value;
      fields.push({
        id: field.id,
        kind: 'confirm',
        pick,
        offered: field.enum ?? [],
        labels: field.labels ?? [],
        answered: value,
      });
      continue;
    }
    const argument = marker.find((m) => m.id === field.id)?.argument;
    if (argument === 'start_time' || argument === 'end_time') {
      const value = argument === 'start_time' ? meant.from : meant.to;
      values[field.id] = value;
      fields.push({ id: field.id, kind: 'tool-ask', argument, answered: value });
      continue;
    }
    values[field.id] = '';
    fields.push({ id: field.id, kind: 'unknown', argument, description: field.description });
  }
  return { reply: { requestId: awaitingInput.requestId, values }, fields };
}

// ── the sheet's own checks ───────────────────────────────────────────────────

/** Every problem with the sheet, as a sentence; empty when it is sound. */
export function sheetProblems() {
  const problems = [];
  const ids = new Set();
  const now = Date.parse(ANCHOR);
  for (const c of CASES) {
    if (!/^[a-z0-9-]+$/.test(c.id)) problems.push(`${c.id}: ids are [a-z0-9-]`);
    if (ids.has(c.id)) problems.push(`${c.id}: duplicate id`);
    ids.add(c.id);
    if (!CELLS.includes(c.cell)) problems.push(`${c.id}: unknown cell ${c.cell}`);
    if (!CRITERIA.includes(c.criterion)) problems.push(`${c.id}: unknown criterion ${c.criterion}`);
    if (!TOOLS.some((t) => t.name === c.tool)) problems.push(`${c.id}: unknown tool ${c.tool}`);
    if ((c.cell === 'control') !== (c.truth === undefined))
      problems.push(`${c.id}: a control has no truth, and only a control`);
    if (c.cell === 'control' && c.criterion !== 'completed')
      problems.push(`${c.id}: a control is judged on completion`);
    const w = meantWindow(c, now);
    if (!(w.from < w.to)) problems.push(`${c.id}: the meant window is empty`);
    if (c.cell !== 'future' && w.to > now + c.tol) problems.push(`${c.id}: the meant window is not past`);
    if (c.cell === 'future' && !(w.from > now)) problems.push(`${c.id}: a future case means a future day`);
    if (!Array.isArray(c.mock) || c.mock.length === 0) problems.push(`${c.id}: no mock variant`);
  }
  for (const cell of CELLS)
    if (!CASES.some((c) => c.cell === cell)) problems.push(`no case in cell ${cell}`);
  return problems;
}
