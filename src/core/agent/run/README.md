**Mixed** — run support for the existing Agent class.
Map: event-stage identities in `eventStageIds.ts`.
Fold: ledger validation, engine-option projection and resume-policy reading in `ledgerFacts.ts`, `withoutTime.ts` and `resumeRedaction.ts`.

# Agent run support

These small modules support the Agent facade in `../../Agent.ts`. Native component values own invocation state; construction and chart wiring are being decomposed into their business families. The run-options type remains beside the documented receiver so its emitted documentation keeps its canonical link binding. Agent imports these leaves; the leaves never import Agent or AgentBuilder.

- `eventStageIds.ts` names events emitted outside a real stage.
- `ledgerFacts.ts` validates and resolves the findings-window dial.
- `clocks.ts` reads run-time inputs, seeds the kept clock and projects the answer time context.
- `withoutTime.ts` removes the engine-external time option while preserving absent-time identity.
- `resumeRedaction.ts` reads a carried policy and refuses an uncovered resume.

Runtime policy and error identities remain owned by the existing redaction and conversation modules. State and registration remain with their original owners.

- `injectionDelivery.ts` owns the complete pre-run injected-message validation unit extracted from Agent (size ratchet); behavior is unchanged.
