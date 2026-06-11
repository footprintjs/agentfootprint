/**
 * trace-toolpack — RFC-003 Part C: the introspection toolpack.
 *
 * footprintjs trace evidence exposed as TOOLS an LLM calls: a debugging
 * model navigates a COMPLETED run's evidence by runtimeStageIds instead of
 * reading dumps. Bounded, honest (⚠ markers), redaction-respecting.
 */

export { callTraceTool, traceToolpack } from './traceToolpack.js';
export {
  TOOLPACK_HARD_CAPS,
  type TraceToolpackArtifacts,
  type TraceToolpackOptions,
} from './types.js';
