---
type: fixed
---
**The AI-assistant instruction files (`npx agentfootprint-setup`) now import each name from the door that exports it.** They showed `import { Agent, mcpClient } from 'agentfootprint'`, but `mcpClient` (like `agentCoreRuntimeMcpTransport`) is on `agentfootprint/providers`; their core-API block also put provider, memory, context and resilience names on the main barrel, named a `resilientProvider` that does not exist (`fallbackProvider` does), and called `agentfootprint/observe` and `agentfootprint/security` stale when both are live doors. Re-run `npx agentfootprint-setup` to refresh an installed copy.
