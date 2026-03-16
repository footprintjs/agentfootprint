/**
 * providers/prompt/ — Built-in PromptProvider strategies.
 */

export { staticPrompt } from './static';
export { templatePrompt } from './template';
export { skillBasedPrompt } from './skillBasedPrompt';
export type { Skill, SkillBasedPromptOptions } from './skillBasedPrompt';
export { compositePrompt } from './compositePrompt';
export type { CompositePromptOptions } from './compositePrompt';
