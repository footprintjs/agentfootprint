---
type: fixed
---
**AgentCoreStore respects service page limits without losing continuation cursors.** Large portable list requests are capped at the AWS event limit, so turn-number resolution can scan several pages without a validation failure. Configured page sizes are checked before a client is constructed. Semantic retrieval also caps both AWS result fields. An SDK that cannot serialize extraction options is still refused, with the minimum compatible AWS SDK named in the error.

**Option compatibility (breaking for internal-option users). Migration:** replace `new AgentCoreStore({ _sdk: module })` with `new AgentCoreStore({ sdk: module })`. The internal spelling is removed without an alias. The public `BedrockAgentCoreSdkModule` type is exported from `agentfootprint/memory`; bundled hosts can inject their statically imported SDK without loading the peer dynamically. Existing `client` injection remains supported.
