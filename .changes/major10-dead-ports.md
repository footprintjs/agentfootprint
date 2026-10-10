---
type: breaking
---

**Remove unused adapter contracts and the retired AgentCore policy shim.**
The unused `ContextSourceAdapter`, `EmbeddingProvider`, and `RiskDetector`
ports and their helper types (`ResolveCtx`, `ContextContribution`,
`RiskContext`, `RiskResult`) are no longer exported. None had a runtime
caller. The never-emitted `agentfootprint.risk.flagged` event, its payload,
and the `agentfootprint.risk.*` subscription domain are removed too.
The always-throwing `agentCorePolicy` factory, `AgentCorePolicyRetiredError`,
and its five option/client/evaluation/SDK types are deleted rather than kept
as callable stubs.

Migration: Use `defineInjection`, `defineFact`, or `defineSkill` from
`agentfootprint/context` for context contributions; use the live `Embedder`
contract from `agentfootprint/providers` for embeddings. For authorization,
use `PermissionPolicy.fromRoles` or implement `PermissionChecker` from
`agentfootprint/security` and supply it as `permissionChecker`.
Application-specific screening can run in tool/message middleware or a
`reliability({ preCheck })` rule. Subscribe to the actual permission,
reliability, or middleware decision events instead of the removed risk event;
absence of that unproduced event never proved a successful safety check.
For AgentCore Gateway tools, handle the tool errors returned by `mcpClient`;
there is no replacement library-side policy-evaluation SDK call.
