---
type: added
---
**Bundled apps (esbuild, webpack) can hand the MCP and AWS SDKs to the MCP path through a public `sdk` option.** `mcpClient` and `agentCoreRuntimeMcpTransport` load their SDKs through a lazy `require` that a bundler cannot follow, so a bundle deployed without `node_modules` could not find them. `agentCoreRuntimeMcpTransport({ ..., sdk })` now takes the `@aws-sdk/client-bedrock-agentcore` module you imported (SigV4 only; refused beside `auth: { bearer }`, which loads no AWS SDK). It was previously reachable only as the underscore-private `_sdk`, which keeps working as the older name; passing both with two different modules is refused. `mcpClient({ sdk })` already took the MCP SDK.

A missing or wrong SDK is refused when the client or transport is built, never at the first tool call. The "not installed" message now names `sdk` and the bundler case instead of the internal `_client` test seam, and an `sdk` with a missing `Client`, `StreamableHTTPClientTransport`, `InvokeAgentRuntimeCommand` or `BedrockAgentCoreClient` is refused by name instead of failing later as "is not a constructor". The MCP client docs gain a "Bundling (esbuild, webpack)" section.
