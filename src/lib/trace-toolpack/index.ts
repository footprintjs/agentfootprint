/**
 * trace-toolpack — RFC-003 Part C: the introspection toolpack.
 *
 * footprintjs trace evidence exposed as TOOLS an LLM calls: a debugging
 * model navigates a COMPLETED run's evidence by runtimeStageIds instead of
 * reading dumps. Bounded, honest (⚠ markers), redaction-respecting.
 *
 * Three doors over the same evidence:
 *   - `traceToolpack`     the raw Tool[] (mount anywhere / drive scripted)
 *   - `traceDebugAgent`   the DEDICATED conversational debugger (separate
 *                         session, any provider — cheap models welcome)
 *   - `.selfExplain()`    the IN-CONVERSATION door on the Agent builder
 *                         (skill-gated, late-bound to the agent's own
 *                         previous completed run; inline or delegate mode)
 */

export { callTraceTool, traceToolpack } from './traceToolpack.js';
export { lazyTraceToolpack, NO_COMPLETED_RUN_MESSAGE } from './lazyToolpack.js';
export { traceDebugAgent, type TraceDebugAgentOptions } from './traceDebugAgent.js';
export {
  buildSelfExplainSkill,
  buildSelfExplainToolProvider,
  SelfExplainBinding,
  type SelfExplainOptions,
} from './selfExplain.js';
export {
  TOOLPACK_HARD_CAPS,
  type TraceToolpackArtifacts,
  type TraceToolpackOptions,
} from './types.js';
