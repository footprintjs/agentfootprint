**Support** — call-stage dependency declarations and capture probes.

# Model-call dependencies

Step 1: the complete `CallLLMStageDeps` declaration moved here unchanged, with
relative type imports adjusted. `../callLLM.ts` keeps its existing export and
runtime stage. This is a type-only boundary, not another provider implementation.

The context feature captures the already assembled system pieces, schemas and
request-only context immediately before model I/O. It does not edit a request.
The existing oversized runtime stage still needs its own step 2/3 extraction;
this change does not claim that file's cleanup complete or raise its baseline.
