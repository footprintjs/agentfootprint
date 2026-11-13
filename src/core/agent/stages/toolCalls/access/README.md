**Mixed** — permission, consent and argument admission.
Walker: permission/middleware/check-in gates and streamed-argument refusal events.
Fold: approved-argument bindings, frozen views and call-state initializers.

# Tool-call access

The stage composes the decision ledger and middleware accessor once per handler. Decision binding stays before a decision is spent. Permission sees the proposed or filled call in its original order; transformed-argument validation remains before artifact or credential admission.

Call-state preparation receives the exact peeled argument reference. Result, argument, execution, consent and routing cells are initialized at their original separate phases. They are local to one invocation and never enter scope or a checkpoint.

`skillReadQuestion.ts` · `askSkillRead` is the one owner of the checker's `skill_read` question for `read_skill` (the self-call at a mounted cursor asks nothing), asked by the model's call (`execution/dispatchCall.ts`) and by an inner call.

`innerCallGates.ts` puts a call one tool makes through another (`ctx.tools.call`) to the same gates: `toolPermission.ts` · `checkToolPermission`, `capabilityQuestion.ts` · `askDeclaredCapabilities` and `skillReadQuestion.ts` · `askSkillRead` on fresh cells for that one call (`callState.ts` · `prepareCallState`), and `tools/runChain.ts` · `runToolChain` with `askPolicy: 'refuse'`, its rows through `middleware/ledger.ts` · `recordDecisions`. It holds no rule of its own: whatever those functions decide about an answer, they decide for the inner call, under its own id (`c1#inner-1`). The checker's `sequence` is the history's plus this outer call's inner calls that already ran (`innerCallGates.ts` · `innerCallsSoFar`, handed to `checkToolPermission`). A refusal comes back as an answer for inner dispatch to throw by name; nothing is written into the outer call's result. A `'halt'` is carried to the outer call (`core/agent/innerCallOuter.ts`), whose halt path (`routing/policyHalt.ts`) ends the run once it settles.

The native handler owns pause propagation. Each consent door keeps its own partial-state writes and terminal cleanup sequence; no shared finally path closes a paused call.
