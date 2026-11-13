**Mixed** — permission, consent and argument admission.
Walker: permission/middleware/check-in gates and streamed-argument refusal events.
Fold: approved-argument bindings, frozen views and call-state initializers.

# Tool-call access

The stage composes the decision ledger and middleware accessor once per handler. Decision binding stays before a decision is spent. A checker's answer is read by `provider-contract/permissionDecision.ts` · `readPermissionDecision` in both permission gates (`toolPermission.ts`, `capabilityQuestion.ts`): only `'allow'` / `'gate_open'` proceed, and an answer it does not recognise is refused exactly like a checker that threw (same model text, a `deny` record whose rationale names the answer), because neither said yes. Permission sees the proposed or filled call in its original order; transformed-argument validation remains before artifact or credential admission.

Call-state preparation receives the exact peeled argument reference. Result, argument, execution, consent and routing cells are initialized at their original separate phases. They are local to one invocation and never enter scope or a checkpoint.

The native handler owns pause propagation. Each consent door keeps its own partial-state writes and terminal cleanup sequence; no shared finally path closes a paused call.
