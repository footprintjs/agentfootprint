/**
 * SeedScope stage — initialize agent state from config + user message.
 */

import type { ScopeFacade } from 'footprintjs';
import type { AgentConfig, LLMToolDescription } from '../types';
import { userMessage } from '../types';
import { AgentScope } from '../scope';
import type { ToolRegistry } from '../tools';

export interface SeedScopeConfig {
  readonly agentConfig: AgentConfig;
  readonly toolRegistry: ToolRegistry;
  readonly userMsg: string;
  readonly existingMessages?: import('../types').Message[];
}

export function createSeedScopeStage(config: SeedScopeConfig) {
  return (scope: ScopeFacade) => {
    // Set system prompt
    if (config.agentConfig.systemPrompt) {
      AgentScope.setSystemPrompt(scope, config.agentConfig.systemPrompt);
    }

    // Set tool descriptions for LLM
    const toolDescs: LLMToolDescription[] = config.toolRegistry.formatForLLM(
      config.agentConfig.toolIds.length > 0 ? config.agentConfig.toolIds : undefined,
    );
    AgentScope.setToolDescriptions(scope, toolDescs);

    // Set conversation messages
    const messages = config.existingMessages
      ? [...config.existingMessages, userMessage(config.userMsg)]
      : [userMessage(config.userMsg)];
    AgentScope.setMessages(scope, messages);

    // Initialize loop tracking
    AgentScope.setLoopCount(scope, 0);
    AgentScope.setMaxIterations(scope, config.agentConfig.maxIterations);
  };
}
