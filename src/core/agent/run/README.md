**Mixed** — run support for the existing Agent class.
Map: event-stage identities in `eventStageIds.ts`.
Fold: ledger validation, engine-option projection and resume-policy reading in `ledgerFacts.ts`, `withoutTime.ts` and `resumeRedaction.ts`.

# Agent run support

These small modules support the Agent facade in `../../Agent.ts`. Native component values own invocation state; construction and chart wiring are being decomposed into their business families. The run-options declaration and its documentation live in `../runtime/runOptions/options.ts`; the documented receiver preserves the same public type export. Agent imports these leaves; the leaves never import Agent or AgentBuilder.

- `eventStageIds.ts` names events emitted outside a real stage.
- `ledgerFacts.ts` validates and resolves the findings-window dial.
- `clocks.ts` reads run-time inputs, seeds the kept clock and projects the answer time context.
- `withoutTime.ts` removes the engine-external time option while preserving absent-time identity.
- `terminalRunError.ts` names the errors a crash checkpoint must not wrap.
- `outputStrategySupport.ts` refuses, at run start, an output strategy the provider cannot carry.
- `resumeRedaction.ts` reads a carried policy and refuses an uncovered resume.

Runtime policy and error identities remain owned by the existing redaction and conversation modules. State and registration remain with their original owners.

- `injectionDelivery.ts` owns the complete pre-run injected-message validation unit extracted from Agent (size ratchet); behavior is unchanged.

- `commitRunRedaction.ts` owns the complete seed-time checkpoint policy writer moved from seed: ordinary runs add nothing, private-only runs explicitly declare caller none.
- `resumeRedaction.ts` is shared by Agent and composition resume doors; it admits the saved caller declaration before per-leg serving and never infers caller absence from private selector presence.
