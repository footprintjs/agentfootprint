**Support** — declared per-scope rules (retry / fail-fast / continue) evaluated
at a gate subflow, plus a breaker that holds state across calls.

## What it reads / what it writes
- Reads the thrown error's classification and the declared rules.
- Writes the gate's decision into the chart's own branch. It is policy about
  whether the WALK continues, never about what the model sees.

## The one law here
A retry is telemetry, not content: it rides the emit channel and the record, and
adds no sentence to the wire.

## Request refusals and actual selected providers

The live loop is `core/agent/stages/reliabilityExecution.ts`. The narrow
`provider-contract/requestRefusal.ts` predicate identifies unsupported thinking,
unsupported forced-tool choice and unsafe thinking replay. Those refusals
escape unchanged before error classification, post-rules or breaker failure
accounting; a response-repair fallback cannot turn them into an outage either.
Other errors retain the existing rules-based policy.

Each attempt uses the selected provider and model from `providers`; `retry-other`
now switches the actual transport, not only its bookkeeping label. The same
selection owns the forced-choice guard, thinking handler, cost attribution and
wire-manifest provenance. Explicit thinking-handler overrides/null retain their
meaning. The shared raw-thinking dispatch envelope contains data, never functions.
`core/agent/providerTargets.ts` gives thinking and delivery one target rule: a
nonempty reliability list replaces the default, otherwise the default remains.
Thinking retains the existing skill/escalation brain checks. Declared injection
roles and runtime-only recall must be deliverable on every listed retry target;
the latter is refused in the existing delivery stage before entering history.
The provider-specific attribution guarantee is limited to these actual transport
calls. A consumer `fallback` callback is opaque; the library cannot establish
which provider/model (if any) it called or its actual cost from its returned value.

One `resilience/replayAttempt.ts` carrier preserves leaf-approved retirements
through retries, deliberate feedback and response repair. Feedback is composed
from the latest request and remains ephemeral. The streaming-to-complete fallback
also reads that carrier, so it cannot resurrect an omission from the first phase.

## Files
- `types.ts` — the rules vocabulary.
- `buildReliabilityGateChart.ts` — the gate as a subflow.
- `classifyError.ts` — thrown error → coarse kind.
- `CircuitBreaker.ts` — the pure state machine.
- `index.ts`.
