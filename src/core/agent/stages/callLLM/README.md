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

## Dispatch lifetime

Every attempt carries it on its
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
