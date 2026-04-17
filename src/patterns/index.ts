/**
 * agentfootprint/patterns — canonical agent composition patterns.
 *
 * Each pattern is a thin factory over the existing concepts (`FlowChart`,
 * `Parallel`, `Conditional`, `Agent`, `LLMCall`, `RAG`, `Swarm`). No new
 * primitives. The source of each file shows the composition — read it to
 * learn how to build your own.
 *
 * @example
 * ```ts
 * import { treeOfThoughts, reflexion, planExecute, mapReduce } from 'agentfootprint/patterns';
 * ```
 */

export { planExecute } from './planExecute';
export type { PlanExecuteOptions } from './planExecute';

export { mapReduce } from './mapReduce';
export type { MapReduceOptions, MapReduceMapper, MapReduceReduceConfig } from './mapReduce';

export { treeOfThoughts } from './treeOfThoughts';
export type { TreeOfThoughtsOptions } from './treeOfThoughts';

export { reflexion } from './reflexion';
export type { ReflexionOptions } from './reflexion';
