**Mixed** — the existing paused-batch projections and settlement helpers.
Fold: `paused.ts` recovers arguments and projects the undispatched siblings.
Walker: `settle.ts` appends a landed result to the current batch.
Lens: `settle.ts` composes the existing sentence for an undispatched sibling.

The stage passes scope and call facts explicitly. Neither file owns a second
batch ledger or dispatcher. The existing stage path re-exports its public
paused-batch type and helper functions.

Only a batch that actually needs an argument or time ask is admitted against
the finite checkpoint call bounds. Its refusal is framework feedback before
dispatch. Non-asking model batches retain ordinary per-call dispatch semantics.
