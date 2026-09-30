/**
 * bench/time-checks/cases.mjs — the case sheet of the result-checks bench (time design § 13, step
 * T8): the clock, the tools and their stores, the arms, the cases with their planted truths, the
 * simulated person, the scripted mock's variants, and the sheet's own checks.
 *
 * THE QUESTION. Under `.time()`, step T8 compares what each call READ with what it ASKED
 * (`core/time/check.ts` · `periodTimeCheck`), folds "not sure" when they differ or the time asked
 * about is older than the source keeps, labels sources on different clocks, prints the limits for
 * the person and serves them to the model late (`arguments/serve.ts` · `timeLimitsSentence`).
 * Does the answer's standing then match the planted truth — "not sure" where part of the asked
 * window was not read, quiet where the read matched — and do the model's answers stop claiming
 * past what was read, against the same agent on the build before T8 (arm `off`)?
 *
 * THE TRUTH IS PLANTED. Each case names the window its person meant (`window`, a function of the
 * run's clock, handed to the agent as the host's window: `time.window`). Each tool computes the
 * range its own store really READ from the arguments it received (after its clamp, its retention,
 * its day grain) and logs it before it answers (`harness.mjs` · `buildTools`). The bench's truth
 * is that log against the person's window (`metrics.mjs` · `truthOf`) — never the library's check,
 * never a model.
 */

/** The run's zone — the app's `.time({ zone })`, and the person's. */
export const ZONE = 'America/Los_Angeles';

/** Friday 9 Oct 2026, 09:00 PDT. `run.mjs` shifts the process clock to start here. */
export const ANCHOR = '2026-10-09T16:00:00Z';

export const MIN = 60_000;
export const HOUR = 60 * MIN;
export const DAY = 24 * HOUR;
const at = (iso) => Date.parse(iso);

/** A wall time in Los Angeles in October 2026 (PDT, UTC−07:00) → epoch ms. */
export const la = (wall) => at(`${wall}-07:00`);

/** An instant spelled with the Los Angeles offset (`2026-10-09T08:00:00.000-07:00`) — the same instant, to the ms. */
export function isoWithOffset(ms) {
  return `${new Date(ms - 7 * HOUR).toISOString().slice(0, 23)}-07:00`;
}

/** A clock time of `ms` in `zone`, `HH:MM`. */
export function wallClock(ms, zone = ZONE) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(new Date(ms));
}

/** The system prompt for a message written at `nowIso` — the same words in both arms. */
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
    'call a tool before you answer a question about activity, errors or access. ' +
    `The current time is ${local} (${ZONE}); in UTC ${new Date(ms).toISOString()}; in epoch ` +
    `milliseconds ${ms}.`
  );
}

// ── the stores ────────────────────────────────────────────────────────────────

/** client_activity: operations per day (all clients); a read covers 7 days at most. */
export const OPS_PER_DAY = 183;
/** client_activity's store keeps 90 days. */
export const ACTIVITY_RETENTION = 90 * DAY;
/** client_activity reads at most 7 days per call (it clamps the front and says so). */
export const ACTIVITY_MAX_READ = 7 * DAY;
/** search_logs' store keeps 14 days. */
export const LOGS_HELD = 14 * DAY;

/**
 * The error log: fixed lines around the anchor (for the yesterday case) and lines placed
 * relative to the run's own clock (`at: (run) => ms`, for the look-back cases).
 */
export const ERROR_LINES = Object.freeze([
  { at: () => la('2026-10-08T06:30:00'), text: 'disk quota warning on vault-2' },
  { at: () => la('2026-10-08T07:55:00'), text: 'backup job timeout (client fin-01)' },
  { at: () => la('2026-10-08T08:12:00'), text: 'backup job timeout (client hr-02)' },
  { at: () => la('2026-10-08T08:47:00'), text: 'HTTP 504 from catalog' },
  { at: () => la('2026-10-08T11:20:00'), text: 'restore verification failed (client ops-07)' },
  { at: () => la('2026-10-08T15:05:00'), text: 'HTTP 504 from catalog' },
  { at: () => la('2026-10-08T22:40:00'), text: 'backup job timeout (client fin-01)' },
  { at: () => la('2026-10-09T02:10:00'), text: 'certificate expires in 10 days' },
  { at: () => la('2026-10-09T04:35:00'), text: 'HTTP 504 from catalog' },
  { at: (run) => run - 95 * MIN, text: 'agent heartbeat missed (node-3)' },
  { at: (run) => run - 50 * MIN, text: 'backup job timeout (client pay-04)' },
  { at: (run) => run - 40 * MIN, text: 'HTTP 504 from catalog' },
  { at: (run) => run - 10 * MIN, text: 'agent heartbeat missed (node-5)' },
]);

/** daily_totals: backup runs per day, by the day's start (Los Angeles). */
export const DAILY = Object.freeze({
  '2026-09-30': 388,
  '2026-10-01': 412,
  '2026-10-02': 398,
  '2026-10-03': 405,
  '2026-10-04': 377,
  '2026-10-05': 420,
  '2026-10-06': 391,
  '2026-10-07': 402,
  '2026-10-08': 415,
  '2026-10-09': 180,
});

/** The lab door and the badge reader, with the clocks their rows are written in. */
export const DOOR_EVENTS = Object.freeze([
  la('2026-10-09T08:05:00'),
  la('2026-10-09T08:31:00'),
  la('2026-10-09T08:48:00'),
]);
export const BADGE_SWIPES = Object.freeze([la('2026-10-09T08:03:00'), la('2026-10-09T08:29:00')]);

// ── the tools (the declarations; `harness.mjs` · `buildTools` adds `execute`) ─────────────────

const bounds = () => ({
  kind: 'bounds',
  from: { argument: 'start_time', as: 'epoch-ms' },
  to: { argument: 'end_time', as: 'epoch-ms', edge: 'exclusive' },
});
const boundsSchema = (what) => ({
  type: 'object',
  properties: {
    start_time: { type: 'integer', description: `${what} start, epoch milliseconds.` },
    end_time: { type: 'integer', description: `${what} end, epoch milliseconds (exclusive).` },
  },
});
const askBounds = { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } };

/**
 * Every tool of the sheet, by name. `clock` (door_events / badge_log only) is filled per case:
 * the zone the dataset's time axis declares, and how the result spells its period's instants.
 */
export const TOOL_SPECS = Object.freeze({
  client_activity: {
    name: 'client_activity',
    description:
      'Client operations (logins, backups, restores) summed over a time window. The store keeps 90 days.',
    inputSchema: boundsSchema('Window'),
    askOrAssume: askBounds,
    period: { forms: [bounds()], retention: '90d', direction: 'past' },
  },
  search_logs: {
    name: 'search_logs',
    description: 'Error log lines over a look-back window that ends now, each with its time.',
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
  daily_totals: {
    name: 'daily_totals',
    description: 'Backup runs per calendar day (Los Angeles days) over a window of whole days.',
    inputSchema: boundsSchema('Window'),
    askOrAssume: askBounds,
    period: { forms: [bounds()], granularity: '1d', direction: 'past' },
  },
  door_events: {
    name: 'door_events',
    description: 'Openings of the lab door over a time window, as a dataset of rows.',
    inputSchema: boundsSchema('Window'),
    askOrAssume: askBounds,
    period: { forms: [bounds()], direction: 'past' },
  },
  badge_log: {
    name: 'badge_log',
    description: 'Badge swipes at the lab reader over a time window, as a dataset of rows.',
    inputSchema: boundsSchema('Window'),
    askOrAssume: askBounds,
    period: { forms: [bounds()], direction: 'past' },
  },
});

/** The arms: `off` = the build BEFORE step T8 (`--baseline`); `on` = this branch's build. */
export const ARMS = Object.freeze(['off', 'on']);

/**
 * The kinds of case. `missing` — part of the asked window cannot have been read (clamp, a shifted
 * look-back, beyond retention): "not sure" is honest whatever the model writes. `extra` — a read
 * wider than asked (TQ8's cell: an answer can still be right if the model filters the rows).
 * `clocks` — two sources on different declared clocks (a label, no standing change). `control` —
 * a read that matches what was asked.
 */
export const KINDS = Object.freeze(['missing', 'extra', 'clocks', 'control']);

// The mock's variants — the model's moves the harness must read right, never a model.
const leaveOut = (tools, answer) => ({
  label: 'leaves the period out',
  steps: () => tools.map((t) => ({ call: t })),
  answer,
});
const own = (label, calls, answer) => ({ label, steps: (msgNow) => calls(msgNow), answer });

/**
 * The cases. `window(run)` → the person's window `{ from, to }` (epoch ms) given the run's clock
 * at its start; `messageAt(run)` → when the person wrote the message (the turn's `now`; 30 minutes
 * before the run for the paused case). `facts` — the values a correct answer restates; `countFact`
 * — the count of lines inside the person's window, which an answer that filtered a wider read
 * states (`labels.mjs` · `states`).
 */
export const CASES = Object.freeze([
  {
    id: 'clamp-30d',
    kind: 'missing',
    message: 'How many client operations were there over the last 30 days?',
    tools: ['client_activity'],
    window: (run) => ({ from: run - 30 * DAY, to: run }),
    messageAt: (run) => run,
    facts: [String(7 * OPS_PER_DAY)],
    mock: [
      leaveOut(
        ['client_activity'],
        `There were ${7 * OPS_PER_DAY} client operations over the last 30 days.`,
      ),
      own(
        'writes the 30 days itself',
        (n) => [{ call: 'client_activity', args: { start_time: n - 30 * DAY, end_time: n } }],
        `The tool read only the last 7 days: ${7 * OPS_PER_DAY} operations.`,
      ),
    ],
  },
  {
    id: 'c-clamp-7d',
    kind: 'control',
    message: 'How many client operations were there over the last 7 days?',
    tools: ['client_activity'],
    window: (run) => ({ from: run - 7 * DAY, to: run }),
    messageAt: (run) => run,
    facts: [String(7 * OPS_PER_DAY)],
    mock: [
      leaveOut(
        ['client_activity'],
        `There were ${7 * OPS_PER_DAY} client operations over the last 7 days.`,
      ),
      own(
        'writes the 7 days itself',
        (n) => [{ call: 'client_activity', args: { start_time: n - 7 * DAY, end_time: n } }],
        `${7 * OPS_PER_DAY} operations in the last 7 days.`,
      ),
    ],
  },
  {
    id: 'beyond-retention',
    kind: 'missing',
    message: 'How many client operations were there from June 1 to June 14 this year?',
    tools: ['client_activity'],
    window: () => ({ from: la('2026-06-01T00:00:00'), to: la('2026-06-15T00:00:00') }),
    messageAt: (run) => run,
    facts: [],
    mock: [
      leaveOut(['client_activity'], 'There were no client operations from June 1 to June 14.'),
      own(
        'writes June itself',
        () => [
          {
            call: 'client_activity',
            args: { start_time: la('2026-06-01T00:00:00'), end_time: la('2026-06-15T00:00:00') },
          },
        ],
        'The store keeps only 90 days, so June is beyond its retention.',
      ),
    ],
  },
  {
    id: 'covering-lookback',
    kind: 'extra',
    message: 'Were there any errors yesterday between 8 and 9 AM?',
    tools: ['search_logs'],
    window: () => ({ from: la('2026-10-08T08:00:00'), to: la('2026-10-08T09:00:00') }),
    messageAt: (run) => run,
    facts: ['2'],
    countFact: 2,
    mock: [
      leaveOut(['search_logs'], 'There were 11 errors: backup job timeouts and HTTP 504s.'),
      own(
        'writes a 2-day look-back',
        () => [{ call: 'search_logs', args: { window: '2d' } }],
        'Between 8 and 9 AM yesterday there were 2 errors: a backup job timeout at 08:12 and an HTTP 504 at 08:47.',
      ),
    ],
  },
  {
    id: 'lookback-after-pause',
    kind: 'missing',
    message: 'Were there any errors in the last 30 minutes?',
    tools: ['search_logs'],
    window: (run) => ({ from: run - 60 * MIN, to: run - 30 * MIN }),
    messageAt: (run) => run - 30 * MIN,
    facts: [],
    mock: [
      leaveOut(
        ['search_logs'],
        'There was 1 error in the last 30 minutes: agent heartbeat missed on node-5.',
      ),
      own(
        'writes 30m itself',
        () => [{ call: 'search_logs', args: { window: '30m' } }],
        'The search ran later than you asked, so it covers a different half hour: 1 error.',
      ),
    ],
  },
  {
    id: 'c-lookback-hour',
    kind: 'control',
    message: 'Were there any errors in the last hour?',
    tools: ['search_logs'],
    window: (run) => ({ from: run - HOUR, to: run }),
    messageAt: (run) => run,
    facts: ['3'],
    countFact: 3,
    mock: [
      leaveOut(['search_logs'], 'There were 3 errors in the last hour.'),
      own(
        'writes 1h itself',
        () => [{ call: 'search_logs', args: { window: '1h' } }],
        '3 errors in the last hour.',
      ),
    ],
  },
  {
    id: 'c-daily-inclusive',
    kind: 'control',
    message: 'What were the daily backup run totals from October 1 through October 7?',
    tools: ['daily_totals'],
    window: () => ({ from: la('2026-10-01T00:00:00'), to: la('2026-10-08T00:00:00') }),
    messageAt: (run) => run,
    facts: ['2805'],
    mock: [
      leaveOut(['daily_totals'], '2805 backup runs from October 1 through October 7.'),
      own(
        'writes the week itself',
        () => [
          {
            call: 'daily_totals',
            args: { start_time: la('2026-10-01T00:00:00'), end_time: la('2026-10-08T00:00:00') },
          },
        ],
        'In total 2805 runs.',
      ),
    ],
  },
  {
    id: 'clocks-differ',
    kind: 'clocks',
    message: 'Show the lab door openings and badge swipes between 8 and 9 AM today.',
    tools: ['door_events', 'badge_log'],
    clock: {
      door_events: { zone: 'America/New_York', spell: 'z' },
      badge_log: { zone: ZONE, spell: 'z' },
    },
    window: () => ({ from: la('2026-10-09T08:00:00'), to: la('2026-10-09T09:00:00') }),
    messageAt: (run) => run,
    facts: ['3', '2'],
    mock: [
      leaveOut(['door_events', 'badge_log'], '3 door openings and 2 badge swipes.'),
      own(
        'writes the hour itself',
        () =>
          ['door_events', 'badge_log'].map((call) => ({
            call,
            args: { start_time: la('2026-10-09T08:00:00'), end_time: la('2026-10-09T09:00:00') },
          })),
        'The door log is in New York time: 3 openings; 2 badge swipes.',
      ),
    ],
  },
  {
    id: 'c-clocks-offsets',
    kind: 'control',
    message: 'Show the lab door openings and badge swipes between 8 and 9 AM today.',
    tools: ['door_events', 'badge_log'],
    clock: {
      door_events: { spell: 'z' },
      badge_log: { spell: 'offset' },
    },
    window: () => ({ from: la('2026-10-09T08:00:00'), to: la('2026-10-09T09:00:00') }),
    messageAt: (run) => run,
    facts: ['3', '2'],
    mock: [
      leaveOut(['door_events', 'badge_log'], '3 door openings and 2 badge swipes.'),
      own(
        'writes the hour itself',
        () =>
          ['door_events', 'badge_log'].map((call) => ({
            call,
            args: { start_time: la('2026-10-09T08:00:00'), end_time: la('2026-10-09T09:00:00') },
          })),
        '3 door openings, 2 badge swipes.',
      ),
    ],
  },
]);

// ── the simulated person (a tool's own ask; the library's time ask) ──────────────────────────

/** Minutes → a look-back spelling (`90m`). */
const lookbackSpelling = (ms) => `${Math.round(ms / MIN)}m`;

/**
 * Answers one ask from the person's window alone: a bound in epoch ms, a look-back of the window's
 * length, the run's zone; anything else is left empty (and recorded as `unknown`).
 */
export function answerAsk(caseDef, awaitingInput, run) {
  const w = caseDef.window(run);
  const marker = awaitingInput?.context?.agentfootprint?.fields ?? [];
  const values = {};
  const fields = [];
  for (const field of awaitingInput?.fields ?? []) {
    const argument = marker.find((m) => m.id === field.id)?.argument;
    let value = '';
    let kind = 'unknown';
    if (field.format === 'zone') {
      value = ZONE;
      kind = 'zone';
    } else if (field.format === 'time-range') {
      value = (field.enum ?? [])[0] ?? '';
      kind = 'confirm';
    } else if (argument === 'start_time' || argument === 'end_time') {
      value = argument === 'start_time' ? w.from : w.to;
      kind = 'tool-ask';
    } else if (argument === 'window') {
      value = lookbackSpelling(w.to - w.from);
      kind = 'tool-ask';
    }
    values[field.id] = value;
    fields.push({
      id: field.id,
      kind,
      ...(argument !== undefined && { argument }),
      answered: value,
    });
  }
  return { reply: { requestId: awaitingInput.requestId, values }, fields };
}

// ── the sheet's own checks ───────────────────────────────────────────────────────────────────

/** Every problem with the sheet, as a sentence; empty when it is sound. */
export function sheetProblems() {
  const problems = [];
  const ids = new Set();
  const run = Date.parse(ANCHOR) + 5 * MIN;
  for (const c of CASES) {
    if (ids.has(c.id)) problems.push(`duplicate case id ${c.id}`);
    ids.add(c.id);
    if (!/^[a-z0-9-]+$/.test(c.id)) problems.push(`${c.id}: ids are [a-z0-9-]`);
    if (!KINDS.includes(c.kind)) problems.push(`${c.id}: unknown kind ${c.kind}`);
    for (const t of c.tools)
      if (TOOL_SPECS[t] === undefined) problems.push(`${c.id}: no tool ${t}`);
    const w = c.window(run);
    if (!(w.from < w.to)) problems.push(`${c.id}: an empty window`);
    if (w.to > c.messageAt(run)) problems.push(`${c.id}: the window ends after the message`);
    if (c.mock.length < 1) problems.push(`${c.id}: no scripted variant`);
    if ((c.tools.includes('door_events') || c.tools.includes('badge_log')) && c.clock === undefined)
      problems.push(`${c.id}: a dataset tool needs its clock`);
  }
  for (const kind of KINDS)
    if (!CASES.some((c) => c.kind === kind)) problems.push(`no case of kind ${kind}`);
  return problems;
}
