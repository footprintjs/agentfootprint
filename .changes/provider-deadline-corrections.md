---
type: fixed
---
**Keep timeout and retry evidence honest.** Gateway timeout errors retain
`reason: 'timeout'` and compose the shared provider-timeout facts. Automatic
retry advice is false after meaningful output (including tool/thinking content
before public text), and always false for opaque complete/body or SDK fallback
timeouts, where remote output cannot be observed. `afterOutput: false` on such
a call means not observed, not not generated. Streamed pre-output retries may
still bill prompt tokens. Missing usage, output and settlement remain unknown.
Configured timeout retries report reason `timeout` instead of `no-status`.
A cleanup timeout no longer hides an earlier read/parse failure.

Gateway limits now distinguish whole answers from idle gaps. The separate
first-output allowance spans headers and control-only/empty reads; empty text
block starts no longer count as generated output or prematurely end that
allowance. A configured response cap also bounds an asynchronous API-key lookup
separately, before any request is sent. Timeout messages are fixed text without
the model name or a claim that asking again is safe; a credential timeout names
the lookup and confirms no provider request was sent. The SDK abort signal owns
Bedrock transport cleanup; late responses are discarded without advancing a
fresh iterator.

Two gateway corrections are explicit behavior changes: caller cancellation
with a non-Error reason during body/stream reads now raises `AbortError` with
that reason as its cause, rather than throwing the raw value; wait settings
above 2,147,483,647 ms are refused at setup under the shared option rule,
instead of Node turning them into an immediate 1 ms timeout. Zero, negative,
non-finite and non-numeric values are also refused, without echoing the value.
