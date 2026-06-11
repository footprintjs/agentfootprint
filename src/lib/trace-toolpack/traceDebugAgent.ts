/**
 * traceDebugAgent — the DEDICATED conversational door over a completed
 * run's trace. One call returns a ready Agent whose entire catalog is
 * the trace toolpack and whose system prompt is the proven debugging
 * methodology (overview → drill by id → cite evidence → respect ⚠).
 *
 * The counterpart doors over the same evidence:
 *   - the UI (BacktrackView / Lens) for humans who LOOK,
 *   - `.selfExplain()` for why-questions INSIDE the main conversation
 *     (which, in delegate mode, runs one of these under the hood).
 *
 * Why dedicated (B13 posture): trace views can replay adversarial text
 * from the original run — a SEPARATE session over a COMPLETED run keeps
 * that out of the production conversation. It is also the cheap-model
 * story made real: debug a Sonnet/Opus run with a Haiku-priced session
 * that reads only what it opens, by id (~9% of the trace in the
 * example-01 fixture; the gap widens with run size).
 */

import { Agent } from '../../core/Agent.js';
import type { AgentOptions } from '../../core/agent/types.js';
import { TRACE_DEBUG_METHODOLOGY } from './debugPrompt.js';
import { traceToolpack } from './traceToolpack.js';
import type { TraceToolpackArtifacts, TraceToolpackOptions } from './types.js';

export interface TraceDebugAgentOptions {
  /** The completed run's evidence — `{ snapshot, controlDeps?, narrative? }`. */
  readonly artifacts: TraceToolpackArtifacts;
  /** Any provider — `mock()` in tests, a cheap model in production. */
  readonly provider: AgentOptions['provider'];
  readonly model: string;
  /** ReAct budget for one debugging question. Default 8. */
  readonly maxIterations?: number;
  /** Appended to the methodology system prompt (domain hints, tone). */
  readonly instruction?: string;
  /** Bounding dials forwarded to the toolpack. */
  readonly toolpack?: TraceToolpackOptions;
  /** Display name in events/metrics. Default 'TraceDebugAgent'. */
  readonly name?: string;
}

/**
 * Build the dedicated trace debugger. The returned Agent is a normal
 * Agent — `await debuggerAi.run({ message: 'Why was the refund approved?' })`
 * answers from the recorded evidence, citing runtimeStageIds.
 */
export function traceDebugAgent(options: TraceDebugAgentOptions): Agent {
  const system =
    TRACE_DEBUG_METHODOLOGY + (options.instruction ? `\n\n${options.instruction}` : '');
  return Agent.create({
    provider: options.provider,
    model: options.model,
    name: options.name ?? 'TraceDebugAgent',
    id: 'trace-debug-agent',
    maxIterations: options.maxIterations ?? 8,
  })
    .system(system)
    .tools(traceToolpack(options.artifacts, options.toolpack))
    .build();
}
