# Time layer examples

[Time layer README](README.md)

```ts
import { instantOf, toUtc } from './instant.js';
import { durationMs, LOOKBACK_UNITS } from './duration.js';
import { wallToInstant } from './zone.js';
import { parseRange, toInclusive } from './range.js';
import { normaliseInstants } from './axis.js';
import { draftClock } from './clock.js';
import { presentRange } from './present.js';
import { checkReading } from './reader.js';
import { chooseReading, DEFAULT_TIME_POLICY, resolveMention } from './resolve.js';
import { checkTimeAnswer } from './ask.js';

instantOf('2026-10-09t08:00z', 'lenient'); // a result may declare it
instantOf('2026-10-09t08:00z', 'strict'); //  undefined — a tool is never sent it
toUtc('2026-10-09T08:00-07:00', 'strict'); // '2026-10-09T15:00:00Z'

durationMs('40m', LOOKBACK_UNITS); // 2400000
durationMs('30s', LOOKBACK_UNITS); // undefined — seconds are a tool's opt-in (`units: 'smhdw'`)

// 01:30 on 1 Nov 2026 happens twice in Los Angeles; 'reject' refuses to pick.
wallToInstant({ year: 2026, month: 11, day: 1, hour: 1, minute: 30 }, 'America/Los_Angeles', 'reject'); // undefined

// "8:00 to 8:40" read to the end of its grain, then written with inclusive ends for a SQL BETWEEN.
const asked = parseRange('2026-10-09T08:00:00-07:00/2026-10-09T08:41:00-07:00')!;
toInclusive(asked, 60_000); // { from: '…T08:00:00-07:00', to: '…T08:40:00-07:00' }

// A dataset's time column, compared as instants: two 01:30 rows across the fall-back, by row order.
normaliseInstants(
  [{ t: '2026-11-01T01:30' }, { t: '2026-11-01T01:30' }],
  { column: 't', unit: 'iso', zone: 'America/Los_Angeles' },
); // points '2026-11-01T08:30:00Z' (earlier) then '2026-11-01T09:30:00Z' (later), each noted
normaliseInstants([{ t: '2026-09-14T10:00:00' }], { column: 't', unit: 'iso' });
// { status: 'naive-values', count: 1, points: [] } — never read as UTC

// The run clock: the run's zone wins, the builder's is a fallback, with neither it is unknown.
draftClock({ now: '2026-10-09T15:40:00Z' }, { zone: 'America/Los_Angeles' });
// { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles', zoneSource: 'builder' }
draftClock({}, {}); // { zone: 'UTC', zoneSource: 'unknown' } — asked, never guessed (G15)

// "to 8:40", read to the end of its minute, shown to the person as 08:40.
presentRange(asked, { zone: 'America/Los_Angeles' }, 'minute');
// '2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)'
presentRange(asked, { zone: 'America/Los_Angeles', locale: 'en-US' }, 'minute');
// 'Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT' — the reader's language

// The time ask: one judge of an answer, a reason from the catalog.
checkTimeAnswer('time-range', '2026-10-09T08:41-07:00/2026-10-09T08:00-07:00');
// { problem: 'out-of-order', facts: { from: …, to: … } } → re-asked, never taken
checkTimeAnswer('instant', '2026-03-08T02:30-08:00', 'America/Los_Angeles'); // { problem: 'dst-gap', … }

// A reader's parts, resolved: '10/09/26' has three orders; the default policy asks.
const clock = { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles' };
const res = resolveMention([{ date: { kind: 'numeric', fields: [10, 9, 26] } }], clock, {
  id: 'fixture',
  kind: 'rule',
});
chooseReading(res, DEFAULT_TIME_POLICY, 'rule'); // { by: 'open', remaining: [0, 1, 2], open: ['date-order'] }
chooseReading(res, { dateOrder: 'MDY', year: 'ask' }, 'rule');
// { by: 'policy', candidate: 0, policy: { dateOrder: 'MDY' } } — assumed, recorded
const parts = { date: { kind: 'numeric', fields: [10, 9, 26] } } as const;
checkReading('errors on 10/09/26', { mentions: [{ quote: '10/9/26', parses: [parts] }] }, 'fixture');
// [{ refused: 'quote-not-in-text' }] — never a quote the person did not write
```

Through an agent ([`examples/features/81-run-clock.ts`](../../examples/features/81-run-clock.ts)):

```ts
const agent = Agent.create({ provider, model })
  .tool(backupFailures)
  .time({ zone: 'America/Los_Angeles' }) // the fallback; each run's own zone wins
  .limitsTravelWithTheAnswer()
  .build();
await agent.run({ message, time: { now: message.sentAt, zone: session.zone } });
agent.findings(); // [{ kind: 'clock', now, nowSource: 'app', zone, zoneSource: 'run', … }, { kind: 'call', dispatchedAt, … }]
```

With a reader ([`examples/features/82-time-reader.ts`](../../examples/features/82-time-reader.ts)):

```ts
Agent.create({ provider, model })
  .time({ zone: 'America/Los_Angeles', reader: myReader, policy: { dateOrder: 'MDY' } })
  .build();
// agent.findings() → … { kind: 'time-reading', quote: '10/09/26 8 AM to 8:40 AM', candidates: [...],
//   choice: { by: 'open', remaining: [0], open: ['confirm'], policy: { dateOrder: 'MDY' } },
//   reader: {...}, tzdata: '2025b' } — the policy narrowed it; the person still confirms it
```

The English reader through an agent ([`examples/features/86-english-time-reader.ts`](../../examples/features/86-english-time-reader.ts)):

```ts
Agent.create({ provider, model }).tool(clientActivity)
  .time({ zone: 'America/Los_Angeles', reader: englishTimeReader() })
  .build();
englishTimeReader().read('what failed yesterday morning?', { locale: 'en-US' });
// { mentions: [{ quote: 'yesterday morning', parses: [], problem: 'unreadable' }] }
// "Any client activity yesterday?", the model leaves the period out → nothing served yet; paused:
//   'Is this the time you meant by “yesterday”?' — one pre-filled choice labelled
//   'I read “yesterday” as Thu, Oct 8, 2026, PDT in America/Los_Angeles — is that right?'
//   resume with it → { kind: 'time-answer', mention: 0, from, to, zone, how: 'confirmed' }; the
//   next request's client_activity description ends: 'Time words in the person's message, as the
//   library holds them: “yesterday” → start_time 1791442800000, end_time 1791529200000 (the window
//   the person confirmed when asked what their words meant); a call may pass these values as written.'
// "Show client activity 10/09/26 8 AM to 8:40 AM PST", the model leaves the period out →
//   paused: 'Which time zone did you mean by “PST” in “10/09/26 8 AM to 8:40 AM PST”?' (format: 'zone')
//   resume { f1: 'America/Los_Angeles' } → paused: 'Is this the time you meant by …?' — three
//   labelled readings ('I read “…” as Fri, Oct 9, 2026, 8:00 – 8:40 AM PDT in America/Los_Angeles
//   — is that right?', …); resume with the first → the tool runs with
//   { start_time: 1791558000000, end_time: 1791560460000 }, rows `answered`
```

The time ask through an agent ([`examples/features/83-time-ask.ts`](../../examples/features/83-time-ask.ts)):

```ts
execute: () => requestInput({
  id: 'window', question: 'Which window should the search cover?',
  fields: [{ id: 'window', type: 'string', format: 'time-range' }],
}),
// agent.resume(cp, { requestId, values: { window: '2026-10-09T08:40-07:00/2026-10-09T08:00-07:00' } })
// → paused again: awaitingInput.refused = { answer: {…}, reason: 'The start … is not before the end ….' },
//   awaitingInput.repeat = { count: 1 } — nothing ran
```

A tool's period forms through an agent ([`examples/features/84-tool-period-forms.ts`](../../examples/features/84-tool-period-forms.ts)):

```ts
defineTool({
  name: 'client_activity',
  inputSchema: { type: 'object', properties: { start_time: { type: 'integer' }, end_time: { type: 'integer' } } },
  askOrAssume: { start_time: { ask: 'From when?' }, end_time: { ask: 'Until when?' } },
  period: {
    forms: [{ kind: 'bounds',
              from: { argument: 'start_time', as: 'epoch-ms' },
              to:   { argument: 'end_time',   as: 'epoch-ms', edge: 'exclusive' } }],
    direction: 'past', retention: '30d',
  },
  execute: (args, ctx) => query(args, ctx.time?.asked), // ctx.time = { version, asked, zone, now, dispatchedAt }
});
// "10/09/26 8 AM to 8:40 AM": the person confirms the reading in the time ask; a later call of the
//   turn leaves the period out → the tool runs with { start_time: 1791558000000, end_time: 1791560460000 };
//   agent.findings() → … { kind: 'argument', argument: 'start_time', source: 'answered', matched: 'mention' },
//                       { kind: 'call-window', how: 'filled', form: 0, asked: {…}, person: { …, source: 'answered', mention: 0 } }
convertExact({ range: asked }, sugarForms({ argument: 'w', spelling: 'iso-range' }), clock);
// { form: 0, values: { w: '2026-10-09T08:00:00-07:00..2026-10-09T08:40:59-07:00' } } — inclusive end, to the second
```

Wider than asked, refused, drifted ([`examples/features/85-time-widen-and-refuse.ts`](../../examples/features/85-time-widen-and-refuse.ts)):

```ts
import {
  convertExact, convertForTool, convertWidened, granularityMsOf, periodFactProblem, sugarForms,
} from 'agentfootprint/time';

// An app's preview: the run's own question over the tool's own `period` (sugar, facts, step):
const period = { argument: 'w', spelling: 'lookback', direction: 'past', maxRange: '24h' } as const;
convertForTool({ range: yesterday }, sugarForms(period), period,
  { now, zone, granularityMs: granularityMsOf(period) });
// { refused: 'no-form-holds' } — what the run files for this tool (below)

// "yesterday" to a look-back-only tool (now 2026-10-09T15:40Z, Los Angeles):
convertExact({ range: yesterday }, [{ kind: 'lookback', argument: 'w', signed: false }], clock);
// undefined — a look-back ends at now, so none holds yesterday exactly
convertWidened({ range: yesterday }, [{ kind: 'lookback', argument: 'w', signed: false }], clock);
// { form: 0, values: { w: '1960m' }, sent: { from: '2026-10-08T07:00:00Z', to: '2026-10-09T15:40:00.001Z' },
//   extra: [{ from: '2026-10-09T07:00:00Z', to: '2026-10-09T15:40:00.001Z' }] }
periodFactProblem(yesterday, { direction: 'future' }, clock.now);
// 'time-past' — the code the refusal below names; undefined when no declared fact is broken
// A window still to come, sent to `period: { …, direction: 'past' }`:
//   { kind: 'call-window', how: 'refused', refused: 'time-future', asked: {…} } — the tool never ran
// The same "yesterday" to a look-back tool that reads at most a day at once — no form reaches it:
convertForTool({ range: yesterday }, [lookback], { maxRange: '24h' }, clock);
// { refused: 'no-form-holds' } — the call is refused; its `assume: '1h'` never runs
driftAtDispatch({ how: 'filled', form: 0, asked }, [lookback, epochBounds],
  { now, dispatchedAt: thirtyMinutesLater, granularityMs: 60_000, zone });
// { byMs: 1800000, outcome: 'redrawn', form: 1, values: { start: …, end: … } }
```

Read against asked ([`examples/features/88-time-result-checks.ts`](../../examples/features/88-time-result-checks.ts)):

```ts
// The person's 30 days; the tool clamped its read to the last 7 and declared so:
periodTimeCheck({
  window: { how: 'filled', asked: { from: '2026-09-09T15:40:00Z', to: '2026-10-09T15:40:00Z' } },
  declared: [{ from: '2026-10-02T15:40:00Z', to: '2026-10-09T15:39:59.999Z' }], // inclusive ends
  now: '2026-10-09T15:40:00Z',
});
// { differs: { against: 'asked', source: 'declared', stepMs: 1, read: [ … ],
//              missing: [{ from: '2026-09-09T15:40:00Z', to: '2026-10-02T15:40:00Z' }], extra: [] } }
// → the call's `period` row carries it; the answer's standing folds `period-differs-from-asked`
//   ("not sure"), and the limits block says, in the person's zone:
//   "client_activity read less than was asked — asked: 2026-09-09 08:40:00 – 2026-10-09 08:39:59
//    America/Los_Angeles (UTC-07:00); read: 2026-10-02 08:40:00 – …"
```
