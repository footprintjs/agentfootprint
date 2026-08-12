/**
 * agentfootprint/providers — everything you plug a backend into.
 *
 * One door for every "here is the thing that actually does the work":
 *
 *   • LLM providers      — `mock`, `anthropic`, `openai`, `bedrock`, the
 *                          browser variants, `createProvider`, and the
 *                          `LLMProvider` port you implement for your own.
 *   • Embedders          — `openaiEmbedder`, `localEmbedder`, `staticEmbedder`.
 *   • Tool providers     — `staticTools`, `gatedTools`, `skillScopedTools`,
 *                          plus the MCP client/server bridge.
 *   • Thinking handlers  — per-vendor parsing of extended-thinking blocks,
 *                          which is a provider concern wearing another hat.
 *   • Code runners       — `localCodeRunner` (process isolation, on this
 *                          machine, and it says so) and `agentCoreCodeRunner`
 *                          (a real managed sandbox). Both are backends behind
 *                          the `CodeRunner` port; `codeRunnerTool` on the main
 *                          barrel is the tool that holds one.
 *
 * Each vendor SDK is lazy-required, so importing this door loads no vendor
 * code — only calling a factory does.
 *
 * @example
 * ```ts
 * import { anthropic, staticTools, openaiEmbedder } from 'agentfootprint/providers';
 * ```
 */

export * from '../llm-providers.js';
export * from '../embedders/index.js';
export * from '../tool-providers/index.js';
export * from '../thinking/index.js';

// Code runners — the backends behind the `CodeRunner` port (9.7.0). The port
// types themselves live on the main barrel with `codeRunnerTool`, alongside the
// other adapter ports.
export { localCodeRunner, type LocalCodeRunnerOptions } from '../adapters/code/local.js';
export {
  agentCoreCodeRunner,
  type AgentCoreCodeRunnerOptions,
  type AgentCoreCodeClientLike,
  type AgentCoreInvokeAnswer,
  type BedrockAgentCoreCodeSdkModule,
} from '../adapters/code/agentcore.js';
