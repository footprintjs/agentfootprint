# servedView/ — saved request reconstruction

This library is sealed by `../servedView.ts`. That facade retains the public
types, entry functions and catalogue bindings. Other source folders use the
facade; private modules import one another directly, without a barrel.

The first split moves complete units: `recordReads.ts` owns the existing
stored-value reads, `gaps.ts` owns the frozen catalogue, and `value.ts` owns
detachment and freezing. `assembly.ts` temporarily retains the whole epoch
assembly, and `savedValues.ts` temporarily retains its shape narrowers. The
next commit splits the assembly into domain projections; the whole-unit move
is not the completed change.

The contract walk reads public types from the facade, catalogue prose from
`gaps.ts`, and every `gapOf` call from the single `assembly.ts` producer
`viewOf`. It refuses computed kinds and calls outside that producer.

Step 4 does not apply to these readers: `servedAt`, `servedViews` and
`receiptAt` are synchronous pure operations over a saved record, with no
effects or retry work. Their decisions are returned as gaps and pieces.
A chart run would add asynchronous execution to an API that stays
synchronous, so this library retains pure functions and no flowchart.
