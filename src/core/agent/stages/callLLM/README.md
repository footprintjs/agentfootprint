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

The oversized runtime stage still needs its step 2/3 extraction.
