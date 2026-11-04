import type { TraceToolpackArtifacts, TraceToolpackOptions } from '../types.js';
import type { Tool, ToolExecutionContext } from '../../tools/tools.js';
import { storedCauseAssessment } from '../storedCauseBinding.js';
import { captureOwn } from '../causeCapture.js';
import { resolveToolpackOptions } from '../types.js';
import { buildIndex, stagePartOf } from './packIndex.js';
import { buildToolCallReader, buildInspectToolCall } from './toolCallJournal.js';
import { buildRunOverview } from './runOverview.js';
import { buildFindContextErrors } from './contextErrors.js';
import { buildFindInTrace } from './findInTrace.js';
import { buildTraceNode } from './nodeView.js';
import { buildTraceSlice } from './sliceView.js';
import { buildBacktrack } from './backtrackView.js';
import { buildWhoWrote, buildGetValue } from './valueQueries.js';
import { buildCauseTools } from '../causeTools.js';
import { buildReadNarrative } from './narrativeView.js';
import type { ToolCallReader } from './toolCallJournal.js';
import { innerPackSlot, askInner, framed } from '../innerDescent.js';
import type { InnerRunRecord } from '../../core/innerRunRecords.js';
import { openRecording } from '../openRecording.js';
import { WITHOUT_SUBFLOW_DOOR } from './artifactFacts.js';
import { defineTool } from '../../tools/tools.js';
import type { InnerQuestion } from '../innerDescent.js';
import {
  noInnerRecordsMessage,
  unknownInnerRunMessage,
  openSubflowArtifacts,
  definedOf,
} from './innerRecords.js';
import type { ToolpackIndex } from './packIndex.js';
import { MOUNT_SUGGESTION_CAP } from './structuralLimits.js';
import { mountChain, innerCommitCount, opensWithSeed } from '../subflowRecords.js';
import { unconfiguredCredentialProvider } from '../../identity/types.js';
import { unconfiguredArtifacts } from '../../artifacts/capability.js';
import { validateToolArgs, formatToolArgIssues } from '../../tools/toolArgsValidation.js';

// ── The factory ────────────────────────────────────────────────────────────

// LENS · tool-result · persistent-history
// reads: the completed run ← footprintjs's own owners (causalChain, commitValueAt, findLastWriter, sliceForKey,
//        arrayProvenance, elementProvenance) — re-derived nowhere; the disposition line ← the recorded event
//        the bounds ← bounded.ts, through which every value this toolpack serves passes
//        a never-dispatched call ← the bracket's typed `notDispatched`, else the history message's (`notDispatchedOf`); never `error`/`durationMs`
// law: may omit, never deny; every clause anchored to the call it was composed on.
/**
 * Build the introspection toolpack over a COMPLETED run's artifacts.
 *
 * Returns plain `Tool[]`:
 *
 * | Tool                | Question it answers                                    |
 * |---------------------|--------------------------------------------------------|
 * | `run_overview`      | What happened, broadly? (the entry point)              |
 * | `find_context_errors` | What did this run contradict itself about, and why?  |
 * | `find_in_trace`     | WHERE in this run does "…" appear? (free text → ids)   |
 * | `trace_node`        | What did step X read/write, and where did its inputs come from? |
 * | `trace_slice`       | Which chain of steps produced the data at X? (causal slice) |
 * | `backtrack`         | Why is VARIABLE K what it is? (+ `element`: who made K[i]?) — variable-first |
 * | `who_wrote`         | Which step last wrote key K?                           |
 * | `get_value`         | The full value of K as of step X (capped, truncation-marked) |
 * | `inspect_tool_call` | One tool call end to end: proposed args → ran-with args → result → outcome |
 * | `inspect_tool_run`  | INSIDE one tool call — the chart it ran, when that tool kept its record |
 * | `inspect_subflow`   | INSIDE one subflow mount — the subflow's own log, one level at a time |
 * | `read_narrative`    | The human-readable story, paginated (only when narrative provided) |
 *
 * Mount on an Agent (`Agent.create({...}).tool(...tools)`) or drive scripted
 * via {@link callTraceTool}. The tools NEVER throw on bad ids/keys — they
 * return corrective, model-visible messages (the #9 philosophy), and their
 * strict input schemas give Agent-dispatched calls free arg validation.
 *
 * Security note (B13 posture): trace content can carry adversarial text from
 * the original run (tool results, user input). Serve these tools to a
 * SEPARATE debugging session over completed runs — not to the production
 * agent mid-run — and treat tool outputs as data, not instructions.
 */
export function traceToolpack(
  artifacts: TraceToolpackArtifacts,
  options?: TraceToolpackOptions,
): Tool[] {
  // Saved-only evidence has its own graph-only door. Inspect the claim as data
  // before a snapshot getter, indexing or any graph code can run.
  let savedClaim = true;
  try {
    const cause = Object.getOwnPropertyDescriptor(artifacts, 'cause');
    savedClaim =
      storedCauseAssessment(artifacts).kind !== 'none' ||
      (cause === undefined
        ? 'cause' in artifacts
        : storedCauseAssessment(captureOwn(artifacts, 'cause')).kind !== 'none');
  } catch {
    // An accessor or hostile object cannot supply evidence for a mixed bag.
  }
  if (savedClaim) throw new TypeError('Stored capture evidence requires traceCauseTools.');
  const opts = resolveToolpackOptions(options);
  const index = buildIndex(artifacts);
  // ONE reader over the scattered tool-call evidence, shared by the two
  // tools that need it: the join at the boundary (`inspect_tool_call`) and
  // the descent through it (`inspect_tool_run`). Its lookups are lazy and
  // memoized, so a pack that opens neither pays nothing and a pack that
  // opens both pays once.
  const calls = buildToolCallReader(artifacts, index);

  const tools: Tool[] = [
    buildRunOverview(artifacts, index),
    buildFindContextErrors(artifacts, index, calls, opts),
    buildFindInTrace(artifacts, index),
    buildTraceNode(artifacts, index, opts),
    buildTraceSlice(artifacts, index, opts),
    buildBacktrack(artifacts, index, opts),
    buildWhoWrote(index, opts),
    buildGetValue(index, opts),
    buildInspectToolCall(artifacts, calls),
    buildInspectToolRun(artifacts, calls, options),
    buildInspectSubflow(artifacts, index, options),
    ...buildCauseTools(artifacts, index.nodes, options?.cause),
  ];
  if (artifacts.narrative !== undefined) {
    tools.push(buildReadNarrative(artifacts.narrative));
  }
  return tools;
}

// ── inspect_tool_run ───────────────────────────────────────────────────────

/**
 * THROUGH the boundary — the tool call's own run, opened.
 *
 * `inspect_tool_call` answers everything about a call except the question
 * that usually follows it: *and then what did it DO?* For a tool that
 * reaches into a payments API, "not traced" is the true answer. For a tool
 * that is itself a footprintjs chart, the true answer was thrown away —
 * the chart recorded every stage and nobody held the record.
 *
 * `flowchartAsTool({ keepRecord: true })` holds it. This tool opens it, and
 * three properties keep the descent from becoming a second, worse trace API:
 *
 *   - ONE VOCABULARY. The inner views are the pack's own tools, run over
 *     the inner artifact bag through `openRecording` — the same adapter a
 *     saved recording uses. There is no second implementation of "what did
 *     this step write", so there is no second implementation to drift.
 *   - TWO ID NAMESPACES, SAID OUT LOUD. Inner `runtimeStageId`s belong to
 *     the tool's chart, not the outer run. Every output says so, because a
 *     model that pastes an inner id into `trace_node` gets a correction
 *     that reads like a bug rather than like a boundary.
 *   - HONEST ABSENCE THAT NAMES THE SWITCH. `keepRecord` is off by default
 *     (retaining a snapshot per invocation is memory the caller has to
 *     agree to), so "nothing to open" is the COMMON case — and an answer
 *     that just says "nothing" teaches the model the tool is broken.
 */
function buildInspectToolRun(
  artifacts: TraceToolpackArtifacts,
  reader: ToolCallReader,
  options: TraceToolpackOptions | undefined,
): Tool {
  // One inner pack at a time, memoized by call id (`innerDescent`): three
  // drills into one inner run build one index.
  const slot = innerPackSlot((inner) => traceToolpack(inner, options));

  const openRecord = (record: InnerRunRecord): TraceToolpackArtifacts | string => {
    if (record.recording === undefined) {
      return (
        `tool call '${record.toolCallId}' ran '${record.toolName}', which keeps records — but ` +
        `THIS one could not be captured: ${record.problem ?? 'reason not recorded'}. The call ` +
        `itself was unaffected; inspect_tool_call('${record.toolCallId}') still has the ` +
        `envelope (arguments in, result out).`
      );
    }
    try {
      const inner: TraceToolpackArtifacts = {
        // `openRecording` is the adapter, not a copy of it: same lift, same
        // two teaching refusals if the bag is malformed. The two fields it
        // cannot lift from JSON — control edges, and a narrative nobody
        // attached — are added here because this record is LIVE in process.
        ...openRecording(record.recording),
        ...(record.controlDeps !== undefined && { controlDeps: record.controlDeps }),
        ...(record.narrative !== undefined && { narrative: record.narrative }),
      };
      WITHOUT_SUBFLOW_DOOR.add(inner);
      return inner;
    } catch (e) {
      return (
        `the retained record for '${record.toolCallId}' could not be opened: ` +
        `${e instanceof Error ? e.message : String(e)}`
      );
    }
  };

  return defineTool<
    {
      toolCallId: string;
      runtimeStageId?: string;
      key?: string;
      variable?: string;
      find?: string;
      cause?: InnerQuestion['cause'];
      nodeId?: string;
    },
    string
  >({
    name: 'inspect_tool_run',
    description:
      'Go INSIDE one tool call. Some tools are themselves recorded flowcharts and keep the ' +
      'record of what they ran; this opens it. Called with just a toolCallId it returns a ' +
      'bounded overview of the inner run (its stages, its errors, its state keys). Add ' +
      "'find' to search that inner run in free text, 'variable' to ask why an inner value is " +
      "what it is, 'key' alone for who last wrote an inner key, 'runtimeStageId' to open one " +
      "inner step, or both 'runtimeStageId' and 'key' for an inner value in full. The ids it returns are the INNER chart's — the " +
      'outer trace tools do not accept them. Reach for it when inspect_tool_call says a ' +
      'record was kept and the question is about what the tool DID, not what it returned.',
    inputSchema: {
      type: 'object',
      properties: {
        toolCallId: {
          type: 'string',
          description:
            "The tool call to descend into — the same id inspect_tool_call takes, e.g. 'c1'.",
        },
        runtimeStageId: {
          type: 'string',
          description:
            "Optional: open ONE step of the inner run (an inner id, from this tool's own " +
            'overview — not an outer step id).',
        },
        key: {
          type: 'string',
          description:
            "Optional: an inner state key, e.g. 'forecast' — alone, who last wrote it inside; " +
            'with runtimeStageId, its value in full as of that step.',
        },
        variable: {
          type: 'string',
          description:
            'Optional: an inner state key to explain — anchors at its last writer inside the ' +
            'chart and walks back.',
        },
        find: {
          type: 'string',
          description: 'Optional: free text to locate inside the inner run (returns inner ids).',
        },
        cause: {
          type: 'string',
          enum: ['attention_list', 'root_cause', 'impact'],
          description: 'Optional: ask a bounded cause tool inside this retained run.',
        },
        nodeId: {
          type: 'string',
          description: 'An opaque node id returned by attention_list inside this retained run.',
        },
      },
      required: ['toolCallId'],
      additionalProperties: false,
    },
    execute: async ({ toolCallId, runtimeStageId, key, variable, find, cause, nodeId }, ctx) => {
      const lookup = artifacts.innerRuns;
      if (lookup === undefined) return noInnerRecordsMessage(toolCallId);

      const record = lookup.get(toolCallId);
      if (record === undefined) return unknownInnerRunMessage(toolCallId, lookup, reader);

      const inner = slot(record.toolCallId, () => openRecord(record));
      if (typeof inner === 'string') return inner;

      const body = await askInner(
        inner,
        { runtimeStageId, key, variable, find, cause, nodeId },
        callTraceTool,
        ctx,
      );
      return framed(
        {
          header:
            `INSIDE TOOL CALL ${toolCallId} — '${record.toolName}' ran a recorded flowchart ` +
            `(${record.steps} committed step(s), ${record.outcome}).`,
          next:
            `next inside call '${toolCallId}': inspect_tool_run({ toolCallId: '${toolCallId}', ` +
            `runtimeStageId: '<inner id>' }) opens a step · add 'key' for a value in full · ` +
            `'variable' asks why an inner value is what it is · 'find' searches this inner run.`,
          namespace:
            `⚠ the ids above are INNER ids — they name steps of ${record.toolName}'s own chart, ` +
            `not of the run that called it. trace_node / get_value / trace_slice do not accept ` +
            `them; come back through inspect_tool_run.`,
        },
        body,
      );
    },
  });
}

/**
 * INSIDE a subflow mount — the subflow's OWN log, opened.
 *
 * A subflow runs in an isolated runtime and commits to its own log, so this
 * run's log holds only the mount boundary: what went in, what came back. The
 * evidence of who wrote a value IN there was always recorded (footprintjs keeps
 * it in `subflowResults`) — no tool served it. This one does, through the same
 * descent `inspect_tool_run` uses (`innerDescent`): the inner views are the
 * pack's own tools over the mount's own record, so the inner answers carry the
 * same reason codes, folded from the SUBFLOW's own `initialState`.
 *
 *   - BY REFERENCE. Nothing from inside a subflow is printed until the model
 *     asks; the outer views carry one line naming the door.
 *   - ONE LEVEL AT A TIME. A mount nested inside a subflow is opened through
 *     its parent's pack — this tool walks the chain (`mountChain`), each level
 *     answering only for its own log.
 *   - ITS OWN NAMESPACE. Inner ids are said to be inner on every answer, and
 *     an outer tool handed one corrects toward here (`innerIdMessage`).
 */
function buildInspectSubflow(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  options: TraceToolpackOptions | undefined,
): Tool {
  const slot = innerPackSlot((inner) => traceToolpack(inner, options));
  const isStep = (id: string): boolean => index.nodes.has(id) || index.firstIdxOf.has(id);
  const mountIds = (): string[] => index.orderedIds.filter((id) => index.nodes.get(id)?.subflowId);

  const notAMount = (mount: string): string => {
    if (isStep(mount)) {
      return `'${mount}' is an outer step, not a subflow mount — trace_node('${mount}') opens it.`;
    }
    const mounts = mountIds();
    const sameStage = mounts.filter((id) => stagePartOf(id) === mount);
    if (sameStage.length > 0) {
      return (
        `'${mount}' ran ${sameStage.length} time(s); a mount is ONE execution: ` +
        `${sameStage.slice(0, MOUNT_SUGGESTION_CAP).join(', ')}` +
        `${sameStage.length > MOUNT_SUGGESTION_CAP ? ', …' : ''}. Retry with one of those ids.`
      );
    }
    if (mounts.length === 0)
      return `the traced run mounted no subflows — there is no inner log to open.`;
    return (
      `unknown mount '${mount}'. Subflow mounts in the traced run: ` +
      `${mounts.slice(0, MOUNT_SUGGESTION_CAP).join(', ')}` +
      `${mounts.length > MOUNT_SUGGESTION_CAP ? ', …' : ''}.`
    );
  };

  return defineTool<
    {
      mount: string;
      runtimeStageId?: string;
      key?: string;
      variable?: string;
      find?: string;
      cause?: InnerQuestion['cause'];
      nodeId?: string;
    },
    string
  >({
    name: 'inspect_subflow',
    description:
      "Open a [subflow] step's OWN log (the run's log holds only its boundary). Mount id alone: " +
      "inner overview. 'key': its last writer inside. 'variable': why it is what it is. " +
      "'find': search. 'runtimeStageId' (+'key'): one inner step (value). Inner ids go back here.",
    inputSchema: {
      type: 'object',
      properties: {
        mount: { type: 'string', description: "The mount step, e.g. 'sf-tools#11'." },
        runtimeStageId: { type: 'string', description: 'Optional: an inner step id.' },
        key: { type: 'string', description: 'Optional: an inner state key.' },
        variable: { type: 'string', description: 'Optional: an inner state key to explain.' },
        find: { type: 'string', description: 'Optional: free text to locate inside.' },
        cause: {
          type: 'string',
          enum: ['attention_list', 'root_cause', 'impact'],
          description: 'Optional: ask a bounded cause tool inside this subflow.',
        },
        nodeId: {
          type: 'string',
          description: 'An opaque node id returned by attention_list inside this subflow.',
        },
      },
      required: ['mount'],
      additionalProperties: false,
    },
    execute: async ({ mount, runtimeStageId, key, variable, find, cause, nodeId }, ctx) => {
      const question = { runtimeStageId, key, variable, find, cause, nodeId };
      const results = index.subflowResults;
      const isMount = index.nodes.get(mount)?.subflowId !== undefined;

      // A mount nested below this level: open its parent here, ask there.
      if (!isMount && !isStep(mount) && results !== undefined) {
        const chain = mountChain(results, mount, isStep);
        if (chain !== undefined && chain.length > 1) {
          const parent = chain[0] as string;
          const pack = slot(parent, () => openSubflowArtifacts(artifacts, parent));
          if (typeof pack === 'string') return pack;
          return callTraceTool(pack, 'inspect_subflow', { mount, ...definedOf(question) }, ctx);
        }
      }
      if (!isMount) return notAMount(mount);

      if (
        runtimeStageId !== undefined &&
        runtimeStageId !== mount &&
        isStep(runtimeStageId) &&
        index.homeMountOf(runtimeStageId) !== mount
      ) {
        return (
          `'${runtimeStageId}' is a step of the run ABOVE subflow ${mount}, not of its own log — ` +
          `trace_node('${runtimeStageId}') opens it there.`
        );
      }

      const inner = slot(mount, () => openSubflowArtifacts(artifacts, mount));
      if (typeof inner === 'string') return inner;

      const body = await askInner(inner, question, callTraceTool, ctx);
      const name = index.nodes.get(mount)?.name;
      const parent = index.homeMountOf(mount);
      const commits = innerCommitCount(index.subflowResults, mount);
      return framed(
        {
          header:
            `INSIDE SUBFLOW ${mount}${name !== undefined ? ` — "${name}"` : ''}` +
            `${parent !== undefined ? ` (nested in ${parent})` : ''}: its own log, ` +
            `${commits} commit(s)${
              opensWithSeed(index.subflowResults, mount) ? ", the mount's seed first" : ''
            }.`,
          next:
            `next inside '${mount}': inspect_subflow({ mount: '${mount}', runtimeStageId: ` +
            `'<inner id>' }) opens a step · 'key' alone names its last writer inside · 'variable' ` +
            `asks why an inner value is what it is · 'find' searches this inner log.`,
          namespace:
            `⚠ the ids above are INNER ids — steps of subflow ${mount}'s own log, not of the run ` +
            `that mounted it. trace_node / get_value / trace_slice correct them back here.`,
        },
        body,
      );
    },
  });
}

// ── Scripted/offline invocation (the auditor pattern) ─────────────────────

/**
 * Minimal offline ToolExecutionContext — trace tools never use credentials.
 *
 * `teardownScopes: []` is a STATEMENT, not an omission (9.7.0): nothing fires
 * here, ever. There is no run, no session and no dispatch loop to settle a call
 * against — this context exists so a toolpack tool can be invoked from a script.
 * A tool that reads the empty list knows not to open anything it would need
 * closed; a tool that calls `onTeardown` anyway is refused by name rather than
 * having its cleanup silently filed where nothing will run it.
 */
const OFFLINE_CONTEXT: ToolExecutionContext = {
  toolCallId: 'trace-toolpack-offline',
  iteration: 0,
  credentials: unconfiguredCredentialProvider(),
  hasCredentials: false,
  // Offline has no run to scope refs to; the capability teaches, never lies.
  artifacts: unconfiguredArtifacts(),
  hasArtifacts: false,
  // Offline has no stage to emit from and no dispatcher to reach (9.52.0);
  // a progress report is dropped rather than refused, because losing telemetry
  // is not a reason to fail a call that is doing its work.
  progress: () => {
    /* nowhere to file it offline — see the note above */
  },
  teardownScopes: [],
  onTeardown: () => {
    throw new Error(
      'callTraceTool: onTeardown is not honoured offline — `ctx.teardownScopes` is empty, ' +
        'so no scope would ever fire. Run this tool inside an Agent if it holds a session.',
    );
  },
};

/**
 * Invoke a toolpack tool OUTSIDE an Agent (scripted debug sessions, tests,
 * offline auditors). Mirrors the Agent's #9 boundary: args are validated
 * against the tool's inputSchema first, and an invalid call returns the same
 * model-visible correction string instead of executing.
 */
export async function callTraceTool(
  tools: readonly Tool[],
  name: string,
  args: Record<string, unknown> = {},
  context: ToolExecutionContext = OFFLINE_CONTEXT,
): Promise<string> {
  const tool = tools.find((candidate) => candidate.schema.name === name);
  if (!tool) {
    const available = tools.map((candidate) => candidate.schema.name).join(', ');
    throw new Error(`callTraceTool: no tool named '${name}'. Available: ${available}`);
  }
  const verdict = validateToolArgs(args, tool.schema.inputSchema);
  if (!verdict.ok) return formatToolArgIssues(name, verdict.issues);
  return String(await tool.execute(args, context));
}
