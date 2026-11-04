**Fold** — reconstruct one saved request and name what the record cannot prove.

# servedView/ — saved request reconstruction

This library is sealed by `../servedView.ts`. That facade retains the public
types, entry functions and catalogue bindings. Other source folders use the
facade; private modules import one another directly, without a barrel.

`assembly.ts` wires the phases in their original read order and constructs
the final value. The private owners are:

- `recordReads.ts`: existing stored-value reads and receipt narrowing.
- `system.ts`: initial system inputs and ordered pieces, with no early join.
- `conversation.ts`: history/messages-injections selection and stripping.
- `findings.ts`: saved layout admission, legacy piece and collapse.
- `ontology.ts`: the recorded map and its hidden-skill selection.
- `tools.ts`: withheld, lazy schema fallback and forced-tool selection.
- `requestOnly.ts`: staged refs, time, conclusion and late findings DATA.
- `gaps.ts`: the frozen catalogue and ordered gap projection.
- `value.ts`: final detachment and freezing.

Each domain makes its own original fold reads. Explicit inputs and returned
phase tuples keep the wiring visible; there is no callback or generic read
context. Only final basis construction and the narrow gap projection read a
receipt. Request reconstruction never reads its receipt answer sheet.

The contract walk reads public types from the facade, catalogue prose from
`gaps.ts`, and every production TypeScript leaf in this folder for `gapOf`
calls. Its sole allowed producer is `gaps.ts`'s `gapsOf`; it refuses computed
kinds and calls outside that producer. Colocated tests are excluded.

Step 4 does not apply to these readers: `servedAt`, `servedViews` and
`receiptAt` are synchronous pure operations over a saved record, with no
effects or retry work. Their decisions are returned as gaps and pieces.
A chart run would add asynchronous execution to an API that stays
synchronous, so this library retains pure functions and no flowchart.
