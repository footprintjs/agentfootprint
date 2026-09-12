# 013 — Optional answer validation against referenced evidence

**Status: feature request and executable boundary evidence. Not implemented.**
Tracking request: [issue #3](https://github.com/footprintjs/agentfootprint/issues/3).
This PR proposes a reusable, opt-in answer-validation capability, configured in
the same manner as tool validation or redaction. The included tests describe
current behavior; passing them does not mean the proposed feature has shipped.

## Problem and smallest useful outcome

A model can receive the correct context, use a computation tool, and still add
an unsupported conclusion. For example, a synthetic inventory result contains
one group and two items; the answer assigns the value two to the group count.
Both numbers appeared in the evidence, so token grounding cannot establish
which relationship is true. Similarly, computing totals does not establish that
an additional percentage was computed with the intended denominator.

The useful guarantee is narrow: **a protected factual response references a
validated result, and the host renders its values and qualifiers from that
result**. If the response copies values, those copies must agree with the
declared result fields. Arbitrary prose, causal explanations and arbitrary
model-written programs are outside this guarantee.

The general context-engine library and an application built on it are separate
efforts. An infrastructure app can expose a library gap, but customer names,
storage vendors, field meanings and business formulas belong in adapters.
At least two materially different synthetic domains must exercise this design.

## What already exists

Reviewed against main at `227c3abaf24ebadaaefc1d9ff6ac2874ceb14913`
(manifest version 9.94.2). Reuse these surfaces before adding anything:

| Existing surface | Useful capability | Boundary |
| --- | --- | --- |
| `semantic()`, `Claim`, coverage and provenance | Typed facts and explicit unknown/not-applicable values, grain and measurement limits | The adapter declares the facts; the engine does not independently verify the measurement. |
| `.outputSchema()`, `runTyped()` | Parse and validate answer structure | A structurally valid answer can be factually wrong. `run()` can return invalid text with diagnostics; callers must use the intended typed delivery contract. |
| `.claims()` | Compare declared answer paths with semantic entity/field facts | Currently records contradictions without blocking or rewriting the answer. It does not parse prose or join claims by dataset ref. |
| `.namesAndNumbersFromEvidence()` | Detect unsupported extracted tokens | Values assembled into a false relationship can pass. |
| Artifact scope, `wants`, `origin`, `parentRefs`, digest | Authorized reference resolution, kind checks and recorded lineage | A valid ref is not proof of relevance; declared parents do not prove a correct formula. |
| `Tool.resultColumns`, `checkColumnTypes` | Primitive column type/nullability checks | These do not establish units, populations or valid aggregations. |
| `runbookAsTool` and authored charts | Deterministic execution with rule versions, coverage and a recorded walk | The authored procedure still needs domain tests. Successful arbitrary code execution is not equivalent to a validated derivation. |
| Output message middleware | A consumer-authored validator can deny output today | It runs before the final claim check and has no same-pass claim verdict to consume. |
| Served views, receipts and integrity dispositions | Recorded context and actual checked/not-applicable/unreachable encounters | No findings can mean no applicable check. Synthetic canaries are separate from checking the answer. |

Relevant owners: [claim checker](../../src/integrity/unsupported-claim/check.ts),
[route judges](../../src/core/agent/stages/route.ts),
[artifact contracts](../../src/artifacts),
[semantics](../../src/lib/semantics), and
[runbook tools](../../src/core/runbook).
The test companion is
[`answer-validation-boundary.test.ts`](../../test/integrity/answer-validation-boundary.test.ts).

## Proposed contract, before choosing API names

This is a design contract, not a new exported API or a proposed engine stage.
First attempt a small composition over the existing public seams. Keep the
default behavior unchanged when validation is not enabled.

### Smallest first release

The first implementation needs a typed candidate/answer plan, a host-authored
validator, bounded access to scoped evidence, and an explicit delivery policy.
Reuse existing schema parsers, artifacts, middleware and dispositions. The
validator returns actual checked-pass/checked-fail/unreachable/not-applicable
outcomes; policy separately decides allow, deny or bounded correction. Zero
comparisons cannot produce a verified result.

The new composition must make the candidate, run identity and permitted
evidence reader available at the correct boundary. Current message middleware
exposes text/history/identity/signal, not that complete typed/scoped context.
An unavailable validator, timeout or thrown error cannot become a pass.

**A generic data registry or analysis-operator engine is not a prerequisite.**
An application can already supply its contract, run a trusted procedure and
store a typed result through existing APIs. Sections 1–3 describe the contracts
the validator can consume and follow-up opportunities, not additional engines
that must ship in the first release. Sections 4–6 define the requested output
validation and delivery boundary.

### 1. Trusted adapters declare meanings and supported analyses

A versioned data contract describes field types, units, conditional meanings,
identifier scope, row grain and missing/null/not-applicable behavior. Expected
fields remain separate from the columns actually observed in a result.

Adapters declare which operations are valid: a repeated count must not be
summed, unlike an additive amount; different currencies require a declared
conversion; a partial population cannot silently support a global total.
The library can validate declarations and provide generic operators. The
application owns domain interpretations and tested formulas.

If a shared registry is later added, reject ambiguous duplicate contracts and
conflicting versions at registration.
Treat contract text as authored metadata, never executable instructions from a
tool result or a substitute for observed values.

### 2. Bind data and derived results to scoped references

The producer binds a dataset ref to the exact contract version/fingerprint,
source provenance, observed schema and population/filter/coverage metadata.
An analysis executor resolves authorized inputs, validates supported operation
parameters, computes the result and produces a typed result descriptor:

```text
result ref + kind + contract/version
operation/rule + version + normalized arguments
input refs + input versions/digests + origin/parent lineage
measure IDs + typed values + units + known/unknown/not-applicable state
population/filter + included/excluded/unknown counts + coverage
specific validation predicates and their outcomes
```

A proportion records its numerator and denominator. A total records its
population and null policy. Source provenance must travel to derived results
and later turns; it cannot depend on an old chat message still being present.
Use the existing store and lineage ports. The descriptor is produced by trusted
execution, not accepted merely because the model wrote JSON resembling it.

### 3. Follow-up: serve relevant contracts across context-window changes

Resolve the relevant contract from selected or redeemed references, including
derived results, through trusted host selection and artifact/dispatch evidence.
Keep those meanings available after the source message is pruned. Deduplicate
repeated versions and bound their context size; do not reinsert raw tables.

Scope, expiry, changed versions and unavailable contracts remain explicit.
Relevance cannot be guessed by searching arbitrary prose for reference-like
strings. Skill-scoped instructions are useful existing building blocks, but a
dataset's lifetime can cross skill changes or resumed sessions.

### 4. Validate a structured answer plan

The preferred answer plan names result and measure references. For example,
this is illustrative data, not an available API:

```json
{
  "resultRef": "<validated-result-ref>",
  "measure": "distinct_group_count"
}
```

The validator checks authorized resolution, result kind, contract/version,
measure existence, unit and coverage compatibility, and consistency with the
declared analysis request. If copied values or labels are permitted, compare
them with their exact result fields rather than with values anywhere in context.
Unknown or unavailable values do not become zero or a healthy status.

**The expected request needs an independent authority.** A model selecting the
wrong filter and then validating its output against that same filter is circular.
The host, an accepted structured user selection, or a trusted workflow must
establish the intended inputs/operation/filter. If intent remains ambiguous,
ask for clarification or state that this comparison was not possible. The
feature cannot prove that arbitrary natural language was understood correctly.

### 5. Apply an explicit policy at the delivery boundary

Offer distinguishable policies for observation, refusal and bounded correction.
Exact public names are left for API review. A failure or missing prerequisite
must never receive a verified outcome. A correction consumes the normal action
budget, has a finite limit, and names what remains unresolved on exhaustion.
Ordinary conversation, clarification and self-explanation need an explicit
non-analytical path; do not require a calculation for every reply.

Keep compatibility with `.claims()`: a new opt-in policy must not silently
change that detector's current non-blocking behavior. Report the validation
subject, predicates, outcomes, reasons and enforcement action through the
existing record/observation conventions. Expose what was not checked.

**Bind the verdict to what is delivered.** Current output middleware precedes
claim checking; coverage text can be appended later, and typed delivery can
take a fallback path. Either validate the canonical terminal candidate after
all permitted transforms, or scope the verdict to an exact typed plan/digest
and separately identify additional framework text or unverified commentary.
A later mutation or fallback must not inherit a prior candidate's verdict.

**Streaming is part of acceptance.** A final denial cannot retract draft tokens
already shown. The host must buffer candidate factual output or stream neutral
progress, then commit the validated result. Test every delivery path, including
token listeners and typed fallbacks. The library must not claim a host buffered
its stream without a delivery contract establishing that behavior.

### 6. Render factual output from the validated result

Return a renderer-neutral validated answer structure. Applications can render
sentences, tables, charts or agent-to-agent output from its values, labels,
units and qualifiers. The model can choose relevant findings without retyping
their values. Consumer UI libraries remain outside this package.

A sentence such as “this component caused the failure” requires an applicable
domain rule and supporting evidence; otherwise it is a hypothesis. A second
model extracting or judging prose may assist review but can miss claims. Mixed
free prose and verified measures must not receive a blanket “answer verified”
badge. State the exact subset that passed.

## Acceptance criteria for a later implementation

| Case | Required outcome |
| --- | --- |
| Feature disabled | Existing behavior; no extra model call, row scan or hidden storage. |
| Correct protected measure | Scoped result resolves; the exact typed measure and qualifiers render. |
| Wrong copied value, unit, label or measure ID | Fails the declared comparison; cannot appear verified. |
| Value exists elsewhere in context | Does not excuse assigning it to the wrong entity/measure. |
| Wrong input/filter with valid arithmetic | Fails against the independently declared request. |
| Correct total plus an uncomputed percentage | Extra measure is unavailable until its operation is executed and validated. |
| Missing, null, zero, unknown and not applicable | Remain distinguishable according to the contract. |
| Partial population, repeated grain, mixed units, zero denominator | Explicitly validated handling or a stated inability/refusal. |
| Expired, foreign, changed or wrong-kind ref | Fails scoped/versioned resolution without exposing other users' data. |
| Follow-up after pruning, skill change or session restoration | Relevant meanings/provenance survive; unrelated contracts stay absent. |
| Missing applicable validation contract/evidence or detector self-test only | Report unchecked/incomparable status, never a validation pass. |
| Middleware transformation, coverage suffix or output fallback | Verdict stays bound to the delivered subject; no inherited stale pass. |
| Streamed candidate later refused | Unvalidated factual draft was not committed through another output path. |
| Correction exhausted or validator unavailable | Explicit policy outcome, no silent fallback to a verified-looking answer. |
| Concurrent, resumed, follow-up and supported Agent-mode runs | Validation state/identity remains isolated; no stale candidate or cross-run verdict reuse. |

Use deterministic provider/tool tests first. Exercise inventory counts, monetary
amounts with currencies, and job durations/outcomes to avoid designing a storage
feature in the general engine. Include negative controls that remove a contract
or validator and make the corresponding acceptance tests fail. Application
tests then cover real adapter queries, concurrent sessions, source outages and
UI delivery. Paid lower-cost-model tests supplement these gates; a successful
single answer does not establish general reliability.

## Scope and relationship to other proposals

This PR adds a feature request and passing characterization tests, not a new
validator, data registry, adapter, renderer or release. Future acceptance cases
above are requirements, not passing runtime tests. No production capture,
credentials or customer identifiers are included.

Local validation of this proposal branch: nine new boundary tests pass; the
full suite passes 10,550 tests with 20 counted skips. Build, type-regression
tests, the new test's own typecheck, lint, formatting, package lint and the
documentation-truth ratchet pass. Existing lint warnings remain unchanged.
These results establish the current baseline and test quality, not acceptance
of the proposed runtime feature.

[Proposal 010](010-contextual-error-types.md) discusses context-error taxonomy
and recovery; this request concerns decidable output contracts and delivery.
[Proposal 008](008-tool-output-provenance.md) concerns trajectory attribution,
which is not proof of correct arithmetic.
[Proposal 012](012-conversation-host.md) concerns transport; a validated answer
must retain its meaning regardless of that transport.

Context/evidence scoring research and the developer Integrity Checks lens are
separate follow-ups. A confidence score must not replace a deterministic
comparison or be presented as a truth guarantee.

Suggested implementation order: agree on the typed validator and delivery
contract; implement one complete reference-to-validation-to-rendering path using existing primitives;
prove it in two domains; then adopt it in an application. The library agent
should decide whether the reusable surface is a helper, recipe or core option
based on those tests rather than adding a parallel execution engine.
