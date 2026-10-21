---
type: added
---
**Bound silent Bedrock streams with `bedrock({ timeoutMs })`.** Each SDK response,
event read, early close and non-stream fallback has its own wait cap. A miss
aborts the request and raises `BedrockStreamTimeoutError`, with fixed
`code: 'BEDROCK_STREAM_TIMEOUT'`, `phase`, `timeoutMs` and `retryable: true`.
`withRetry` can recover before the first public chunk; after any chunk it
surfaces the failure without replaying text. Omitted means no new cap; direct
`complete()` calls keep their existing cancellation contract. The gateway and
Bedrock adapters share one internal deadline helper, using the existing
platform-safe timer and cancellation owner. A timeout requests cancellation;
it does not prove remote execution stopped or establish missing usage as zero.
