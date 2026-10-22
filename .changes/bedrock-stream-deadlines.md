---
type: added
---
**Bound Bedrock calls with `bedrock({ timeoutMs, firstEventTimeoutMs })`.**
The opt-in limit covers direct `complete()` calls as well as streaming.
The separate first-event allowance (defaulting to `timeoutMs`) covers stream
opening and the first event; idle/close/fallback waits use `timeoutMs`.
Consumer backpressure is excluded, and no total-duration limit is implied.
Both options omitted preserves the timer-free default; hosts choose limits.

Provider timeouts share `ProviderTimeoutError`, `isProviderTimeout`,
`ERR_PROVIDER_TIMEOUT` and `ProviderTimeoutWait` on the root and providers doors.
The facts include provider, wait, duration, whether output started and retry
advice. Output includes tool arguments not publicly yielded. A pre-output retry
may still bill input tokens; missing usage or remote settlement stays unknown.
The gateway and Bedrock reuse one internal timer/cancellation owner.
