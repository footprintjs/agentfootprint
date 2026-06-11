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

import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import { causalChain, commitValueAt, findLastWriter, formatCausalChain } from 'footprintjs/trace';

import { formatToolArgIssues, validateToolArgs } from '../../core/agent/toolArgsValidation.js';
import { defineTool, type Tool, type ToolExecutionContext } from '../../core/tools.js';
import { unconfiguredCredentialProvider } from '../../identity/types.js';
import {
  boundedPreview,
  clampParam,
  displayKey,
  displayText,
  normalizeKey,
  renderPreview,
  safeStringify,
} from './bounded.js';
import {
  resolveToolpackOptions,
  TOOLPACK_HARD_CAPS,
  type ResolvedToolpackOptions,
  type TraceToolpackArtifacts,
  type TraceToolpackOptions,
} from './types.js';

// ── Display caps that are structural (not consumer-tunable) ───────────────

const OVERVIEW_STAGE_CAP = 40;
const OVERVIEW_KEY_CAP = 40;
const OVERVIEW_ERROR_CAP = 10;
const OVERVIEW_DESCRIPTION_CAP = 140;
const NODE_WRITE_CAP = 20;
const NODE_READ_CAP = 30;
const NARRATIVE_LINE_CHAR_CAP = 400;
const UNKNOWN_ID_SUGGESTION_CAP = 8;
const KEY_SUGGESTION_CAP = 12;
/** Schemas embed an `enum` of valid ids/keys only when the set is small —
 *  free #9 validation without bloating the tools block on long runs. */
const SCHEMA_ENUM_CAP = 48;

// ── Internal index over the artifacts (built once per factory call) ───────

interface StageGroup {
  /** The stage part of the runtimeStageId (path-prefixed stageId). */
  stagePart: string;
  ids: string[];
  name?: string;
  description?: string;
  isDecider: boolean;
  isSubflow: boolean;
  errorIds: string[];
}

interface ToolpackIndex {
  commitLog: CommitBundle[];
  /** runtimeStageId → first commit array index. */
  firstIdxOf: Map<string, number>;
  /** runtimeStageId → last commit array index (double-commits possible). */
  lastIdxOf: Map<string, number>;
  /** runtimeStageId → all bundles for that step. */
  bundlesOf: Map<string, CommitBundle[]>;
  /** runtimeStageId → execution-tree node (name/description/reads/errors). */
  nodes: Map<string, StageSnapshot>;
  /** Tree-walk order ≈ execution order; the id universe for navigation. */
  orderedIds: string[];
  /** stage part → ids, for unknown-id suggestions. */
  idsByStagePart: Map<string, string[]>;
  /** Every path the commit log ever wrote (engine DELIM form). */
  knownPaths: Set<string>;
  /** Distinct stages in first-execution order. */
  groups: StageGroup[];
  /** True when at least one step recorded tracked reads. */
  hasReadTracking: boolean;
  /** Steps with `$error` entries: where things went wrong. */
  errorSteps: { id: string; keys: string[] }[];
  /** Count of steps that consumed untracked sources (args/env/silent). */
  untrackedStepCount: number;
}

function stagePartOf(runtimeStageId: string): string {
  const hash = runtimeStageId.lastIndexOf('#');
  return hash > 0 ? runtimeStageId.slice(0, hash) : runtimeStageId;
}

function buildIndex(artifacts: TraceToolpackArtifacts): ToolpackIndex {
  const commitLog = artifacts.snapshot.commitLog ?? [];
  const firstIdxOf = new Map<string, number>();
  const lastIdxOf = new Map<string, number>();
  const bundlesOf = new Map<string, CommitBundle[]>();
  const knownPaths = new Set<string>();
  let untrackedStepCount = 0;

  for (let i = 0; i < commitLog.length; i++) {
    const bundle = commitLog[i];
    const id = bundle.runtimeStageId;
    if (!firstIdxOf.has(id)) firstIdxOf.set(id, i);
    lastIdxOf.set(id, i);
    const list = bundlesOf.get(id);
    if (list) list.push(bundle);
    else {
      bundlesOf.set(id, [bundle]);
      if (bundle.untrackedSources && bundle.untrackedSources.length > 0) untrackedStepCount++;
    }
    for (const entry of bundle.trace) knownPaths.add(entry.path);
  }

  // Walk the execution tree: node → children → next (≈ execution order).
  const nodes = new Map<string, StageSnapshot>();
  const orderedIds: string[] = [];
  const errorSteps: { id: string; keys: string[] }[] = [];
  let hasReadTracking = false;
  const visit = (node: StageSnapshot | undefined): void => {
    if (!node) return;
    const id = node.runtimeStageId;
    if (id && !nodes.has(id)) {
      nodes.set(id, node);
      orderedIds.push(id);
      if (node.stageReads && Object.keys(node.stageReads).length > 0) hasReadTracking = true;
      const errorKeys = Object.keys(node.errors ?? {});
      if (errorKeys.length > 0) errorSteps.push({ id, keys: errorKeys });
    }
    for (const child of node.children ?? []) visit(child);
    visit(node.next);
  };
  visit(artifacts.snapshot.executionTree);

  // Steps present in the commit log but missing from the tree (defensive).
  for (const id of bundlesOf.keys()) {
    if (!nodes.has(id)) orderedIds.push(id);
  }

  const idsByStagePart = new Map<string, string[]>();
  const groupsByStagePart = new Map<string, StageGroup>();
  const groups: StageGroup[] = [];
  for (const id of orderedIds) {
    const stagePart = stagePartOf(id);
    const ids = idsByStagePart.get(stagePart);
    if (ids) ids.push(id);
    else idsByStagePart.set(stagePart, [id]);

    let group = groupsByStagePart.get(stagePart);
    if (!group) {
      group = { stagePart, ids: [], isDecider: false, isSubflow: false, errorIds: [] };
      groupsByStagePart.set(stagePart, group);
      groups.push(group);
    }
    group.ids.push(id);
    const node = nodes.get(id);
    if (node) {
      if (group.name === undefined && node.name !== undefined) group.name = node.name;
      if (group.description === undefined && node.description !== undefined) {
        group.description = node.description;
      }
      if (node.isDecider) group.isDecider = true;
      if (node.subflowId !== undefined) group.isSubflow = true;
      if (Object.keys(node.errors ?? {}).length > 0) group.errorIds.push(id);
    } else {
      const bundle = bundlesOf.get(id)?.[0];
      if (group.name === undefined && bundle) group.name = bundle.stage;
    }
  }

  return {
    commitLog,
    firstIdxOf,
    lastIdxOf,
    bundlesOf,
    nodes,
    orderedIds,
    idsByStagePart,
    knownPaths,
    groups,
    hasReadTracking,
    errorSteps,
    untrackedStepCount,
  };
}

// ── Shared message helpers ─────────────────────────────────────────────────

function unknownIdMessage(id: string, index: ToolpackIndex): string {
  const stagePart = stagePartOf(id);
  const siblings = index.idsByStagePart.get(stagePart);
  if (siblings && siblings.length > 0) {
    return (
      `unknown runtimeStageId '${id}'. Stage '${stagePart}' has ${siblings.length} ` +
      `execution(s): ${siblings.slice(0, UNKNOWN_ID_SUGGESTION_CAP).join(', ')}` +
      (siblings.length > UNKNOWN_ID_SUGGESTION_CAP ? ', …' : '') +
      `. Retry with one of those ids.`
    );
  }
  const sample = index.orderedIds.slice(0, UNKNOWN_ID_SUGGESTION_CAP).join(', ');
  return (
    `unknown runtimeStageId '${id}'. Ids look like stageId#executionIndex` +
    (sample
      ? ` — known steps include: ${sample}${
          index.orderedIds.length > UNKNOWN_ID_SUGGESTION_CAP ? ', …' : ''
        }`
      : '') +
    `. Call run_overview to list every stage.`
  );
}

function unknownKeySuffix(index: ToolpackIndex): string {
  if (index.knownPaths.size === 0) return '';
  const sample = [...index.knownPaths].slice(0, KEY_SUGGESTION_CAP).map(displayKey).join(', ');
  return ` Known keys include: ${sample}${
    index.knownPaths.size > KEY_SUGGESTION_CAP ? ', …' : ''
  }.`;
}

/** Is `path` redacted in any bundle of this step (or, keyless, of the writer)? */
function redactionNote(bundles: readonly CommitBundle[] | undefined, path: string): string {
  const redacted = (bundles ?? []).some((b) => b.redactedPaths.includes(path));
  return redacted ? ' (redacted by policy)' : '';
}

/** Union of untracked sources across a step's bundles. */
function untrackedSourcesOf(bundles: readonly CommitBundle[] | undefined): string[] {
  const set = new Set<string>();
  for (const bundle of bundles ?? []) {
    for (const source of bundle.untrackedSources ?? []) set.add(source);
  }
  return [...set];
}

function truncateText(text: string, cap: number): string {
  return text.length > cap ? `${text.slice(0, cap)}…` : text;
}

// ── The factory ────────────────────────────────────────────────────────────

/**
 * Build the introspection toolpack over a COMPLETED run's artifacts.
 *
 * Returns plain `Tool[]`:
 *
 * | Tool             | Question it answers                                       |
 * |------------------|-----------------------------------------------------------|
 * | `run_overview`   | What happened, broadly? (the entry point)                 |
 * | `trace_node`     | What did step X read/write, and where did its inputs come from? |
 * | `trace_slice`    | Which chain of steps produced the data at X? (causal slice) |
 * | `who_wrote`      | Which step last wrote key K?                              |
 * | `get_value`      | The full value of K as of step X (capped, truncation-marked) |
 * | `read_narrative` | The human-readable story, paginated (only when narrative provided) |
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
  const opts = resolveToolpackOptions(options);
  const index = buildIndex(artifacts);

  const tools: Tool[] = [
    buildRunOverview(artifacts, index),
    buildTraceNode(artifacts, index, opts),
    buildTraceSlice(artifacts, index, opts),
    buildWhoWrote(index, opts),
    buildGetValue(index, opts),
  ];
  if (artifacts.narrative !== undefined) {
    tools.push(buildReadNarrative(artifacts.narrative));
  }
  return tools;
}

// ── Schema fragments ───────────────────────────────────────────────────────

function idProperty(index: ToolpackIndex, description: string): Record<string, unknown> {
  const property: Record<string, unknown> = { type: 'string', description };
  if (index.orderedIds.length > 0 && index.orderedIds.length <= SCHEMA_ENUM_CAP) {
    property.enum = index.orderedIds;
  }
  return property;
}

/**
 * Key params get guidance (known keys in the description) but NO enum:
 * unlike step ids — whose universe is complete — a key OUTSIDE the commit
 * log is a legitimate question with an honest answer ("args/env/pre-run
 * values never enter the commit log ⚠"), and an enum would block that path.
 */
function keyProperty(index: ToolpackIndex, description: string): Record<string, unknown> {
  let hint = '';
  if (index.knownPaths.size > 0 && index.knownPaths.size <= SCHEMA_ENUM_CAP) {
    hint = ` Tracked keys: ${[...index.knownPaths].map(displayKey).join(', ')}.`;
  }
  return { type: 'string', description: `${description}${hint}` };
}

// ── run_overview ───────────────────────────────────────────────────────────

function buildRunOverview(artifacts: TraceToolpackArtifacts, index: ToolpackIndex): Tool {
  return defineTool<Record<string, never>, string>({
    name: 'run_overview',
    description:
      'Start here. One bounded summary of the completed run: status, step counts, every ' +
      'stage (id + name + description), loop counts, where errors appeared, and honesty notes. ' +
      "Step ids look like 'stageId#executionIndex' (e.g. 'normalize#0'); every other trace " +
      'tool accepts them.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    execute: () => {
      const lines: string[] = ['TRACE RUN OVERVIEW'];
      lines.push(
        index.errorSteps.length > 0
          ? `status: ⚠ completed with ${index.errorSteps.length} step error(s) — see ERRORS below`
          : 'status: no step errors recorded',
      );
      lines.push(
        `execution steps: ${index.orderedIds.length} · distinct stages: ${index.groups.length} · ` +
          `commit-log mode: ${artifacts.snapshot.commitValues}`,
      );
      const example = index.orderedIds[0] ?? 'stageId#0';
      lines.push(
        `step ids look like stageId#executionIndex (e.g. '${example}') — pass them to ` +
          `trace_node / trace_slice / get_value.`,
      );

      lines.push('', `STAGES (${index.groups.length} distinct, first-execution order):`);
      for (const group of index.groups.slice(0, OVERVIEW_STAGE_CAP)) {
        const flags = [
          group.isDecider ? ' [decision]' : '',
          group.isSubflow ? ' [subflow]' : '',
        ].join('');
        const name = group.name !== undefined ? ` — "${group.name}"` : '';
        const description =
          group.description !== undefined
            ? `: ${truncateText(group.description, OVERVIEW_DESCRIPTION_CAP)}`
            : '';
        const errors =
          group.errorIds.length > 0
            ? ` ⚠ errors in ${group.errorIds.slice(0, 3).join(', ')}${
                group.errorIds.length > 3 ? ', …' : ''
              }`
            : '';
        lines.push(
          `- ${group.stagePart} ×${group.ids.length}${flags}${name}${description}${errors}`,
        );
      }
      if (index.groups.length > OVERVIEW_STAGE_CAP) {
        lines.push(`…and ${index.groups.length - OVERVIEW_STAGE_CAP} more stages (output capped)`);
      }

      const loops = index.groups.filter((g) => g.ids.length > 1);
      if (loops.length > 0) {
        const top = [...loops]
          .sort((a, b) => b.ids.length - a.ids.length)
          .slice(0, 5)
          .map((g) => `${g.stagePart} ×${g.ids.length}`)
          .join(' · ');
        lines.push('', `LOOPS: ${top}`);
      }

      if (index.errorSteps.length > 0) {
        lines.push('', 'ERRORS:');
        for (const step of index.errorSteps.slice(0, OVERVIEW_ERROR_CAP)) {
          lines.push(
            `- ⚠ ${step.id}: ${step.keys.join(', ')} (drill with trace_node('${step.id}'))`,
          );
        }
        if (index.errorSteps.length > OVERVIEW_ERROR_CAP) {
          lines.push(`…and ${index.errorSteps.length - OVERVIEW_ERROR_CAP} more error steps`);
        }
      }

      if (index.untrackedStepCount > 0) {
        lines.push(
          '',
          `HONESTY: ⚠ ${index.untrackedStepCount} step(s) consumed untracked inputs (args/env/silent ` +
            `reads) — causal slices through them may be incomplete; trace_node marks each one.`,
        );
      }

      const stateKeys = Object.keys(artifacts.snapshot.sharedState ?? {});
      const shown = stateKeys.slice(0, OVERVIEW_KEY_CAP).map(displayKey);
      lines.push(
        '',
        `SHARED STATE KEYS (${stateKeys.length}): ${shown.join(', ')}` +
          (stateKeys.length > OVERVIEW_KEY_CAP
            ? `, … +${stateKeys.length - OVERVIEW_KEY_CAP} more`
            : '') +
          ' — values via who_wrote / get_value.',
      );

      if (artifacts.narrative !== undefined) {
        lines.push(
          `NARRATIVE: ${artifacts.narrative.length} line(s) available via read_narrative.`,
        );
      }

      return lines.join('\n');
    },
  });
}

// ── trace_node ─────────────────────────────────────────────────────────────

function buildTraceNode(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  opts: ResolvedToolpackOptions,
): Tool {
  return defineTool<{ runtimeStageId: string }, string>({
    name: 'trace_node',
    description:
      'Inspect ONE execution step by runtimeStageId: name + description, what it wrote ' +
      '(bounded previews + true sizes), what it read, its parents (which step provided each ' +
      'input, plus the decision that routed to it when known), errors, and ⚠ honesty markers. ' +
      'The drill-down primitive — use ids from run_overview, trace_slice, or who_wrote.',
    inputSchema: {
      type: 'object',
      properties: {
        runtimeStageId: idProperty(index, "The step to inspect, e.g. 'normalize#0'."),
      },
      required: ['runtimeStageId'],
      additionalProperties: false,
    },
    execute: ({ runtimeStageId }) => {
      const node = index.nodes.get(runtimeStageId);
      const bundles = index.bundlesOf.get(runtimeStageId);
      if (!node && !bundles) return unknownIdMessage(runtimeStageId, index);

      const lines: string[] = [];
      const flags = [
        node?.isDecider ? ' [decision]' : '',
        node?.subflowId ? ' [subflow]' : '',
      ].join('');
      const name = node?.name ?? bundles?.[0]?.stage ?? stagePartOf(runtimeStageId);
      lines.push(`STEP ${runtimeStageId} — "${name}"${flags}`);
      if (node?.description) lines.push(`description: ${node.description}`);

      // Writes — verb-aware values via commitValueAt (delta-mode safe).
      const writes = new Map<string, string>(); // path → verb (last wins)
      for (const bundle of bundles ?? []) {
        for (const entry of bundle.trace) writes.set(entry.path, entry.verb);
      }
      if (writes.size === 0) {
        lines.push('wrote: nothing committed');
      } else {
        lines.push(`wrote (${writes.size}):`);
        const lastIdx = index.lastIdxOf.get(runtimeStageId) ?? index.commitLog.length - 1;
        let shown = 0;
        for (const [path, verb] of writes) {
          if (shown >= NODE_WRITE_CAP) {
            lines.push(`…and ${writes.size - NODE_WRITE_CAP} more keys (output capped)`);
            break;
          }
          const preview = boundedPreview(
            commitValueAt(index.commitLog, lastIdx, path),
            opts.previewChars,
          );
          const dotted = displayKey(path);
          lines.push(
            `- ${dotted} (${verb}): ${displayText(
              renderPreview(preview, `get_value('${runtimeStageId}', '${dotted}') for full`),
            )}${redactionNote(bundles, path)}`,
          );
          shown++;
        }
      }

      // Reads + parents.
      const reads = node?.stageReads ? Object.keys(node.stageReads) : [];
      if (reads.length === 0) {
        lines.push(
          index.hasReadTracking
            ? 'read: no tracked reads recorded'
            : 'read: no tracked reads recorded ⚠ (artifacts carry no read tracking)',
        );
      } else {
        const shownReads = reads.slice(0, NODE_READ_CAP).map(displayKey).join(', ');
        lines.push(
          `read (${reads.length}): ${shownReads}${
            reads.length > NODE_READ_CAP ? ', … (output capped)' : ''
          }`,
        );
      }

      const parentLines: string[] = [];
      const anchorIdx = anchorIdxFor(runtimeStageId, index);
      for (const key of reads.slice(0, NODE_READ_CAP)) {
        const writer = findLastWriter(index.commitLog, key, anchorIdx);
        parentLines.push(
          writer
            ? `- data: ${displayKey(key)} ← ${writer.runtimeStageId} "${writer.stage}"`
            : `- data: ${displayKey(key)} ← (no tracked writer — run input/env/pre-run state ⚠)`,
        );
      }
      const controlDep = artifacts.controlDeps?.(runtimeStageId);
      if (controlDep) {
        parentLines.push(
          `- control: routed here by ${controlDep.deciderId}` +
            (controlDep.label ? ` — rule "${controlDep.label}"` : ''),
        );
      }
      if (parentLines.length > 0) {
        lines.push('parents:');
        lines.push(...parentLines);
      }
      if (!artifacts.controlDeps) {
        lines.push(
          '⚠ control-dependence lookup not provided — the decision that routed here is unknown.',
        );
      }

      const untracked = untrackedSourcesOf(bundles);
      if (untracked.length > 0) {
        lines.push(
          `⚠ this step also consumed ${untracked.join(
            '/',
          )} — those inputs are NOT in the parents ` +
            `list; the slice through this step may be incomplete.`,
        );
      }

      // The tool boundary, named honestly: the agent chart's tool-execution
      // stage runs CONSUMER code (DB calls, services). The trace records the
      // envelope — args in, results out — never the internals. Gated on the
      // agent-chart signature (a call-llm stage exists) so a generic chart
      // with a coincidental 'tool-calls' stage gets no false marker.
      const isAgentChart = [...index.idsByStagePart.keys()].some(
        (part) => part.split('/').pop() === 'call-llm',
      );
      if (isAgentChart && stagePartOf(runtimeStageId).split('/').pop() === 'tool-calls') {
        lines.push(
          '⚠ boundary: tool execution happens in consumer systems — the trace records ' +
            'arguments in / results out; tool internals are not traced unless the tool ' +
            'returns its own diagnostic refs.',
        );
      }

      const errorKeys = Object.keys(node?.errors ?? {});
      if (errorKeys.length > 0) {
        lines.push(`errors (${errorKeys.length}):`);
        for (const key of errorKeys.slice(0, OVERVIEW_ERROR_CAP)) {
          const preview = boundedPreview((node?.errors ?? {})[key], opts.previewChars);
          lines.push(`- ⚠ ${key}: ${displayText(renderPreview(preview))}`);
        }
      }

      return lines.join('\n');
    },
  });
}

/**
 * Commit-log anchor for "strictly before this step" lookups. Committed steps
 * anchor at their own first bundle. A step with no commit (defensive — every
 * executed stage normally records at least an empty bundle) anchors at the
 * next committed step in execution order.
 */
function anchorIdxFor(runtimeStageId: string, index: ToolpackIndex): number {
  const own = index.firstIdxOf.get(runtimeStageId);
  if (own !== undefined) return own;
  const position = index.orderedIds.indexOf(runtimeStageId);
  if (position >= 0) {
    for (let i = position + 1; i < index.orderedIds.length; i++) {
      const idx = index.firstIdxOf.get(index.orderedIds[i]);
      if (idx !== undefined) return idx;
    }
  }
  return index.commitLog.length;
}

// ── trace_slice ────────────────────────────────────────────────────────────

function buildTraceSlice(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  opts: ResolvedToolpackOptions,
): Tool {
  return defineTool<
    { runtimeStageId: string; key?: string; maxDepth?: number; maxNodes?: number },
    string
  >({
    name: 'trace_slice',
    description:
      'The causal chain: which earlier steps produced the data at a step (backward ' +
      'read→write slice over the commit log, plus [control: rule] edges to the decisions ' +
      'that routed execution when available). Returns a compact indented tree of step ids — ' +
      'drill any (id) with trace_node, fetch values with get_value. Bounded by maxDepth ' +
      `(default ${opts.sliceMaxDepth}, max ${TOOLPACK_HARD_CAPS.sliceMaxDepth}) and maxNodes ` +
      `(default ${opts.sliceMaxNodes}, max ${TOOLPACK_HARD_CAPS.sliceMaxNodes}); truncation and ` +
      "incomplete-slice ⚠ markers are always shown. Pass 'key' to slice one state key only.",
    inputSchema: {
      type: 'object',
      properties: {
        runtimeStageId: idProperty(index, "The step to slice back from, e.g. 'approve#0'."),
        key: keyProperty(
          index,
          'Optional: restrict the slice to the chain that produced THIS state key.',
        ),
        maxDepth: {
          type: 'integer',
          description: `Optional slice depth (default ${opts.sliceMaxDepth}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxDepth}).`,
        },
        maxNodes: {
          type: 'integer',
          description: `Optional node budget (default ${opts.sliceMaxNodes}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxNodes}).`,
        },
      },
      required: ['runtimeStageId'],
      additionalProperties: false,
    },
    execute: ({ runtimeStageId, key, maxDepth, maxNodes }) => {
      if (!index.firstIdxOf.has(runtimeStageId)) {
        if (index.nodes.has(runtimeStageId)) {
          const reads = Object.keys(index.nodes.get(runtimeStageId)?.stageReads ?? {});
          return (
            `step '${runtimeStageId}' committed nothing — the commit-log slice cannot root there. ` +
            (reads.length > 0
              ? `It read: ${reads
                  .map(displayKey)
                  .join(', ')} — use who_wrote on each, or trace_slice from a downstream step.`
              : 'Use trace_node for its details, or trace_slice from a downstream step.')
          );
        }
        return unknownIdMessage(runtimeStageId, index);
      }

      const depth = clampParam(maxDepth, opts.sliceMaxDepth, 1, TOOLPACK_HARD_CAPS.sliceMaxDepth);
      const nodeBudget = clampParam(
        maxNodes,
        opts.sliceMaxNodes,
        2,
        TOOLPACK_HARD_CAPS.sliceMaxNodes,
      );

      const keysReadOf = (id: string): string[] => {
        const node = index.nodes.get(id);
        return node?.stageReads ? Object.keys(node.stageReads) : [];
      };
      const normalizedKey = key !== undefined ? normalizeKey(key, index.knownPaths) : undefined;
      const keysFn =
        normalizedKey !== undefined
          ? (id: string): string[] => (id === runtimeStageId ? [normalizedKey] : keysReadOf(id))
          : keysReadOf;

      const dag = causalChain(index.commitLog, runtimeStageId, keysFn, {
        maxDepth: depth,
        maxNodes: nodeBudget,
        ...(artifacts.controlDeps ? { controlDeps: artifacts.controlDeps } : {}),
      });
      if (!dag) return unknownIdMessage(runtimeStageId, index);

      const lines: string[] = [
        `CAUSAL SLICE from ${runtimeStageId}` +
          (normalizedKey !== undefined ? ` for key '${displayKey(normalizedKey)}'` : '') +
          ` (maxDepth ${depth}, maxNodes ${nodeBudget})`,
        'each line: Stage (stepId) ← via <the key it provided> [wrote: …]. Drill any (stepId) ' +
          'with trace_node; fetch values with get_value.',
        '',
        displayText(formatCausalChain(dag)),
      ];
      if (!artifacts.controlDeps) {
        lines.push(
          '⚠ control edges unavailable — artifacts carry no controlDeps lookup (attach ' +
            'controlDepRecorder() to the original run); decisions that routed execution are not shown.',
        );
      }
      if (!index.hasReadTracking) {
        lines.push(
          '⚠ artifacts carry no per-step read tracking — read→write edges cannot be followed; ' +
            'the slice may show only the start step.',
        );
      }
      return lines.join('\n');
    },
  });
}

// ── who_wrote ──────────────────────────────────────────────────────────────

function buildWhoWrote(index: ToolpackIndex, opts: ResolvedToolpackOptions): Tool {
  return defineTool<{ key: string; beforeStageId?: string }, string>({
    name: 'who_wrote',
    description:
      'Find the LAST step that wrote a state key — optionally before a given step ' +
      '(beforeStageId), for "who set this value that step X then read?" questions. Returns ' +
      'the writer step id + stage name + write verb + a bounded value preview.',
    inputSchema: {
      type: 'object',
      properties: {
        key: keyProperty(index, "The state key, e.g. 'dti' or 'customer.address.zip'."),
        beforeStageId: idProperty(
          index,
          'Optional: only consider writes strictly BEFORE this step.',
        ),
      },
      required: ['key'],
      additionalProperties: false,
    },
    execute: ({ key, beforeStageId }) => {
      const path = normalizeKey(key, index.knownPaths);
      let beforeIdx: number | undefined;
      if (beforeStageId !== undefined) {
        if (!index.firstIdxOf.has(beforeStageId) && !index.nodes.has(beforeStageId)) {
          return unknownIdMessage(beforeStageId, index);
        }
        beforeIdx = anchorIdxFor(beforeStageId, index);
      }

      const writer = findLastWriter(index.commitLog, path, beforeIdx);
      if (!writer) {
        return (
          `no tracked write to '${displayKey(path)}'` +
          (beforeStageId !== undefined ? ` before ${beforeStageId}` : '') +
          ` in the commit log. ⚠ the value may come from run input (args), env, pre-run state, ` +
          `or a closure — those never enter the commit log.` +
          (index.knownPaths.has(path) ? '' : unknownKeySuffix(index))
        );
      }

      const writerIdx = index.commitLog.indexOf(writer);
      const verb = writer.trace.find((entry) => entry.path === path)?.verb ?? 'set';
      const preview = boundedPreview(
        commitValueAt(index.commitLog, writerIdx, path),
        opts.previewChars,
      );
      const untracked = untrackedSourcesOf([writer]);
      return (
        `'${displayKey(path)}' was last written by ${writer.runtimeStageId} — "${writer.stage}" ` +
        `(verb: ${verb}): ${displayText(
          renderPreview(
            preview,
            `get_value('${writer.runtimeStageId}', '${displayKey(path)}') for full`,
          ),
        )}${redactionNote([writer], path)}` +
        (untracked.length > 0
          ? `\n⚠ that step also consumed ${untracked.join(
              '/',
            )} — its inputs may not be fully traceable.`
          : '')
      );
    },
  });
}

// ── get_value ──────────────────────────────────────────────────────────────

function buildGetValue(index: ToolpackIndex, opts: ResolvedToolpackOptions): Tool {
  return defineTool<{ runtimeStageId: string; key: string; maxChars?: number }, string>({
    name: 'get_value',
    description:
      'Fetch the FULL value of a state key as of a given step (verb-aware reconstruction — ' +
      'works on delta commit logs). Output is capped at maxChars ' +
      `(default ${opts.valueMaxChars}, hard cap ${TOOLPACK_HARD_CAPS.valueMaxChars}) with an ` +
      'explicit truncation notice. Prefer fetching a narrower nested key over raising the cap.',
    inputSchema: {
      type: 'object',
      properties: {
        runtimeStageId: idProperty(index, 'The step whose post-commit view of the key you want.'),
        key: keyProperty(index, "The state key, e.g. 'dti' or 'customer.address.zip'."),
        maxChars: {
          type: 'integer',
          description: `Optional char budget (default ${opts.valueMaxChars}, hard cap ${TOOLPACK_HARD_CAPS.valueMaxChars}).`,
        },
      },
      required: ['runtimeStageId', 'key'],
      additionalProperties: false,
    },
    execute: ({ runtimeStageId, key, maxChars }) => {
      const known = index.firstIdxOf.has(runtimeStageId) || index.nodes.has(runtimeStageId);
      if (!known) return unknownIdMessage(runtimeStageId, index);

      const path = normalizeKey(key, index.knownPaths);
      const cap = clampParam(maxChars, opts.valueMaxChars, 50, TOOLPACK_HARD_CAPS.valueMaxChars);
      const lastIdx = index.lastIdxOf.get(runtimeStageId);
      const atIdx = lastIdx !== undefined ? lastIdx : anchorIdxFor(runtimeStageId, index) - 1;

      if (!index.knownPaths.has(path)) {
        return (
          `no tracked write to '${displayKey(path)}' anywhere in the commit log. ⚠ run input ` +
          `(args), env, pre-run state, and closure-carried values never enter the commit log.` +
          unknownKeySuffix(index)
        );
      }

      const value = atIdx >= 0 ? commitValueAt(index.commitLog, atIdx, path) : undefined;
      if (value === undefined) {
        const firstWriter = findLastWriter(index.commitLog, path);
        return (
          `'${displayKey(path)}' has no value as of ${runtimeStageId} — it was ` +
          (firstWriter !== undefined
            ? `written later (last writer over the whole run: ${firstWriter.runtimeStageId}), or deleted by then.`
            : 'never written.') +
          ` ⚠ pre-run seeded values never enter the commit log.`
        );
      }

      const serialized = displayText(safeStringify(value));
      const redacted = redactionNote(index.bundlesOf.get(runtimeStageId), path);
      const header = `VALUE of '${displayKey(path)}' as of ${runtimeStageId}${redacted}:`;
      if (serialized.length <= cap) return `${header}\n${serialized}`;
      return (
        `${header}\n${serialized.slice(0, cap)}\n` +
        `⚠ truncated: served ${cap} of ${serialized.length} chars — raise maxChars ` +
        `(hard cap ${TOOLPACK_HARD_CAPS.valueMaxChars}) or fetch a narrower nested key.`
      );
    },
  });
}

// ── read_narrative ─────────────────────────────────────────────────────────

function buildReadNarrative(narrative: readonly string[]): Tool {
  return defineTool<{ offset?: number; maxLines?: number }, string>({
    name: 'read_narrative',
    description:
      "Read the run's human-readable narrative, paginated: offset (0-based line index) + " +
      `maxLines (default 40, hard cap ${TOOLPACK_HARD_CAPS.narrativeMaxLines}). Long lines are ` +
      'capped. Use AFTER the structured tools when you need the story around a step.',
    inputSchema: {
      type: 'object',
      properties: {
        offset: { type: 'integer', description: '0-based first line to read (default 0).' },
        maxLines: {
          type: 'integer',
          description: `Lines to read (default 40, hard cap ${TOOLPACK_HARD_CAPS.narrativeMaxLines}).`,
        },
      },
      additionalProperties: false,
    },
    execute: ({ offset, maxLines }) => {
      const total = narrative.length;
      if (total === 0) return 'NARRATIVE: empty (0 lines).';
      const start = clampParam(offset, 0, 0, Math.max(0, total - 1));
      const count = clampParam(maxLines, 40, 1, TOOLPACK_HARD_CAPS.narrativeMaxLines);
      const slice = narrative.slice(start, start + count);
      const lines = [
        `NARRATIVE lines ${start}–${start + slice.length - 1} of ${total}:`,
        ...slice.map((line) => truncateText(displayText(line), NARRATIVE_LINE_CHAR_CAP)),
      ];
      const remaining = total - (start + slice.length);
      if (remaining > 0) {
        lines.push(
          `…${remaining} more line(s) — call read_narrative({ offset: ${start + slice.length} }).`,
        );
      }
      return lines.join('\n');
    },
  });
}

// ── Scripted/offline invocation (the auditor pattern) ─────────────────────

/** Minimal offline ToolExecutionContext — trace tools never use credentials. */
const OFFLINE_CONTEXT: ToolExecutionContext = {
  toolCallId: 'trace-toolpack-offline',
  iteration: 0,
  credentials: unconfiguredCredentialProvider(),
  hasCredentials: false,
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
): Promise<string> {
  const tool = tools.find((candidate) => candidate.schema.name === name);
  if (!tool) {
    const available = tools.map((candidate) => candidate.schema.name).join(', ');
    throw new Error(`callTraceTool: no tool named '${name}'. Available: ${available}`);
  }
  const verdict = validateToolArgs(args, tool.schema.inputSchema);
  if (!verdict.ok) return formatToolArgIssues(name, verdict.issues);
  return String(await tool.execute(args, OFFLINE_CONTEXT));
}
