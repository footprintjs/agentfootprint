/**
 * mountMemoryPipeline — mount a MemoryPipeline's read + write subflows
 * into an arbitrary agent flowchart.
 *
 * Given:
 *   - a `FlowChartBuilder<AgentState>` the caller has been assembling,
 *   - a `MemoryPipeline { read, write }` (typically from a preset),
 *   - identity + turn + budget inputs sourced from agent scope,
 *   - mount points (which stage id to insert the read subflow before),
 *
 * returns the builder with:
 *   1. the `read` subflow mounted BEFORE the given anchor stage, with an
 *      inputMapper that reads identity/turn/budget from agent scope and
 *      an outputMapper that writes `formatted` messages back,
 *   2. the `write` subflow (if present) appended AT THE END, with an
 *      inputMapper that reads `newMessages` from agent scope.
 *
 * The agent's existing stages are responsible for:
 *   - populating `identity`, `turnNumber`, `contextTokensRemaining`,
 *     `newMessages` in scope BEFORE the relevant memory subflow runs,
 *   - consuming the injected `formatted` messages (merge into the
 *     agent's outgoing LLM prompt).
 *
 * This helper does NOT own any of those concerns — it owns only the
 * mechanical subflow mounting. Consumer-facing API
 * (`AgentBuilder.memoryPipeline()`) is layered on top.
 *
 * Why a standalone helper, not a direct `AgentBuilder` patch?
 *   - Lets us test the wire mechanism end-to-end in isolation (Layer 6)
 *     without changing the existing AgentRunner path (100+ tests).
 *   - The wire is a small, reviewable unit; the AgentBuilder refactor is
 *     a larger concern that can ship separately.
 *   - Future non-Agent concepts (Swarm, Parallel) can use the same helper
 *     — memory isn't tied to Agent conceptually.
 */
import type { FlowChartBuilder } from 'footprintjs';
import type { MemoryPipeline } from '../pipeline/types';

/**
 * Keys this helper reads from / writes to on the parent agent scope.
 * Kept as fields on the config so consumers with non-standard field names
 * can override without renaming scope properties.
 */
export interface MountMemoryPipelineConfig<ParentState> {
  /** The compiled read + write subflows from a pipeline preset. */
  readonly pipeline: MemoryPipeline;

  /**
   * Scope field name the read subflow reads identity from. Default
   * `'identity'` — matches `MemoryState.identity`. Override when the
   * host flowchart uses a different name.
   */
  readonly identityKey?: keyof ParentState & string;

  /** Scope field name for the turn counter. Default `'turnNumber'`. */
  readonly turnNumberKey?: keyof ParentState & string;

  /**
   * Scope field name for the context-tokens-remaining signal.
   * Default `'contextTokensRemaining'`.
   */
  readonly contextTokensKey?: keyof ParentState & string;

  /**
   * Scope field the read subflow writes its `formatted` output to.
   * Default `'memoryInjection'` — agent stages consume this to prepend
   * to the LLM prompt. Distinct from the pipeline's own `formatted`
   * field so there's no ambiguity between subflow-local and parent scope.
   */
  readonly injectionKey?: keyof ParentState & string;

  /**
   * Scope field the write subflow reads messages to persist from.
   * Default `'newMessages'` — populated by the agent at turn end.
   */
  readonly newMessagesKey?: keyof ParentState & string;

  /** Subflow id for the read mount. Default `'sf-memory-read'`. */
  readonly readSubflowId?: string;

  /** Subflow id for the write mount. Default `'sf-memory-write'`. */
  readonly writeSubflowId?: string;
}

// NOTE on stage ordering:
//   This helper uses `addSubFlowChartNext`, which appends the subflow at
//   the current builder tail. Consumers who need the read subflow to run
//   BEFORE a specific agent stage should arrange the call order
//   accordingly — e.g., `mountMemoryPipeline(builder).addFunction('CallLLM', ...)`.
//   If the underlying builder gains "insert before stage id" API later,
//   this helper can be extended non-breakingly.

const DEFAULTS = {
  identityKey: 'identity',
  turnNumberKey: 'turnNumber',
  contextTokensKey: 'contextTokensRemaining',
  injectionKey: 'memoryInjection',
  newMessagesKey: 'newMessages',
  readSubflowId: 'sf-memory-read',
  writeSubflowId: 'sf-memory-write',
} as const;

/**
 * Mount only the READ subflow. Appends at the current builder tail, so
 * callers typically invoke this BEFORE their LLM-call stage:
 *
 *   let b = flowChart('Seed', seedFn, 'seed');
 *   b = mountMemoryRead(b, { pipeline });
 *   b = b.addFunction('CallLLM', llmStage, 'call-llm');   // reads memoryInjection
 *   b = mountMemoryWrite(b, { pipeline });                // persists newMessages
 *
 * Returns the same builder reference (fluent).
 */
export function mountMemoryRead<ParentState>(
  builder: FlowChartBuilder<ParentState>,
  config: MountMemoryPipelineConfig<ParentState>,
): FlowChartBuilder<ParentState> {
  const identityKey = config.identityKey ?? DEFAULTS.identityKey;
  const turnNumberKey = config.turnNumberKey ?? DEFAULTS.turnNumberKey;
  const contextTokensKey = config.contextTokensKey ?? DEFAULTS.contextTokensKey;
  const injectionKey = config.injectionKey ?? DEFAULTS.injectionKey;
  const readSubflowId = config.readSubflowId ?? DEFAULTS.readSubflowId;

  return builder.addSubFlowChartNext(readSubflowId, config.pipeline.read, 'Load Memory', {
    inputMapper: (parentState: Record<string, unknown>) => ({
      identity: parentState[identityKey],
      turnNumber: parentState[turnNumberKey],
      contextTokensRemaining: parentState[contextTokensKey],
      // Pass the current turn's messages through — semantic read stages
      // like `loadRelevant` derive the query from the last user
      // message here. The write-side `newMessages` field is empty
      // during read; these are two different concerns.
      messages: parentState.messages ?? [],
      newMessages: [], // write side unused in read subflow
    }),
    outputMapper: (subflowState: Record<string, unknown>) => ({
      [injectionKey]: subflowState.formatted,
    }),
  });
}

/**
 * Mount only the WRITE subflow. No-op when the pipeline has no `write`
 * (e.g., ephemeral pipelines) — returns the builder unchanged.
 */
export function mountMemoryWrite<ParentState>(
  builder: FlowChartBuilder<ParentState>,
  config: MountMemoryPipelineConfig<ParentState>,
): FlowChartBuilder<ParentState> {
  if (!config.pipeline.write) return builder;

  const identityKey = config.identityKey ?? DEFAULTS.identityKey;
  const turnNumberKey = config.turnNumberKey ?? DEFAULTS.turnNumberKey;
  const contextTokensKey = config.contextTokensKey ?? DEFAULTS.contextTokensKey;
  const newMessagesKey = config.newMessagesKey ?? DEFAULTS.newMessagesKey;
  const writeSubflowId = config.writeSubflowId ?? DEFAULTS.writeSubflowId;

  return builder.addSubFlowChartNext(writeSubflowId, config.pipeline.write, 'Save Memory', {
    inputMapper: (parentState: Record<string, unknown>) => ({
      identity: parentState[identityKey],
      turnNumber: parentState[turnNumberKey],
      contextTokensRemaining: parentState[contextTokensKey] ?? 0,
      newMessages: parentState[newMessagesKey] ?? [],
    }),
    // No outputMapper — write has no parent-visible output.
  });
}

/**
 * Convenience: mount both read and write subflows back-to-back.
 * Appropriate ONLY when the host flowchart has no stages between memory
 * read and memory write (rare — most agents have the LLM call between).
 * Prefer `mountMemoryRead` + stages + `mountMemoryWrite` for typical agents.
 */
export function mountMemoryPipeline<ParentState>(
  builder: FlowChartBuilder<ParentState>,
  config: MountMemoryPipelineConfig<ParentState>,
): FlowChartBuilder<ParentState> {
  return mountMemoryWrite(mountMemoryRead(builder, config), config);
}
