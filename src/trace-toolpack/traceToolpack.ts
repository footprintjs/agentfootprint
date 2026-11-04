/**
 * traceToolpack — footprintjs trace evidence exposed as TOOLS an LLM calls
 * (RFC-003 Part C: the introspection toolpack).
 *
 * "The framework's internal tool for itself": after a run completes, a
 * debugging LLM (a cheap model in a SEPARATE session) navigates the run's
 * evidence by ids instead of reading dumps — the same just-in-time,
 * token-efficient loading pattern as `read_skill`. Feed the slice, not the
 * trace; the LLM ranks by navigating, so no embedder is needed.
 *
 * Pattern: Factory over frozen artifacts. `traceToolpack(artifacts)` returns
 *          plain `Tool[]` — mount them on any Agent, or drive them scripted
 *          via `callTraceTool` (the offline auditor pattern, like
 *          examples/features/20). Nothing re-runs; every tool is a bounded
 *          read-only VIEW over a COMPLETED run's snapshot + commit log.
 *
 * The toolpack's three contracts (B13 posture):
 *
 *   1. BOUNDED BY DEFAULT — every output is capped (previews, slice
 *      depth/nodes, value chars, narrative lines). Per-call params raise
 *      the budget only up to hard caps the LLM cannot exceed.
 *   2. HONEST — truncation and incompleteness are ALWAYS marked (⚠), never
 *      silent: truncated slices, untracked sources (args/env/silent reads),
 *      missing read tracking, missing control-dependence lookup, values the
 *      commit log cannot see (pre-run state, closures).
 *   3. REDACTION-RESPECTING — the commit log already carries redacted
 *      payloads (footprintjs scrubs at commit time); the toolpack passes
 *      placeholders through verbatim and flags redacted keys. It never
 *      reconstructs around a redaction.
 *
 * Why ids: every view names steps by `runtimeStageId`
 * (`stageId#executionIndex`) — the universal key linking the commit log,
 * the execution tree, and recorder events. The LLM drills like a debugger:
 * overview → slice → node → value, paying only for what it opens.
 */

import 'foottrace';
import 'foottrace';
import '../tools/toolArgsValidation.js';
import '../tools/tools.js';
import '../identity/types.js';
import '../artifacts/capability.js';
import './bounded.js';
import './innerDescent.js';
import './openRecording.js';
import './causeTools.js';
import './storedCauseBinding.js';
import './causeCapture.js';
import './subflowRecords.js';
import './types.js';

/**
 * The tool names this pack can mount — declared in `traceToolNames.ts` so the
 * Agent builder can reserve them WITHOUT loading this module (the pack is
 * mounted lazily since 9.94.0); re-exported here so the list still reads as
 * the pack's own.
 */
export { TRACE_TOOL_NAMES } from '../lib/traceToolNames.js';

export { traceToolpack, callTraceTool } from './traceToolpack/recursiveFactory.js';
