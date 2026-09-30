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

Who asks it today: `coverage/period.ts` reads a declared period's instants through
`instant.ts` · `instantOf` in the lenient profile (`periodVerdict` is unchanged, inclusive at both
ends); `arguments/declare.ts` · `parsesUnderSpelling` reads a look-back through `duration.ts` and
an `iso-range` through `range.ts` · `splitRange` in the strict profile; `artifacts/minting.ts` ·
`prepareArtifact` and `artifacts/datasetResult.ts` · `stageDatasetArtifacts` judge a dataset's
axis through `axis.ts` · `timeAxisIssues`. Only `axis.ts` is exported from the package (through
`artifacts/index.ts`, where datasets live); the rest of the public time surface arrives with the
run clock (step T3).

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

- The run clock, the person's words, the ask, tool conversions, the checks — later steps of the
  plan (§ 13); each adds a file here.
- The axis's `interval` is checked for shape only; nothing yet checks the rows' spacing against
  it, and the chart domain rule of the design's § 8 (one call's asked period) belongs to the
  consumers.
- A calendar day or week in a zone: `roundOutward` counts steps from the epoch in UTC.
