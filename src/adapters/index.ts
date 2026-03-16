// ── Mock Adapters ────────────────────────────────────────────
export { MockAdapter, mock } from './mock/MockAdapter';
export type { MockResponse } from './mock/MockAdapter';
export { MockRetriever, mockRetriever } from './mock/MockRetriever';
export type { MockRetrievalResponse } from './mock/MockRetriever';

// ── Adapter Subflow ─────────────────────────────────────────
export { createAdapterSubflow } from './createAdapterSubflow';
export type { AdapterSubflowConfig } from './createAdapterSubflow';

// ── Protocol Adapters ───────────────────────────────────────
export { mcpToolProvider } from './mcp/mcpToolProvider';
export type {
  MCPClient,
  MCPToolInfo,
  MCPToolResult,
  MCPToolProviderOptions,
} from './mcp/mcpToolProvider';
export { a2aRunner } from './a2a/a2aRunner';
export type { A2AClient, A2AResponse, A2ARunnerOptions } from './a2a/a2aRunner';

// ── LLM Provider Adapters ───────────────────────────────────
export { AnthropicAdapter } from './anthropic/AnthropicAdapter';
export type { AnthropicAdapterOptions } from './anthropic/AnthropicAdapter';
export { OpenAIAdapter } from './openai/OpenAIAdapter';
export type { OpenAIAdapterOptions } from './openai/OpenAIAdapter';
export { BedrockAdapter } from './bedrock/BedrockAdapter';
export type { BedrockAdapterOptions } from './bedrock/BedrockAdapter';

// ── Provider Bridge ─────────────────────────────────────────
export { createProvider } from './createProvider';
