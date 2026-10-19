---
type: changed
bump: minor
---

**Findings citations are now enforced before dispatch and final settlement.**
With `.findings()`, unknown, ambiguous, malformed or known not-dispatched result
references now refuse a tool proposal before host callbacks and execution.
Previously unknown references were recorded but could still accompany an invoked
tool. Identity comes from the accepted provider attempt's served request, including
retry/fallback boundaries; a valid ID never certifies assertion truth or body visibility.
Attempted declarations remain in the masked ledger with bounded refusal diagnostics,
and refusal-containing checkpoints remain readable. Invalid JSON answers are denied
or spend only an already configured output retry and the remaining iteration budget.
Already emitted streaming drafts cannot be retracted. Tool schemas, instruction and
cache layouts are unchanged; this change adds no model call or paid validation.
