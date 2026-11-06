# Trace — time row contracts

`../rows.ts` is the synchronous facade for builders, ledger queries, the closed
row-kind router and checkpoint validation. This sealed folder owns the row
interface and union types. `meaning.ts` validates the closed canonical correction
projection against the interval through the shared duration and instant grammars.
It loads no English reader, reply parser or resolver, and has no runtime edge back
to the facade.

The existing type names remain available through `rows.ts`. The additive
`TimeReplyRow` carries only the reply decision, fixed rule label and time-row
coordinates. It carries no correction text, parser output or new raw mirror.
The facade validates that closed shape alongside the existing time rows. A
`TimeAnswerRow.corrected` object keeps only the accepted canonical lookback, when
one was confirmed, or an empty object for an absolute corrected interval. Absence
retains the legacy fold; presence prevents reuse of the superseded raw quote.

Reading builders that invoke the resolver stay in `../rowsBuild.ts`, outside
the synchronous checkpoint graph. Adjacent pure meaning and reply-record tests
cover the bounded metadata; native time and checkpoint suites cover its integration.
