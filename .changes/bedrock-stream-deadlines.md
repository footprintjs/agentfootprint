---
type: added
---
**Choose separate provider wait limits with `bedrock()` or `invokeModelGateway()`.**
Both accept `timeoutMs` (stream idle/close), `firstOutputTimeoutMs` (cumulative
provider waits from opening to meaningful text/tool/thinking output), and
`responseTimeoutMs` (prompt plus whole `complete()` answer or SDK no-stream
fallback). The whole-answer cap defaults to the first-output cap, which defaults
to the idle cap. Gateway response headers and body share the answer allowance;
key lookup has its own no-send wait under that cap. Empty text, control events
and keep-alives do not reset pre-output time. Consumer backpressure is excluded.
All three omitted preserves the timer-free default and exact caller signal.

Provider timeouts share `ProviderTimeoutError`, `isProviderTimeout`,
`ERR_PROVIDER_TIMEOUT` and `ProviderTimeoutWait` on the root and providers doors.
The typed waits distinguish credentials, response, body, first-output, chunk,
close and fallback. Live error facts include provider, wait, configured cap,
observed output and retry advice; JSON storage may discard Error properties and
this guard does not validate saved evidence. Both adapters share one typed
allowance policy and timer/cancellation owner.
