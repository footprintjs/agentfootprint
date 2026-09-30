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
| `rows.ts` | the layer's three ledger rows and the checkpoint door's test for each (`timeRowIsWellFormed`): `clock` (one per turn, filed by seed), `clock-on-resume` (a resume's differing `time`, recorded not applied), `call` (one per dispatched call, `dispatchedAt`); `clockOf` reads the latest turn's clock |
| `present.ts` | time for a PERSON: `presentInstant`, `presentSpan` (two inclusive ends, as declared), `presentRange` (a half-open range with the end AS SAID — `[08:00, 08:41)` at minute grain shows `08:40`); locale-neutral, the zone always named, each end's offset when a span crosses a DST change |

Who asks it today: `coverage/period.ts` reads a declared period's instants through
`instant.ts` · `instantOf` in the lenient profile (`periodVerdict` is unchanged, inclusive at both
ends) and, under `.time()`, renders `periodLine` through `present.ts` in the run's zone;
`Agent.run` / `Agent.resume` read the run's `time` through `clock.ts` (refusing a run with no zone
before the turn starts); `stages/seed.ts` · `stampClock` files the turn's `clock` row;
`stages/toolCalls.ts` files each `call` row and, first thing in a resumed leg (either pause
shape: the `resume` door, or `execute` re-run after the argument ask's `interrupt()`),
`clock-on-resume`;
`core/runCheckpoint.ts` · `ledgerRowIsWellFormed` routes the three kinds to `rows.ts`; `arguments/declare.ts` · `parsesUnderSpelling` reads a look-back through `duration.ts` and
an `iso-range` through `range.ts` · `splitRange` in the strict profile; `artifacts/minting.ts` ·
`prepareArtifact` and `artifacts/datasetResult.ts` · `stageDatasetArtifacts` judge a dataset's
axis through `axis.ts` · `timeAxisIssues`. From the package: `axis.ts` (through
`artifacts/index.ts`, where datasets live), and — since the run clock (step T3) — the clock's types
(`RunTime`, `TimeClock`, `TimeOptions`, `TimeRange`, and the three row types) from the main barrel;
the doors are `AgentBuilder.time` and `run({ time })`. The grammar functions stay internal.

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

- The person's words (a reader, T6a), the ask (T4), tool conversions and `ctx.time` (T5), the
  checks (T8) — later steps of the plan (§ 13); each adds a file here. Until the reader, the
  presentation has no locale and the clock resolves no words: it is recorded, and the `Period:`
  lines are rendered in its zone.
- A clock is stamped once per RUN: `resumeOnError` and a continued conversation are new runs and
  stamp their own (a pause-and-resume is the one frozen case).
- The axis's `interval` is checked for shape only; nothing yet checks the rows' spacing against
  it, and the chart domain rule of the design's § 8 (one call's asked period) belongs to the
  consumers.
- A calendar day or week in a zone: `roundOutward` counts steps from the epoch in UTC.
