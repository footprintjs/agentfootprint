# Trace — time row contracts

`../rows.ts` is the synchronous facade for builders, ledger queries, the closed
row-kind router and checkpoint validation. This sealed folder owns the row
interface and union types. Its imports are type-only; it loads no English
reader, reply parser or resolver, and has no runtime edge back to the facade.

The existing type names remain available through `rows.ts`. The additive
`TimeReplyRow` carries only the reply decision, fixed rule label and time-row
coordinates. It carries no correction text, parser output or new raw mirror.
The facade validates that closed shape alongside the existing time rows.

Reading builders that invoke the resolver stay in `../rowsBuild.ts`, outside
the synchronous checkpoint graph. Adjacent pure reply-record tests cover the
bounded metadata; native time and checkpoint suites cover its integration.
