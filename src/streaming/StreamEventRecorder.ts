/**
 * StreamEventRecorder — internal plumbing that translates stream events
 * emitted on the footprintjs emit channel into the public
 * `AgentStreamEventHandler` callback shape.
 *
 * Why: agentfootprint's public API surface offers
 * `agent.run(msg, { onEvent })` — a single callback for LLM / tool /
 * turn lifecycle events. Internally those events originate in stages
 * that should NOT close over per-run callbacks (closures in stage code
 * prevent chart caching). The footprintjs-inventor answer for
 * "per-run observer that reaches every stage at every depth" is the
 * recorder system — specifically the emit channel for structured events.
 *
 * Stages emit with a uniform name scheme:
 *
 *   `agentfootprint.stream.llm_start`
 *   `agentfootprint.stream.llm_end`
 *   `agentfootprint.stream.token`
 *   `agentfootprint.stream.thinking`
 *   `agentfootprint.stream.tool_start`
 *   `agentfootprint.stream.tool_end`
 *
 * with the full `AgentStreamEvent` object as the payload. This recorder
 * reads the payload and forwards to the user's callback — zero closure
 * capture inside stages, chart becomes a pure declarative structure.
 *
 * Turn-level events (`turn_start`, `turn_end`) are NOT emitted — they
 * fire from `AgentRunner` before / after `executor.run()`, outside any
 * chart execution. `AgentRunner` dispatches those directly to the
 * caller's handler.
 */
import type { EmitRecorder, EmitEvent } from 'footprintjs';
import type { AgentStreamEvent, AgentStreamEventHandler } from './StreamEmitter';

/** Prefix all in-chart stream emits share. */
export const STREAM_EMIT_PREFIX = 'agentfootprint.stream.';

/**
 * Build an `EmitRecorder` that forwards `agentfootprint.stream.*` events
 * to the user-provided callback. Errors in the callback are swallowed —
 * matches existing error-isolation behavior so a broken listener can
 * never crash the agent.
 *
 * @param id - Recorder id. Use a stable value per consumer so it's
 *             idempotent on re-attach; default is `'agentfootprint-stream'`.
 * @param handler - User callback. Invoked once per in-chart stream event.
 */
export function createStreamEventRecorder(
  handler: AgentStreamEventHandler,
  id = 'agentfootprint-stream',
): EmitRecorder {
  return {
    id,
    onEmit(event: EmitEvent) {
      if (!event.name.startsWith(STREAM_EMIT_PREFIX)) return;
      const streamEvent = event.payload as AgentStreamEvent | undefined;
      if (!streamEvent) return;
      try {
        handler(streamEvent);
      } catch {
        /* swallow — broken consumer callback must never crash the agent */
      }
    },
  };
}
