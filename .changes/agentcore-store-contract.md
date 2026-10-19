---
type: fixed
---
**AgentCoreStore respects service page limits without losing continuation cursors.** Large portable list requests are capped at the AWS event limit, so turn-number resolution can scan several pages without a validation failure. Configured page sizes are checked before a client is constructed. Semantic retrieval also caps both AWS result fields. An SDK that cannot serialize extraction options is still refused, with the minimum compatible AWS SDK named in the error.

**Caller-size contract:** every shipped store now requires a provided list `limit` or implemented search `k` to be a finite positive integer. Zero, negatives, fractions, nonfinite values and runtime non-numbers reject locally with `RangeError` before backend work or empty-result shortcuts. Omitted/`undefined` options retain their existing defaults; larger positive requests retain the adapter's existing cap and cursor behavior. Values previously rounded, coerced or treated as empty are refused explicitly instead. The stage-local `loadRecent({ count: 0 })` option still disables that load without reading the store or discarding entries from earlier stages.

**Option compatibility (breaking for internal-option users). Migration:** replace `new AgentCoreStore({ _sdk: module })` with `new AgentCoreStore({ sdk: module })`. The internal spelling is removed without an alias. The public `BedrockAgentCoreSdkModule` type is exported from `agentfootprint/memory`; bundled hosts can inject their statically imported SDK without loading the peer dynamically. Existing `client` injection remains supported.
