---
type: fixed
---
**Keep timeout and retry evidence honest.** Gateway timeout errors retain
`reason: 'timeout'` and compose the shared provider-timeout facts. Their retry
advice is now false once output starts (including tool/thinking blocks before
public text); configured timeout retries report reason `timeout` instead of
`no-status`. A cleanup timeout no longer hides an earlier read/parse failure.
The configured gateway response allowance also bounds an asynchronous key
lookup, before any request is sent. The SDK abort signal owns Bedrock transport
cleanup; late responses are discarded without advancing a fresh iterator.

Two gateway corrections are explicit behavior changes: caller cancellation
with a non-Error reason during body/stream reads now raises `AbortError` with
that reason as its cause, rather than throwing the raw value; wait settings
above 2,147,483,647 ms are refused at setup under the shared option rule,
instead of Node turning them into an immediate 1 ms timeout. Zero, negative,
non-finite and non-numeric values are also refused, without echoing the value.
