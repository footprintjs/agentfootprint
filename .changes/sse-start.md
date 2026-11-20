---
type: added
---
**End an SSE stream when its invocation settles.** Pass `start` to `toSSE()` to
start the run after subscribing and deliver its admitted frames through
success, failure, or a pause. In text format a composition streams its token
transcript. The promise returned from `start` carries the composition's answer.
