**Mixed** — exact claim evidence capture and binding.
Trace: `capture.ts` detaches an executed invocation's evidence receipt.
Fold: `admit.ts` and `bindEvidence.ts` validate and select eligible evidence.
Map: `types.ts` and `scope.ts` define the authored scope and rule contracts.

# Exact claim evidence binding

This internal layer selects attributable evidence for the shared claim evaluator.
A `bound` result supplies two assertions and their evidence scope. It does not
certify agreement. The existing evaluator still owns value comparison.

## Capture and authorization

The eventual Agent adapter has three boundaries:

1. Reserve a result ordinal before awaiting a dispatch. Call `captureDispatch`
   with the arguments actually delivered to `tool.execute`, after defaults,
   middleware and time conversion. Only authored scope paths are copied.
2. Call `captureReturnedEvidence` immediately when that invocation returns,
   before awaiting result governance. It detaches the recognized semantic
   envelope so later mutation cannot change the returned reading.
3. Call `finalizeEvidence` with the final model-facing payload after governance,
   placement and caps, and an explicit authorization decision for the result
   and scope. `stream.tool_end.modelResult`, when present, is that channel;
   `stream.tool_end.result` may contain a withheld original.

This first binding accepts the existing semantic projection only when it matches
the final served payload structurally. That match establishes association, not
permission to retain the original envelope's metadata. `resultVisible` must
explicitly authorize every retained fact, provenance field, full coverage list
(including record-only `short` and `kind` fields), and period. A visible model
projection alone cannot authorize metadata omitted from that projection.
`scopeVisible` separately authorizes every selected argument dimension. An
unknown or partial authorization must pass `false`, yielding withheld evidence.

A rewrite, summary, ticket, refusal, incomplete call or withheld scope carries an
unavailable reason and retains no facts or scope values. A future authored
association for rewritten results belongs at the same boundary; matching a
provider ID cannot supply it.

## Identity and snapshots

Occurrence IDs encode a trusted recording namespace, run ID and positive ordinal
with the family's `encodeIdentityField`. The namespace must be unique across
independent recordings: Agent's present run IDs are process-local timestamp and
counter values. Provider call IDs and iteration numbers are descriptive fields;
neither selects an occurrence. Reusing an occurrence ID makes the selection
ambiguous rather than choosing a first or latest value.

`evidenceSnapshot` freezes the evidence universe at the declaration moment. Its
namespace and allowed run lineage come from the runtime's verified recording or
checkpoint provenance. They are never read from model declarations. A restored
snapshot must retain its original occurrence IDs. Missing evidence stays missing;
the binding does not rebuild it from history prose or findings standings.

These plain snapshots are internal data. Shape validation does not authenticate a
record or authorize access. The caller owns that boundary.

## Scope and completeness

The tool author declares required dimensions, argument paths, explicit defaults,
normalization and their version. A normalizer sees a detached value and cannot
mutate dispatch arguments. No value is inferred from a schema or prose.

The model supplies only result, value and rule. The operator's registered rule
selects one entity/field fact and supplies a completeness check over the captured
coverage boundary. Zero matches, duplicate matches, absent dimensions and changed
scope declarations are unverified. Every selected fact must carry the same tool
and call provenance as its receipt.

Existing `periodProblem`, `periodVerdict` and instant comparison decide temporal
coverage and whether the declared queried interval matches the executed interval.
Partial and unknown periods cannot be promoted by a completeness callback.
Requested dates and coverage prose alone do not establish completeness. An
authored callback must declare complete coverage; absent, partial, unknown and
stale decisions remain unverified.

An optional app-owned intended scope must match every captured dimension. There
is no automatic subset inference, normalization, widening or conversion at that
boundary. Absence/doubt needs a future explicitly authored absence rule.

## Current integration limit

This layer is unreleased source and is not mounted in the Agent. Its runtime
boundary tests use real mock-provider Agent executions and capture at the actual
execute and final-result seams. They demonstrate those inputs; they do not prove
production integration across all dispatch paths. Existing `.claims()`, findings,
checkpoints and provider requests retain their current behavior.

The next slice must mount the opt-in and ship its evidence retention, row writer,
checkpoint parser and readers together. Both full pause checkpoints and
history-only `continueFrom`/`resumeOnError` need explicit tests. Today's latter
checkpoints carry findings but omit `claimFacts`; those findings alone cannot
authorize a new check.
