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
cache layouts are unchanged; this change adds no new model-call budget or paid validation.

**Entry-boundary correction:** a failure while preparing dispatch context or time,
before entering `tool.execute`, is no longer reported as an executed tool on the
resume path and no longer invokes after-tool middleware. This correction also
applies when findings is off; entered tool errors and cached returns stay results.
Nominal off-findings reference records and request bytes are unchanged, rather
than a promise of byte identity for this previously misclassified failure.

Custom AI-provider wrappers that change a request must forward its hooks and report
the transformed request before delegation; the custom-provider guide includes a
copy-in `assertProviderRequestForwarding` test helper for normal and streaming calls.
