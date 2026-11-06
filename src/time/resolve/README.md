# Relative-zone resolution

`resolve.ts` is the internal public facade: it composes point/range candidates,
applies the existing selection policy, and re-exports the existing record API.
The sealed folder imports only existing time primitives and its own units,
never the facade, a core chart, model or application. No second time grammar or
engine is introduced.

| Unit | One job | Internal dependencies |
|---|---|---|
| `zones.ts` | Existing token-to-zone reads and provenance; IANA-only lookback display requirement | none |
| `wallClock.ts` | Existing wall/offset/DST instant and hour helpers | zones types |
| `calendar.ts` | Existing date readings and calendar-day arithmetic | none |
| `points.ts` | Existing expansion of one side into its dated clock points | calendar, wallClock, zones, types |
| `lookback.ts` | Existing frozen-anchor elapsed builder | zones, types |
| `types.ts` | Existing Built/refusal types | none |

This Stage A checkpoint moves complete helpers, constants and their types from
the oversized facade, with function bodies unchanged apart from the necessary
export modifiers. The facade is below 600 lines. It retains complete range-side
combination, candidate and selection units; this is no claim that their later
structural/behavior work has already happened. The separate approved reply
subflow and ask-policy change belong to Root's next checkpoint.

Elapsed instants remain `lookbackRange(frozenNow, duration)`, including now + 1 ms.
Calendar today/yesterday use the same date and zone functions and can name a
different instant range under another zone or DST. No query, confirmation,
refusal, provenance or native checkpoint behavior changes in this split.

The current candidate carrier is IANA-only. Its existing lookback code asks for
an IANA zone when a fixed offset has no Etc representation; it never borrows the
clock zone or silently drops a mapped alternative. `withZoneAnswered` remains
in the facade and handles that existing pending case. This capability policy is
unchanged by the move.

The adjacent `lookback.test.ts` and existing `test/time/resolve.test.ts`,
`test/time/reader-run.test.ts`, `test/time/english-run.test.ts` and
`test/security/linear-scanners.test.ts` exercise the same facade. Tests and all
new-head gates are Root's execution obligations; no prior proof is carried.
