**Support** — call-stage dependency declarations and capture probes.

# Model-call dependencies

Step 1: the complete `CallLLMStageDeps` declaration moved here unchanged, with
relative type imports adjusted. `../callLLM.ts` keeps its existing export and
runtime stage. This is a type-only boundary, not another provider implementation.

The context feature captures the already assembled system pieces, schemas and
request-only context immediately before model I/O. It does not edit a request.
The recording assigns each accepted proposal an opaque occurrence address before
the inputs layer can write findings. One random batch namespace plus the proposal's
position identifies calls even when a provider repeats an ID. The proposal already
lives in native state and the assistant history, so resumes carry the same address.

`providerRequest.ts` detaches library-owned request data before cache preparation.
The prepared request belongs to that model call. Edits to it survive a retry or
stream fallthrough of the same payload. A fallback provider inside the same model
call is handed the same messages and tools, including an earlier adapter's edits
inside them. An edit to a top-level field of the request does not carry when the
dispatch wraps the request.
Each new model call starts with a fresh copy of library data. The receipt reuses
internal message digests for built-in strategies, which only add cache markers,
and reads host rewrites directly.
The live cancellation signal is composed at dispatch.

`servedRequest.ts` records the positions of complete history entries at the
provider port. A request-only message has no history position. Changed
messages, distinct requests, and provider fallbacks withhold the candidate
row. Observing a retry of the same request leaves one row. The original
provider hooks still carry request observations and close when the invocation
settles.

`selectionAtRequest.ts` binds a visible tool-selection exclusion to the native
call that accepted the response. It retains the implementation privately when
the prepared catalog survives to the observed attempt and the adapter reports
that the name was absent. When two implementations compete for an offered name,
the native dispatch registry can establish which one won. The witness checks
the winning party and exact tool reference before the request and again when the
response is accepted. A dynamic provider's label cannot establish that binding.
The private collision row stays separate from names marked absent in a receipt. A local fallback, missing manifest, altered observed tool
contract, or reused response object supplies no witness. On a receipt-enabled native turn with no active redaction,
`recordToolSelection.ts` adds visible names and reasons to that call's receipt.
It shares one row budget across the turn. Unknown capacity on recovery
withholds the annotation. Deciding whether a source mattered to the answer
requires separate evidence of its declared ground and later use.

`liveChunks.ts` emits an attempt's thinking and visible text in provider order.
It applies the served-event redaction policy. Calls that protect draft output
may opt in to classified provider summaries through `AgentOptions`. The answer
policy still owns draft text delivery. The call stage owns the terminal response
and cancellation.

## Dispatch lifetime

Every attempt carries the run’s signal on its
request (`LLMRequest.signal`), so an aborted or timed-out run cancels the
provider's own HTTP request — the engine stopping the traversal leaves a
call in flight running, and billing. It already holds the run's deadline
(`RunnerBase · runSignalOf`). Stamped here, at the dispatch, and
never on `llmRequest`: the receipt above hashes that object, and a signal
is no part of what was asked. The same signal bounds every wait below,
so an adapter that ignores it still cannot hold the stage open, and an
answer that lands after it is refused before anything records or bills
it (`lib/abort.ts`, law 4).

The oversized runtime stage still needs its step 2/3 extraction.
