---
paths:
  - "src/adapters/**"
  - "src/cache/**"
  - "src/thinking/**"
  - "src/lib/mcp/**"
  - "src/resilience/**"
  - "src/reliability/**"
  - "src/tool-providers/**"
  - "src/providers.ts"
  - "src/embedders/**"
---
# Providers, adapters, cache and MCP — seams and blast radius

Loaded only when you work on the paths above — moved verbatim out of the root CLAUDE.md so it costs context only where it applies. **Trust the code** where this disagrees.

## Extension points
- **LLM provider**: `LLMProvider = {name, complete, stream?}` (adapters/types.ts:230) passed as `AgentOptions.provider`. `provider.name` keys THREE auto-resolutions: cache strategy (cache/strategyRegistry.ts:40), thinking handler (thinking/registry.ts:43), Lens labels.
- **MCP gateway fetch seam (9.32.0)**: `GatewayTransportOptions.fetch?: FetchLike` → `McpGatewayTransport.fetch` → `createVendingFetch(t, t.fetch)` (mcpClient.ts). Composition ORDER is the feature: the credential is vended and applied FIRST, then the consumer's fetch runs — so an mTLS agent / DPoP signer sees the final headers and has the last word while per-request vending survives. Zero vendor code lands here, ever; the secrecy-invariant test extends over the injected fetch. Absent ⇒ `createVendingFetch`'s default global fetch, byte-identical.
- **Ports table** (wired via AgentOptions): PermissionChecker (adapters/types.ts:403), PricingTable (:412), CredentialProvider (identity/types.ts:89), CacheStrategy (cache/types.ts:151, registerCacheStrategy), ThinkingHandler (thinking/types.ts:114 — auto-wire scans HARDCODED SHIPPED_THINKING_HANDLERS, registry.ts:26), ReliabilityConfig (reliability/types.ts:183), OutputSchemaParser (core/outputSchema.ts:62, duck-typed).

## Change-impact map
- **adapters/types.ts LLMMessage/LLMRequest** → 62 importers: tool_use round-trip (toolCalls.ts:115-135), wire assembly (callLLM.ts:150-160), providers, cache strategies, security/extractSequence, reliability loop.
- **Cache** → strategy registration is a MODULE SIDE EFFECT (src/index.ts:15-17); an entry point skipping that import silently falls back to NoOp. Resolved once per Agent at construction (Agent.ts:347).
- **Any AWS adapter** (9.4.0) → `test/adapters/aws/awsCommandPin.ts` is THE registry of the SDK command constructors each one dispatches, and its completeness test fails the build for any `src/**` file that LOADS an `@aws-sdk/*` package without a row. Adding/renaming a dispatched command = edit the row. The rule the registry exists to enforce: a bare `@aws-sdk/client-*` **Client is command-based** (`send`/`destroy` only) — per-operation METHOD shortcuts live on the aggregated client (`BedrockAgentCore`), so `client.someOperation(...)` is always wrong here. Three adapters shipped violating this (6.42.0 wrong-service commands, 9.4.0 `EvaluatePolicyCommand` which does not exist, 9.4.0 `agentCoreIdentity`'s method call). Every AWS adapter now has an `_sdk` seam for exactly this test; the AWS SDKs are deliberately NOT devDependencies (six adapters prove their missing-peer-dep refusals by real absence), so the real-module half runs only where they are installed.
