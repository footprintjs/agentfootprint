**Support** — the time layer's one owner of every time grammar: instants, durations, zones and ranges. It decides nothing about what the model may see; the folders that read time ask it instead of keeping their own grammar.

# `core/time/` — one owner for time

**The law.** Time has one grammar, and it lives here: no other file parses an instant, a
duration or a zone, or splits or joins a range.

Before this folder the library held three time grammars written separately, and they disagreed:
a result's period accepted a lower-case `t` and the leap second, an `iso-range` argument accepted
30 February (`Date.parse` rolled it to 2 March), and a look-back and a dataset's interval
disagreed about seconds. Two owners of one grammar drift; this folder is the one owner. The
design, with the plan this folder grows by, is [docs/design/time/](../../../docs/design/time/README.md).

It is a leaf: it imports nothing outside itself (pinned by
`test/core/time/byte-identity-rows.test.ts`).

| File | Owns |
|---|---|
| `instant.ts` | the one instant parser, `instantOf(value, profile)`, with two named profiles: `lenient` (RFC 3339 as a foreign minter may write it — a period a result declares) and `strict` (upper-case `T`/`Z`, no leap second — a value the library sends to a tool). Plus `compareInstants`, `shiftInstant`, `spellInstant`, `toUtc` |
| `duration.ts` | the one duration grammar `^[1-9][0-9]*[smhdw]$`, no digit cap, with a unit set named per use (`LOOKBACK_UNITS` = `mhdw`, `AXIS_UNITS` = `smhdw`); `durationMs`, `spellDuration` (the smallest exact spelling) |
| `zone.ts` | IANA zone names through `Intl` (an abbreviation such as `PST` and a bare offset are refused, although `Intl` takes them), `offsetAt`, `wallAt`, and wall time → instant under Temporal's four DST words (`readWall`, `wallToInstant`) |
| `axis.ts` | a dataset's declared time axis (`DatasetTimeAxis`, moved from `artifacts/timeAxis.ts`; `artifacts/index.ts` re-exports it): the one judge `timeAxisIssues` (the interval is a duration under `AXIS_UNITS`, the zone a zone name), `readTimeAxis`, `describeTimeAxis`, and the read-side view `normaliseInstants` — UTC instants at one precision, sorted, with every unplaced value counted (`naive`, `dstAmbiguous`, `dstGap`, `unreadable`, `missing`) |
| `range.ts` | `TimeRange` (half-open `[from, to)`), its two spellings (`parseRange` / `spellRange` — the ISO 8601 interval `from/to` and the joined `from..to`; `splitRange` is the format check), one conversion per boundary a range crosses (`fromInclusive` / `toInclusive`, `boundInto` / `boundFrom`, `lookbackRange` / `lookbackOf`), `covers`, `overlaps`, `roundOutward` |
| `clock.ts` | the run clock (§ 4): `TimeClock { now, nowSource, zone, zoneSource }`; the two inputs read or refused by name — the run's `time: { now, zone, window }` (`readRunTime`) and the builder's `.time({ zone })` (`readTimeOptions`); `draftClock` (the run's zone wins, the builder's is a fallback, neither is `'no-zone'`), `completeClock` (`now` is the app's, else the turn's start: `nowSource: 'default'`), `clockChange` (what a resume passed that differs from the kept clock) |
| `reader.ts` | the `TimeReader` port (`id`, `version`, `locale`, `kind: 'rule' \| 'model'`, `read`) and its result, `TimeParts` — zone-less parts, never instants; `readerIssue` (the builder's check) and `checkReading` (a quote must be a verbatim substring of the text; parts well formed; a refused mention keeps no text) |
| `resolve.ts` | parts + clock + policy → every candidate window (`resolveMention`: date orders, am/pm, the year, both instants of a DST overlap or gap, a day word, a look-back, a range read to the end of its grain, a said IANA zone or offset — an abbreviation is asked, never mapped), and `chooseReading` (`only` · `policy` · `open` with its questions · `none`); the v1 `TimePolicy` (`dateOrder`, `year`, both `'ask'` by default); the checks for a recorded candidate and choice |
| `convert.ts` | a tool's period FORMS (§ 7.1: `bounds` · `joined` · `object` · `day` · `lookback`, each bound `iso` · `epoch-ms` · `epoch-s` · `date` · `wall`) and the facts about its source (`PeriodFacts`); the sugar (`sugarForms` — today's `{ argument, spelling }`, `accepts`, `wall-range` + `zoneArgument`); one form's own rules (`formIssue`, `formArguments`, `parsesUnderForm`); the EXACT rows of § 7.2 (`convertExact`) and the inverse a binding reads (`readBack`, `sameRange`); a range against the facts (`periodFactProblem`) |
| `bind.ts` | which window a call carries (§ 5.6, § 7.3): the turn's windows read from the record (`turnWindowsOf` — a settled `time-reading` mention, the clock's `control` window) and one call's decision (`callWindowOf`: `filled` · `bound` by quote or value · `model-chosen` · `model` · `unread` · `not-filled`) |
| `wire.ts` | the JSON that crosses a transport (§ 7.5): `TimeContext` — `ctx.time` in process, the `tools/call` request's `_meta.agentfootprint.time` over MCP — versioned (`timeContextOf`, `readTimeContext`) |
| `rows.ts` | the layer's five ledger rows and the checkpoint door's test for each (`timeRowIsWellFormed`): `clock` (one per turn, filed by seed), `clock-on-resume` (a resume's differing `time`, recorded not applied), `call` (one per dispatched call, `dispatchedAt`), `time-reading` (one per mention the armed reader found, or one `mentions: 0` row; `timeReadingRows` builds them, `readingsOf` reads a turn's back), `call-window` (one per call to a tool whose period declares forms, filed by the inputs layer — `callWindowRow`, read back by `callWindowOfCall`); `clockOf` reads the latest turn's clock |
| `present.ts` | time for a PERSON: `presentInstant`, `presentSpan` (two inclusive ends, as declared), `presentRange` (a half-open range with the end AS SAID — `[08:00, 08:41)` at minute grain shows `08:40`); locale-neutral with no locale, the zone always named, each end's offset when a span crosses a DST change; with a `locale` (the reader's) through `Intl` in that language, the zone's short name |
| `ask.ts` | the one time ask (§ 6): `TimeFormat` (`instant` · `time-range` · `zone`), `checkTimeAnswer` — the ONE judge of a time field's answer (strict instants with an offset, `from` before `to`, an IANA zone, under a known zone no wall time the clocks skip, and — handed a tool's facts and the clock — inside its `direction`, `retention` and `maxRange`) — refusals as codes with facts; the catalog's keys (`TIME_ASK_MESSAGE_KEYS`), `readTimeAskMessages` (the app's overrides), `refusalReason` (the re-ask's reason); `timeAskOf` — the field an `open` reading needs (the candidates as labelled choices, a zone asked as `format: 'zone'`, a `model` reading offered to confirm) |

`core/inputRequest.ts` asks `ask.ts`: a field's `format` is judged at definition (each choice, each
supplied value) and at the resume door (`applyInputResponse`, the person's answer — a refused one
comes back as the same ask with `refused` and `repeat`); `Agent.resume` hands it the paused turn's
clock zone and the app's `.time({ messages })`. The sentences live in `src/locales/timeAsk.ts`
(`defaultTimeAskMessages`), and `lib/mcp/elicitation.ts` carries the ask over MCP.
Who asks it today: `coverage/period.ts` reads a declared period's instants through
`instant.ts` · `instantOf` in the lenient profile (`periodVerdict` is unchanged, inclusive at both
ends) and, under `.time()`, renders `periodLine` through `present.ts` in the run's zone;
`Agent.run` / `Agent.resume` read the run's `time` through `clock.ts` (refusing a run with no zone
before the turn starts); `stages/seed.ts` · `stampClock` files the turn's `clock` row;
`stages/toolCalls.ts` files each `call` row and, first thing in a resumed leg (either pause
shape: the `resume` door, or `execute` re-run after the argument ask's `interrupt()`),
`clock-on-resume`;
`stages/seed.ts` · `readTimeWords` reads the person's message through the armed reader, right
after the clock, and files the `time-reading` rows;
`core/runCheckpoint.ts` · `ledgerRowIsWellFormed` routes the four kinds to `rows.ts`; `arguments/declare.ts` · `parsesUnderSpelling` reads a look-back through `duration.ts` and
an `iso-range` through `range.ts` · `splitRange` in the strict profile; `artifacts/minting.ts` ·
`prepareArtifact` and `artifacts/datasetResult.ts` · `stageDatasetArtifacts` judge a dataset's
axis through `axis.ts` · `timeAxisIssues`. From the package: `axis.ts` (through
`artifacts/index.ts`, where datasets live), and — since the run clock (step T3) — the clock's types
(`RunTime`, `TimeClock`, `TimeOptions`, `TimeRange`, and the three row types) from the main barrel;
since the reader (step T6a) also the port's types (`TimeReader`, `TimeParts`, `TimeReading`, …),
the resolver's (`TimeCandidate`, `ResolvedWindow`, `ReadingChoice`, `TimePolicy`, …) and
`TimeReadingRow`; since the ask (step T4) its types (`TimeFormat`, `TimeAnswerProblem`,
`TimeAskMessageKey`, `TimeAskMessages`) and the catalog `defaultTimeAskMessages` (also from
`agentfootprint/observe`, beside the other catalogs); the doors are `AgentBuilder.time`,
`run({ time })` and `InputField.format`. The grammar functions stay internal.

**The clock law: a declared, recorded input, never a hidden read.** `.time()` arms it. The zone is
per run (`run({ time: { zone } })`), the builder's `.time({ zone })` a fallback, and with neither
the run is refused — never the server's zone. `now` is the app's, else the turn's start, recorded
`nowSource: 'default'`. Seed files one `clock` row per turn, after the turn number is final; it is
never written again that turn. A resume that passes a different `time` keeps the frozen clock and
files `clock-on-resume { passed, kept }`. A turn `run()` did not start (the agent's chart mounted
in a composition, which passes no `time`) stamps the builder's fallback as a default, or is refused
without one — the draft a `run()` read ends with that `run()`. The layer reads the wall clock at exactly two points, both
recorded: a default `now`, and each call's `dispatchedAt`. A zone is recorded as the app wrote it —
`Intl`'s canonical form can be an older link (`Asia/Kolkata` → `Asia/Calcutta`). The rows fire no
event (the record is the reader's); nothing is served to the model.

**The reading law: a strategy tokenizes, the library resolves, the policy or the person
chooses.** The library reads a person's words only through a reader the app armed
(`.time({ reader })`, no default), and only the message a person wrote (`lib/saidByPerson.ts` ·
`isSaidByPerson`; a composed run's message is another runner's output and is never read). The
reader returns PARTS — `10/09/26` is three numbers, the order undecided — and a verbatim quote,
which is checked. `resolve.ts` writes every candidate the parts allow, each tagged with how it
read them; the policy (`dateOrder`, `year`) only removes readings, and a removal is recorded
(`choice.by: 'policy'`); a DST overlap or gap, a missing meridiem and a zone abbreviation are never
settled by the library (`open`). The reader runs ONCE per message: seed files the rows, and a
resume or a `resumeOnError` retry of the same turn finds them and does not call it again — a
message with no mention files one `mentions: 0` row for exactly that reason. A `kind: 'model'`
reader's candidates are never `said`, and even a single window stays `open` until the person
confirms it (`confirm`). Each row records the reader's id, version, kind and locale and the tz
database version (`zone.ts` · `tzdataVersion`), because either can change between releases.

**The ask law: the library checks a time answer before the app sees it, and says why in words
the app can replace.** A `requestInput` field with a `format` is a time field; its answer is judged by
`checkTimeAnswer` at the resume door — the same judge that refused a malformed choice at definition.
A refused answer is not taken: the ask comes back with `refused: { answer, reason }` and
`repeat: { count }`, the field `missing` again, and nothing runs (no model call, no row: the run never
restarted). The reason is a catalog sentence, and only a check the app armed can produce one (a
`format`, or the DST check under `.time()`, which knows the person's zone). A reading's choices are
offered as labelled `enum` values in the reader's locale, free entry open unless `strict`; a
`model` reader's window is offered as the library's reading to confirm, never as the person's words.

**The period law: the library writes the person's window into a tool's own arguments only
exactly, and never over the model's.** A tool DECLARES every shape its period takes (`forms`, today's
`{ argument, spelling }` its shorthand) and facts about its source — never policy. Under `.time()`
the inputs layer (`arguments/resolve.ts` · `timeDecisionsOf`) asks `bind.ts` once per call: the
model left every period argument out and the turn holds exactly ONE window of the person's (a
settled mention, or the UI's `time.window` — two mentions fill nothing) → the window goes into the
first form that holds it exactly (`convertExact`: an epoch-seconds bound or a look-back's length
rounds OUTWARD, recorded `rounded`; a form that would widen, shift or drop part of it is never
chosen) and the arguments are filed as the person's (`said` + `matched: 'mention'`; a `model`
reader's window as a reading, `reading: true`; a UI window as `app`, `appSource: 'time.window'`).
A window the model sent runs as sent: bound to the person's window by the quote it declared (then
filed `said` + `matched: 'mention'`) or by value, else recorded `model-chosen` beside the person's
— a drill-down and a comparison are normal work, and the standing reads "not sure". One
`call-window` row per call says which; `ctx.time` (`wire.ts`) hands the tool the range the call asks
for, read off that row, with the zone, the frozen `now` and the dispatch moment.

**The presentation law: a label is never data.** `present.ts` renders for a person — the typed
record keeps the instants. With no reader armed (a later step) the form is locale-neutral:
`2026-10-09 08:00–08:40 America/Los_Angeles (UTC-07:00)`.

**The axis law: a value with no known clock is never read as UTC.** `normaliseInstants` is a
read-side view: it reads the rows and never writes them. An ISO value with no offset under an
axis with no `zone` is counted (`status: 'naive-values'`), or the whole view is refused under
`{ naive: 'refuse' }`. Under a declared `zone`, values are wall times; in the hour the clocks go
back, the rows' order places a doubled wall time (the values before the wall clock steps back take
the earlier offset, the rest the later, each noted `{ kind: 'dst-overlap', resolvedBy: 'row-order'
}`), and a value the order cannot place — a lone `01:30`, rows not in time order — is counted
`dstAmbiguous`, like a naive one. A skipped wall time is counted `dstGap`.

## Example

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

// The run clock: the run's zone wins, the builder's is a fallback, neither is refused.
draftClock({ now: '2026-10-09T15:40:00Z' }, { zone: 'America/Los_Angeles' });
// { now: '2026-10-09T15:40:00Z', zone: 'America/Los_Angeles', zoneSource: 'builder' }
draftClock({}, {}); // 'no-zone' — the Agent refuses the run

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

Through an agent (`examples/features/81-run-clock.ts`):

```ts
const agent = Agent.create({ provider, model })
  .tool(backupFailures)
  .time({ zone: 'America/Los_Angeles' }) // the fallback; each run's own zone wins
  .limitsTravelWithTheAnswer()
  .build();
await agent.run({ message, time: { now: message.sentAt, zone: session.zone } });
agent.findings(); // [{ kind: 'clock', now, nowSource: 'app', zone, zoneSource: 'run', … }, { kind: 'call', dispatchedAt, … }]
```

With a reader (`examples/features/82-time-reader.ts`):

```ts
Agent.create({ provider, model })
  .time({ zone: 'America/Los_Angeles', reader: myReader, policy: { dateOrder: 'MDY' } })
  .build();
// agent.findings() → … { kind: 'time-reading', quote: '10/09/26 8 AM to 8:40 AM', candidates: [...],
//   choice: { by: 'policy', candidate: 0, policy: { dateOrder: 'MDY' } }, reader: {...}, tzdata: '2025b' }
```

The time ask through an agent (`examples/features/83-time-ask.ts`):

```ts
execute: () => requestInput({
  id: 'window', question: 'Which window should the search cover?',
  fields: [{ id: 'window', type: 'string', format: 'time-range' }],
}),
// agent.resume(cp, { requestId, values: { window: '2026-10-09T08:40-07:00/2026-10-09T08:00-07:00' } })
// → paused again: awaitingInput.refused = { answer: {…}, reason: 'The start … is not before the end ….' },
//   awaitingInput.repeat = { count: 1 } — nothing ran
```

A tool's period forms through an agent (`examples/features/84-tool-period-forms.ts`):

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
// "10/09/26 8 AM to 8:40 AM", the model leaves the period out →
//   the tool runs with { start_time: 1791558000000, end_time: 1791560460000 };
//   agent.findings() → … { kind: 'argument', argument: 'start_time', source: 'said', matched: 'mention' },
//                       { kind: 'call-window', how: 'filled', form: 0, asked: {…}, person: { …, source: 'said', mention: 0 } }
convertExact({ range: asked }, sugarForms({ argument: 'w', spelling: 'iso-range' }), clock);
// { form: 0, values: { w: '2026-10-09T08:00:00-07:00..2026-10-09T08:40:59-07:00' } } — inclusive end, to the second
```

## What changed when the grammars moved here (the design's § 12.1)

| # | Behaviour | Now |
|---|---|---|
| a | an `iso-range` value naming a day past its month's end (`2026-02-30T08:00Z..…`) | **refused** — `Date.parse` used to roll it forward; a tool was sent an instant nobody asked for |
| b | an `iso-range` value at hour `24` | **refused**, the same reason |
| c | lower-case `t`/`z` or the leap second `:60` in an argument | still refused (the strict profile); still accepted in a declared period (the lenient profile) |
| d | a look-back with many digits (`1000000m`) | still accepted — no digit cap |
| e | a look-back in seconds (`30s`) | still refused unless the use names `s` in its unit set |
| d (axis, T2) | a dataset `interval` with more than six digits (`1000000m`) | **accepted** — the axis's shipped cap went with the merge |
| T2 | a dataset `zone` that `Intl` takes but is not an IANA name (`PST`, `EST`, `+05:30`, `utc`, `EST5EDT`) | **refused at mint**; a ticket minted earlier with one reads `malformed` |

## Not covered yet

- The inexact rows of § 7.2 (a covering look-back, a `day` wider than the window, `filtersToAsked`),
  the dispatch drift of § 7.4 and the pre-dispatch refusals (outside `direction`, wholly beyond
  `retention`, over `maxRange`, a multi-day range to a `day` tool, a wall DST gap) are the next step
  (T5b): today a window no form holds exactly is not filled, and the tool's own rule applies. The
  facts already join the answer's check (`checkTimeAnswer`, and the batch ask's period answer).
- The lazy word-driven ask (§ 5.2) is not raised yet: an `open` reading fills nothing and the tool's
  own `askOrAssume` rule asks, as before; `ask.ts` · `timeAskOf` builds the field it will raise with
  the English reader (T6b). A turn with no time words does not carry the last window yet
  (`time-carried`, § 5.6). The English reader (T6b), the lineage (T7) and the result checks and
  their fold reasons (T8) are later steps; a `model-chosen` window folds through the argument row
  (`argument-unverified`) until T8's reason.
- Over MCP a time field with choices travels as the choices plus the free-entry properties (a
  person answers one or the other); MCP has no range, so a range is two `date-time` properties.
- v1 resolves a day word only (`today`, `yesterday`, `tomorrow`); a part of the day, a calendar
  week, month or year, and a window anchored on the previous one are named `unsupported`. A
  resumeOnError retry keeps the first attempt's reading, resolved against that attempt's clock.
- A clock is stamped once per RUN: `resumeOnError` and a continued conversation are new runs and
  stamp their own (a pause-and-resume is the one frozen case).
- The axis's `interval` is checked for shape only; nothing yet checks the rows' spacing against
  it, and the chart domain rule of the design's § 8 (one call's asked period) belongs to the
  consumers.
- A calendar day or week in a zone: `roundOutward` counts steps from the epoch in UTC.
