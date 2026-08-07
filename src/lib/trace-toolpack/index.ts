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
 *
 * …and one way IN for a run that already finished: `openRecording` turns a
 * saved `recordRun` bundle back into artifacts, so last Tuesday's run is
 * as navigable as this one.
 */

export { callTraceTool, traceToolpack, TRACE_TOOL_NAMES } from './traceToolpack.js';
// `missingArtifactMessage` is deliberately NOT re-exported: it is the lazy
// pack's own answer for a tool whose optional evidence this run lacks, and a
// consumer has no call to construct one.
export { lazyTraceToolpack, NO_COMPLETED_RUN_MESSAGE } from './lazyToolpack.js';
export { openRecording, type OpenableRecording } from './openRecording.js';
export { traceDebugAgent, type TraceDebugAgentOptions } from './traceDebugAgent.js';
export {
  buildSelfExplainSkill,
  buildSelfExplainToolProvider,
  SelfExplainBinding,
  SELF_EXPLAIN_MAX_EVENTS,
  type SelfExplainInclude,
  type SelfExplainOptions,
  type SelfExplainSource,
} from './selfExplain.js';
export {
  TOOLPACK_HARD_CAPS,
  type TraceToolpackArtifacts,
  type TraceToolpackOptions,
} from './types.js';
