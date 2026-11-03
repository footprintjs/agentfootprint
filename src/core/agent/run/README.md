**Mixed** — run support for the existing Agent class.
Map: event-stage identities in `eventStageIds.ts`.
Fold: ledger validation, engine-option projection and resume-policy reading in `ledgerFacts.ts`, `withoutTime.ts` and `resumeRedaction.ts`.
Walker: caller-owned Set eviction in `rememberedRuns.ts`.

# Agent run support

These small modules support the existing Agent class in `../../Agent.ts`. The class keeps its construction, state, execution, lazy loading and chart assembly during Stage A. The run-options type remains beside the class so its emitted documentation keeps its canonical link binding. Agent imports these leaves; the leaves never import Agent or AgentBuilder.

- `eventStageIds.ts` names events emitted outside a real stage.
- `ledgerFacts.ts` validates and resolves the findings-window dial.
- `rememberedRuns.ts` bounds a Set supplied by its caller.
- `withoutTime.ts` removes the engine-external time option while preserving absent-time identity.
- `resumeRedaction.ts` reads a carried policy and refuses an uncovered resume.

Runtime policy and error identities remain owned by the existing redaction and conversation modules. State and registration remain with their original owners.
