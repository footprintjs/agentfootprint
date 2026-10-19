# Stable findings tool schemas and authoritative served-reference checks

Status: design proposal; stop for human review before implementation.
Source checked against main commit `7aa4d919` after the AgentCore fix.
It changes no source, release version or provider behavior today.

## 1. Goal and limits

Keep the library-owned `_findings` tool contract byte-stable while result IDs change.
Serve current findings context late, outside the cacheable conversation prefix.
Validate reference identity programmatically; an LLM declares findings and explains results.
A valid reference identifies a served result: it never certifies the assertion as true.
Cache hits, citation quality and savings remain unmeasured for this proposed layout.

## 2. What the current implementation actually does

`findings/reserved.ts::offeredFindingsSchema` inserts the latest IDs into every tool schema.
`offer.ts::offeredResultIds` supplies newest-first, non-retired results from served history.
The advisory list is capped at 32; `noise` and `ruled-out` results leave that offer.
Both chart builders therefore set `toolsVaryPerCall`; `computeCacheMarkers` emits no markers.
That safeguard is appropriate for the present layout and must not simply be deleted.

The handoff's assumed runtime rejection does **not** exist today.
`readPrevious` accepts any string; `standingRowsFrom` records unmatched IDs as `unknownId`.
The dispatcher peels `_findings` before ordinary tool-argument validation.
A forged reference therefore does not currently prevent an otherwise valid tool invocation.
A retired ID still in served history can resolve even when absent from the current enum.
Declared assertions remain recorded, including on unknown-ID rows, labelled as model declarations.
The answer Route path uses the same ledger resolver, rather than an enum authority check.

The proposed refusal is consequently **new enforcement**, not preservation of an old validator.
It needs explicit release notes, migration cases and the design review requested here.
No declaration or unknown evidence may disappear merely because its reference is refused.

Source locations: `src/core/agent/findings/{reserved,offer,ledger,serve}.ts`,
`src/core/agent/stages/{callLLM,toolCalls}.ts`, `src/core/slots/buildToolsSlot.ts`,
`src/cache/CacheDecisionSubflow.ts` and `src/time-travel/servedView.ts`.

## 3. Four cache constraints, not just the enum

1. The changing tool enum invalidates every prefix behind the tools.
2. `callLLM` also appends the changing ledger to the single composed system string.
   Both Anthropic and Bedrock currently mark that whole system string, not its separate pieces.
   Moving only IDs leaves this earlier prefix unstable.
3. The fixed findings instruction is built by `defineInstruction` without a cache policy.
   Instructions default to `never`, which prevents the moving conversation-tail marker.
   Declare only this immutable library-owned frame cacheable; app instruction defaults stay intact.
4. `collapseJudged` can replace older wire tool results when standings change.
   Those historical changes, window compaction and genuine tool changes remain expected misses.
   The proposal does not promise append-only wire history or a cache hit on every iteration.

The global caching-off switch, noncacheable app injections and unsupported-model guards still win.
The existing cache strategy and provider adapters remain the only owners of cache markers and wire encoding.

## 4. Stable contract, bounded late context

Keep the `_findings` object and its existing `previous` declaration shape.
Use a stable string ID field without a per-call enum or a hardcoded vendor-specific regex.
Custom providers and saved histories may contain IDs unlike any one vendor's IDs.
Any new length or cardinality restriction needs an explicit contract and compatibility tests.
Preserve author-owned `_findings`, ruled-tool `from` and native answer-schema ownership rules.

Reuse the existing offer producer and folded ledger; do not create a second ledger or ID registry.
One pure composer produces bounded, quoted DATA: current advisory IDs plus mutable ledger context.
Quote opaque IDs with JSON encoding; do not interpolate them as instructions or grant executable authority.
Retain the existing limits, model-declaration strata and explicit omission counts.
The app owns an explicit bound for this new tail before request preparation; the existing contextBudget only warns and runs earlier.
When that bound is reached, omit whole IDs or ledger rows with counts; never clip an identifier into a different identity.
The constant instruction explains the format and asks the model to copy IDs without guessing.
The changing ledger and offer do not remain in the cacheable system frame.

Append that context through the existing request-only message seam after the committed history boundary.
A delimited user-role DATA message is the smallest supported provider-neutral shape today.
It is framework context, not a new user request and not independently verified tool truth.
It never enters `scope.history`, the user-source exemption corpus or an accumulated tail.
Register this framework DATA frame with `saidByPerson` explicitly so it cannot become apparent human testimony merely because its wire role is user.
Re-asks, resume and wrap-up compose the correct context once for that request.
The design will pin its order relative to the existing nudge, time and evidence-conclusion messages.

A literal late system-role conversation message is not a second equivalent arm.
Anthropic's existing conversion drops system-role conversation messages.
Putting text into the single `systemPrompt` is an early-prefix control, not a late system block.
A true separate-system-block experiment would need its own provider-contract design first.

## 5. Authority: bind to what this model request actually served

Capture the request's served-result identity view before the response can dispatch any new calls.
Use the actual request evidence and existing recorded lineage, never global ledger membership alone.
The advisory cap of 32 is not an authorization limit: an unambiguously served ID outside it remains identifiable.
Being syntactically well formed, matching a provider pattern or appearing in a ledger is insufficient.

Check ambiguity **before** the existing first-ID-wins deduplication.
Two indistinguishable/reused provider IDs must not silently resolve to the first historical result.
Where recorded lineage cannot distinguish the intended result, keep identity unknown and refuse the declaration.
An ID guessed for a result produced earlier in the same response batch was not served to that response.
Do not expand the admitted set as the batch runs; a later model request can cite the newly served result.
A `notDispatched` settlement is not evidence of an executed tool result.

Historical and continued results are not rejected merely for being old or from an earlier engine run.
They need an unambiguous occurrence in the actual request's authorized conversation/evidence view.
Host-provided or restored history does not by itself prove tenant authorization or capture completeness.
Missing lineage or a missing request boundary stays unknown, with the precise gap stated.
A ticket-only message can show an ID while withholding its body: do not infer body visibility from its ID.
Record reference identification and content visibility separately; identifying a ticket is not reading its body.
If identity is unambiguous, that still proves no assertion content; if its source is ambiguous, refuse it as unknown.
Do not invent an age threshold, revive retired evidence silently or turn a claimed assertion into checked truth.
These cases require explicit fixtures so continuation, collapse and privacy rules remain independently testable.

## 6. Structured teaching refusal, before invocation

Apply one deterministic served-reference admission helper at tool dispatch and at JSON-answer Route.
Preserve the attempted declaration and existing `unknownId` evidence, plus a bounded refusal reason.
An unserved or ambiguous reference causes a structured teaching refusal **before `tool.execute`**.
Admission also precedes effectful middleware, credential resolution and other dispatch callbacks; rejecting metadata after those callbacks is too late.
The refusal explains that the reference cannot be identified in this request and asks for a served ID or fresh read.
Do not substitute an ordinal, map a name to a result, leak foreign-run data or manufacture provenance.
For a tool call with mixed valid/invalid references, refuse invocation rather than invoke with partially admitted metadata.
Independent calls in a batch keep their existing settlement behavior; no earlier call grants later guessed IDs.

The answer path must not publish a final answer with an inadmissible findings reference.
Use the existing bounded teaching/re-ask path, with the same identity check and preserved diagnostics.
No extra iteration budget, hidden model call, automatic paid retry or model-based validation is introduced.
When the existing budget cannot repair it, report the unresolved reference and missing evidence factually.
Valid reference admission leaves assertion stratum and separate evidence checks unchanged.

## 7. Receipt, replay and honest trace evidence

Share the late-context composer between `callLLM` and `servedView` over the same committed inputs.
Record its request-only reason and the prepared-request hashes and measurements through existing receipt conventions.
This introduces no raw request dump; retain the existing masking and persistence choices.
Keep the sent-request identity boundary available to dispatch and answer Route; do not reconstruct it from future state.
`recordReceipt: false` may disable persistence, never live admission. A receipt or matching hash is evidence of a request, not an authorization grant.
Use a recorded layout/version discriminator so old records retain their original enum/system-ledger rendering.
A missing old discriminator must not be interpreted using the currently installed package version.
If a saved record cannot reconstruct identity or layout exactly, disclose a gap rather than assert equivalence.
Preserve privacy masking, bounded records and unknown outcomes; no model reasoning is required for these checks.

## 8. Other dynamic schemas remain legitimate

ToolProvider discovery, active skill tools, read_skill cursor/menu descriptions, role visibility,
step narrowing/banners, parked maps, skip_step and classifier narrowing can change the actual tool contract.
Wrap-up also removes tools; the winning implementation's argument-rule decoration can change.
Do not freeze those surfaces, reveal role-hidden tools in a global catalog or weaken dispatch to get cache hits.
Stable findings removes one specific source of variation, not every agent's dynamic-tool behavior.
Keep conservative cache policy or accept an honest miss when a genuine contract changes.

## 9. Proof and measurement gates

Read-only source probes and existing mocked tests already establish the present behavior without paid calls.
Existing regression coverage lives in `test/core/agent/findings-ledger.test.ts`,
`test/core/agent/findings/offer.test.ts` and `test/core/agent/findings/ledger.test.ts`.
The implementation must commit the additional reproduction fixtures listed below.
No existing benchmark percentage is restated here as new evidence.

Implementation must begin red-first: stable schema bytes across changing offers; markers at the correct boundary;
served/capped/retired/windowed/ticketed/continued references; forged, foreign, ambiguous and guessed same-batch IDs;
pre-invoke refusal, retained unknown declarations, JSON-answer parity and no extra invocation on refusal;
old-record replay, exact receipt reconstruction, byte identity for flows without findings and Anthropic/Bedrock stub-wire layouts.
Include global-off, unsupported model, privacy menus, parallel-run isolation and output-schema ownership controls.
Then run the repository gates and independent security review followed by code review.

Use `bench/findings-context.mjs`, `bench/findings-shuffle.mjs` and `bench/cache` as audited fixtures, not unrestricted paid commands.
A future paired Haiku 4.5 pilot compares layouts under **identical reference-admission policy** in both arms.
If that cannot be arranged, disclose the new-refusal-policy confound instead of attributing repair turns to layout alone.
Compare citation validity, teaching refusals, extra turns, planted answer fidelity and raw cache/input cost categories.
Before requesting execution approval, freeze a synthetic payload and prove hard pre-send input, output, call,
time and money reservations; timeouts with missing usage retain unknown charges rather than freeing the budget.
Current official model/pricing references inform that later manifest but do not authorize a paid run.
Only the owner's separate Haiku 4.5 approval and budget permit it; no keys or environment files are read now.
No savings claim or default rollout is justified until that bounded experiment and its limits are reviewed.

## 10. Delivery order

Open this design addendum alone against the reviewed main branch; stop for human review.
After approval, build one implementation PR with free fixtures and the guarded benchmark kit; stop for review again.
Run a paid pilot only with separate approval, then save reproducible results and an honest recommendation.
Do not add a legacy per-call-enum flag without evidence that the new layout needs it.
