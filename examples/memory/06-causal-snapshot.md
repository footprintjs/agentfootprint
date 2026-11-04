---
name: Causal memory — bounded execution evidence
group: memory
guide: ../../src/memory/causal/
defaultInput: What record is available?
---

# Causal snapshots

This example uses a local scripted provider and mock embedder by default. It stores two query/answer snapshots in one conversation and checks the actual memory writer's native source coordinates. Each scripted turn observes one tool pair and the provider's input/output counts. The fixture demonstrates storage and observation; it does not prove a model's reasoning or answer quality.

A schemaVersion:2 snapshot carries an explicit status:

- `observed`: the component observer retained its available facts.
- `partial`: named limitations or bounds leave some facts incomplete.
- `unavailable`: observation was not configured or could not be collected.

Coverage is one component execution leg. Resumed legs start new observation handles; earlier totals are not carried into the new observation. Missing or unsupported legacy rows are skipped and counted by readers rather than upgraded.

Causal snapshots retain bounded native decisions and matched dispatched tool pairs. They do not contain a complete commit log or narrative, and empty evidence proves neither no operations nor the full answer's cost. A served decision or script match is not proof that a business operation succeeded.

Memory identity scopes the store. Checkpoint/source coordinates are correlation facts, not authentication. Protect saved data at the hosting boundary and apply the normal redaction policy when recording or exporting it.

See [the runnable example](./06-causal-snapshot.ts), [Top-K](./04-topK-strategy.md) and [Hybrid](./07-hybrid-auto.md).
