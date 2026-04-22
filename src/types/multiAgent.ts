/**
 * Multi-Agent types — duck-typed interfaces for composing runners into pipelines.
 */

/**
 * Duck-typed interface — any runner (Agent, RAG, LLMCall, or user-built)
 * that has a `.run()` method can be wrapped as a flowchart stage.
 */
export interface RunnerLike {
  run(
    message: string,
    options?: { signal?: AbortSignal; timeoutMs?: number },
  ): Promise<{ content: string }>;
  getNarrativeEntries?(): Array<{ text: string }>;
  getSnapshot?(): unknown;
}

/**
 * Configuration for wrapping a runner as a flowchart stage.
 */
export interface AgentStageConfig {
  /** Unique identifier for this agent in the pipeline. */
  readonly id: string;
  /** Human-readable name (used in narrative). */
  readonly name: string;
  /** The runner to execute. */
  readonly runner: RunnerLike;
  /** Maps scope state to the input message for this runner. Defaults to reading 'pipelineInput'. */
  readonly inputMapper?: (state: Record<string, unknown>) => string;
  /** Maps runner output back into scope state. Defaults to writing 'result'. */
  readonly outputMapper?: (
    output: { content: string },
    state: Record<string, unknown>,
  ) => Record<string, unknown>;
}

/**
 * Entry recording a single agent's execution within a pipeline.
 */
export interface AgentResultEntry {
  readonly id: string;
  readonly name: string;
  readonly content: string;
  readonly latencyMs: number;
  readonly narrative?: string[];
}

/**
 * Result of a flowchart traversal.
 * Every composed execution (Pipeline, Swarm, custom) produces this shape.
 */
export interface TraversalResult {
  /** Final output content. */
  readonly content: string;
  /** Results from each runner in execution order. */
  readonly agents: AgentResultEntry[];
  /** Total traversal execution time. */
  readonly totalLatencyMs: number;
  /**
   * True when the traversal ended because `loopCount >= maxIterations` in the
   * underlying agent loop (set by `safeDecider`), rather than because the LLM
   * chose to stop. Surfaced uniformly across Swarm / Pipeline / custom runners
   * so consumers can render a distinct "agent gave up" state.
   */
  readonly maxIterationsReached?: boolean;
}
