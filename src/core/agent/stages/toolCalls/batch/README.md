**Mixed** — the existing paused-batch projections and settlement helpers.
Fold: `paused.ts` recovers arguments and projects the undispatched siblings.
Walker: `settle.ts` appends a landed result to the current batch.
Lens: `settle.ts` composes the existing sentence for an undispatched sibling.

The stage passes scope and call facts explicitly. Neither file owns a second
batch ledger or dispatcher. The existing stage path re-exports its public
paused-batch type and helper functions.

Every batch refuses tool-call IDs the private binding cannot represent before
any question or tool dispatch: non-primitive values and accessor IDs are never
coerced into correlation keys. Refusal is framework feedback for the whole batch.
Other finite checkpoint call bounds apply only when the batch needs an argument
or time ask. Ordinary non-asking batches with supported primitive IDs retain their existing
per-call semantics, including numeric, empty, duplicate and long IDs.
