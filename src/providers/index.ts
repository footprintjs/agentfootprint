/**
 * providers/ — Built-in active strategy implementations.
 *
 * Each sub-module provides strategies for one provider interface:
 *   prompt/    → PromptProvider strategies
 *   messages/  → MessageStrategy strategies
 *   tools/     → ToolProvider strategies
 */

export { staticPrompt, templatePrompt, skillBasedPrompt, compositePrompt } from './prompt';
export type { Skill, SkillBasedPromptOptions, CompositePromptOptions } from './prompt';
export {
  fullHistory,
  slidingWindow,
  charBudget,
  withToolPairSafety,
  summaryStrategy,
  compositeMessages,
  persistentHistory,
  InMemoryStore,
} from './messages';
export type {
  SlidingWindowOptions,
  CharBudgetOptions,
  SummaryStrategyOptions,
  ConversationStore,
  PersistentHistoryOptions,
} from './messages';
export { staticTools, dynamicTools, noTools, agentAsTool, compositeTools } from './tools';
export type { ToolResolver, AgentAsToolConfig } from './tools';
