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
import { arrayProvenance, elementProvenance, formatSlice, sliceForKey } from 'footprintjs/trace';

import { formatToolArgIssues, validateToolArgs } from '../../core/agent/toolArgsValidation.js';
import { defineTool, type Tool, type ToolExecutionContext } from '../../core/tools.js';
import { unconfiguredCredentialProvider } from '../../identity/types.js';
import { unconfiguredArtifacts } from '../../artifacts/capability.js';
import {
  boundedPreview,
  clampParam,
  displayKey,
  displayText,
  normalizeKey,
  renderPreview,
  safeStringify,
} from './bounded.js';
import type { InnerRunRecord } from './innerRunRecords.js';
import { openRecording } from './openRecording.js';
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
/** `find_in_trace` — default hits, query bounds, and per-hit context window. */
const FIND_HITS_DEFAULT = 10;
const FIND_QUERY_MIN_CHARS = 2;
const FIND_QUERY_MAX_CHARS = 200;
const FIND_CONTEXT_RADIUS = 55;
/**
 * How many committed writes one search may open before it stops. A search
 * is a pointer list, not a scan of the whole run — and a search that ran
 * out of budget SAYS so rather than reporting "no match".
 */
const FIND_SCAN_BUDGET = 1500;
/** `inspect_tool_call` — how many real ids an unknown-id correction names. */
const TOOL_CALL_SUGGESTION_CAP = 12;
/** `inspect_tool_run` — how many RETAINED inner runs a correction names. */
const INNER_RUN_SUGGESTION_CAP = 12;
/** Result preview for `inspect_tool_call` (its own dial: results are the answer). */
const TOOL_RESULT_PREVIEW_CHARS = 400;
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

/**
 * The final COMMITTED view of a key — reconstructed from the commit log,
 * never read off `snapshot.sharedState`.
 *
 * That distinction is the whole redaction contract: `sharedState` is the
 * run's LIVE state (unredacted by construction), while the commit log
 * carries what footprintjs scrubbed at commit time. Everything in this
 * file that serves a VALUE goes through here or through `commitValueAt`
 * directly; `sharedState` is read for key NAMES only.
 */
function committedFinal(index: ToolpackIndex, path: string): unknown {
  if (index.commitLog.length === 0) return undefined;
  return commitValueAt(index.commitLog, index.commitLog.length - 1, path);
}

/** A bounded window of `text` around the first case-insensitive match. */
function matchWindow(text: string, needleLower: string, radius: number): string | undefined {
  const at = text.toLowerCase().indexOf(needleLower);
  if (at < 0) return undefined;
  const start = Math.max(0, at - radius);
  const end = Math.min(text.length, at + needleLower.length + radius);
  return (
    (start > 0 ? '…' : '') +
    text.slice(start, end).replace(/\s+/g, ' ') +
    (end < text.length ? '…' : '')
  );
}

// ── The factory ────────────────────────────────────────────────────────────

/**
 * Build the introspection toolpack over a COMPLETED run's artifacts.
 *
 * Returns plain `Tool[]`:
 *
 * | Tool                | Question it answers                                    |
 * |---------------------|--------------------------------------------------------|
 * | `run_overview`      | What happened, broadly? (the entry point)              |
 * | `find_in_trace`     | WHERE in this run does "…" appear? (free text → ids)   |
 * | `trace_node`        | What did step X read/write, and where did its inputs come from? |
 * | `trace_slice`       | Which chain of steps produced the data at X? (causal slice) |
 * | `backtrack`         | Why is VARIABLE K what it is? (+ `element`: who made K[i]?) — variable-first |
 * | `who_wrote`         | Which step last wrote key K?                           |
 * | `get_value`         | The full value of K as of step X (capped, truncation-marked) |
 * | `inspect_tool_call` | One tool call end to end: proposed args → ran-with args → result → outcome |
 * | `inspect_tool_run`  | INSIDE one tool call — the chart it ran, when that tool kept its record |
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
    buildFindInTrace(artifacts, index),
    buildTraceNode(artifacts, index, opts),
    buildTraceSlice(artifacts, index, opts),
    buildBacktrack(artifacts, index, opts),
    buildWhoWrote(index, opts),
    buildGetValue(index, opts),
    buildInspectToolCall(artifacts, calls),
    buildInspectToolRun(artifacts, calls, options),
  ];
  if (artifacts.narrative !== undefined) {
    tools.push(buildReadNarrative(artifacts.narrative));
  }
  return tools;
}

/**
 * The tool names this pack can mount. The Agent builder reserves these at
 * `.selfExplain()` build time — the tools slot dedupes by name with
 * first-occurrence-wins, so a consumer tool sharing a name would silently
 * shadow the trace tool AND the skill body would instruct the model into
 * the wrong one. Exported so the reservation list is DERIVED from the pack
 * rather than typed out beside it (a second list is a list that drifts).
 */
export const TRACE_TOOL_NAMES = [
  'run_overview',
  'find_in_trace',
  'trace_node',
  'trace_slice',
  'backtrack',
  'who_wrote',
  'get_value',
  'inspect_tool_call',
  'inspect_tool_run',
  'read_narrative',
] as const;

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

      // COST — only when the run actually priced itself. `cumEstimatedUsd`
      // is seeded to 0 on every agent run and only ever moves under a
      // configured `pricingTable`, so a zero here means "this run was not
      // priced", and printing "$0.00" for it would be a number that lies.
      const spend = committedFinal(index, 'cumEstimatedUsd');
      if (typeof spend === 'number' && spend > 0) {
        const tokensIn = committedFinal(index, 'cumTokensInput');
        const tokensOut = committedFinal(index, 'cumTokensOutput');
        const writer = findLastWriter(index.commitLog, 'cumEstimatedUsd');
        lines.push(
          '',
          `COST: ~$${spend.toFixed(6)} (in ${typeof tokensIn === 'number' ? tokensIn : '?'} / out ${
            typeof tokensOut === 'number' ? tokensOut : '?'
          } tokens) — estimated by the ` +
            `run's pricing table, not a bill` +
            (writer ? ` — via get_value('${writer.runtimeStageId}', 'cumEstimatedUsd').` : '.'),
        );
      }

      if (artifacts.narrative !== undefined) {
        lines.push(
          `NARRATIVE: ${artifacts.narrative.length} line(s) available via read_narrative.`,
        );
      }
      lines.push(
        `SEARCH: find_in_trace('<text>') locates any phrase in this record and hands back ids.`,
      );

      return lines.join('\n');
    },
  });
}

// ── find_in_trace ──────────────────────────────────────────────────────────

/**
 * The missing FIRST move.
 *
 * Every other tool needs a name you already have: a step id, a state key,
 * a variable. But a follow-up question arrives in the user's words — "why
 * did you say order 7712 was out of warranty?" — and the model's only
 * options were to guess a key or read the whole narrative. This is the
 * bridge from free text to ids: search the record, hand back POINTERS.
 *
 * Three properties make it a search rather than a dump:
 *
 *   - it serves a bounded WINDOW around each match, never the value;
 *   - every hit line ends with the exact next call to make, so a search
 *     result is a menu of drills rather than an answer to be believed;
 *   - it searches the REDACTED commit log, because that is the only copy
 *     that exists — a redacted value reads as its placeholder here for
 *     the same reason it does everywhere else.
 *
 * The zero-hit answer is the honest one: it names what never enters the
 * record at all, so "not found" cannot be read as "did not happen".
 */
function buildFindInTrace(artifacts: TraceToolpackArtifacts, index: ToolpackIndex): Tool {
  return defineTool<{ query: string; maxHits?: number }, string>({
    name: 'find_in_trace',
    description:
      'Search this run\'s record for free text — "7712", "out of stock", a phrase from the ' +
      'answer — and get back the step ids and keys where it appears. Searches stage names and ' +
      'descriptions, state keys, every committed value, and the narrative. Case-insensitive ' +
      `substring; returns up to maxHits pointers (default ${FIND_HITS_DEFAULT}, hard cap ` +
      `${TOOLPACK_HARD_CAPS.findMaxHits}), each with the exact follow-up call to make. Use it ` +
      'FIRST when the question names something the run mentioned but you have no id for.',
    inputSchema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description:
            'The text to look for (case-insensitive substring), e.g. an order id, a phrase ' +
            'from the answer, or a tool name.',
        },
        maxHits: {
          type: 'integer',
          description: `Pointers to return (default ${FIND_HITS_DEFAULT}, hard cap ${TOOLPACK_HARD_CAPS.findMaxHits}).`,
        },
      },
      required: ['query'],
      additionalProperties: false,
    },
    execute: ({ query, maxHits }) => {
      const trimmed = query.trim();
      if (trimmed.length < FIND_QUERY_MIN_CHARS) {
        return (
          `find_in_trace: '${trimmed}' is too short to search (minimum ${FIND_QUERY_MIN_CHARS} ` +
          `characters) — a one-character query matches nearly every step, which is the same as ` +
          `no answer. Search for an id, a value, a key, or a phrase from the answer.`
        );
      }
      const needle = trimmed.slice(0, FIND_QUERY_MAX_CHARS).toLowerCase();
      const cap = clampParam(maxHits, FIND_HITS_DEFAULT, 1, TOOLPACK_HARD_CAPS.findMaxHits);

      const hits: string[] = [];
      let scans = 0;
      let budgetHit = false;
      /** Record a hit; true once the cap is reached and scanning should stop. */
      const add = (line: string): boolean => {
        hits.push(line);
        return hits.length >= cap;
      };

      // 1. STAGES — what the run's steps are called and what they claim to do.
      let full = false;
      for (const group of index.groups) {
        const haystack = `${group.stagePart} ${group.name ?? ''} ${group.description ?? ''}`;
        const window = matchWindow(haystack, needle, FIND_CONTEXT_RADIUS);
        if (window === undefined) continue;
        if (add(`- stage: ${window} → trace_node('${group.ids[0]}')`)) {
          full = true;
          break;
        }
      }

      // 2. STATE KEYS — the names, not the values (those are step 3).
      if (!full) {
        for (const path of index.knownPaths) {
          const dotted = displayKey(path);
          if (!dotted.toLowerCase().includes(needle)) continue;
          if (add(`- state key '${dotted}' → who_wrote('${dotted}')`)) {
            full = true;
            break;
          }
        }
      }

      // 3. COMMITTED VALUES — what each step actually wrote. Serialized ONE
      //    (step, key) payload at a time and discarded: a search must never
      //    build a serialization of the whole log to look through.
      if (!full) {
        outer: for (const bundle of index.commitLog) {
          const overwrite = bundle.overwrite as Record<string, unknown> | undefined;
          const updates = bundle.updates as Record<string, unknown> | undefined;
          for (const entry of bundle.trace) {
            if (scans >= FIND_SCAN_BUDGET) {
              budgetHit = true;
              break outer;
            }
            scans++;
            const payload = overwrite?.[entry.path] ?? updates?.[entry.path];
            if (payload === undefined) continue;
            const window = matchWindow(safeStringify(payload), needle, FIND_CONTEXT_RADIUS);
            if (window === undefined) continue;
            const dotted = displayKey(entry.path);
            if (
              add(
                `- ${bundle.runtimeStageId} wrote '${dotted}' (${entry.verb}): ${displayText(
                  window,
                )}${redactionNote([bundle], entry.path)} → get_value('${
                  bundle.runtimeStageId
                }', '${dotted}')`,
              )
            ) {
              full = true;
              break outer;
            }
          }
        }
      }

      // 4. NARRATIVE — the story, when the artifacts carry one.
      const narrative = artifacts.narrative;
      if (!full && narrative !== undefined) {
        for (let i = 0; i < narrative.length; i++) {
          const window = matchWindow(narrative[i], needle, FIND_CONTEXT_RADIUS);
          if (window === undefined) continue;
          if (
            add(`- narrative line ${i}: ${displayText(window)} → read_narrative({ offset: ${i} })`)
          ) {
            full = true;
            break;
          }
        }
      }

      const scope =
        `${index.groups.length} stage(s), ${index.knownPaths.size} state key(s), ` +
        `${index.commitLog.length} committed step(s)` +
        (narrative !== undefined ? `, ${narrative.length} narrative line(s)` : '');

      if (hits.length === 0) {
        return (
          `find_in_trace: no match for '${trimmed}' — searched ${scope}.\n` +
          (budgetHit
            ? `⚠ the value scan stopped after ${FIND_SCAN_BUDGET} writes, so this is "not found ` +
              `so far", not "not present" — narrow the query or drill with run_overview.\n`
            : '') +
          `⚠ some things NEVER enter the record and cannot be found here: run input (args), env, ` +
          `state seeded before the run, values carried in closures, and anything redaction removed ` +
          `(those read as their placeholder). Tool internals are not traced either — only the ` +
          `arguments in and the result out.\n` +
          `Try a shorter phrase, a key from run_overview, or read_narrative for the story.`
        );
      }

      const lines = [
        `FOUND ${hits.length}${hits.length >= cap ? '+' : ''} match(es) for '${trimmed}' ` +
          `in ${scope} — each line ends with the call that opens it:`,
        ...hits,
      ];
      if (hits.length >= cap) {
        lines.push(
          `⚠ stopped at maxHits ${cap} — more matches may exist. Narrow the query, or raise ` +
            `maxHits (hard cap ${TOOLPACK_HARD_CAPS.findMaxHits}).`,
        );
      }
      if (budgetHit) {
        lines.push(
          `⚠ the value scan stopped after ${FIND_SCAN_BUDGET} writes — later steps were not ` +
            `searched. Narrow the query or drill from run_overview.`,
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

// ── backtrack — variable-first triage (the follow-up question shape) ──────

/**
 * `trace_slice` is STEP-addressed ("what fed step X?"). Follow-up questions
 * arrive VARIABLE-addressed ("why did you say the quote is 11.88?" → "why is
 * `quote` what it is?") — and for agent history, ELEMENT-addressed ("where
 * did message 7 come from?"). This tool is that address translation, built
 * on footprintjs' slice layer (`sliceForKey` / `elementProvenance`): anchor
 * at the variable's last writer, walk backwards; or name one array element's
 * birth step. Same honesty contracts as the rest of the pack — a missing
 * slice states WHY (initial state / frozen args / a closure), element
 * attribution carries its basis (append-verb exact vs prefix-inference),
 * and reads-coverage warns when read tracking was off.
 */
function buildBacktrack(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
  opts: ResolvedToolpackOptions,
): Tool {
  return defineTool<
    { variable: string; element?: number; before?: number; maxDepth?: number; maxNodes?: number },
    string
  >({
    name: 'backtrack',
    description:
      "Why is a state VARIABLE what it is? Anchors at the variable's last writer and walks the " +
      'backward dependency chain (variable-first — you do not need a step id). For array ' +
      "variables (e.g. 'history'), pass 'element' to ask which step produced element N instead. " +
      "Optional 'before' (commit index) time-travels: the value as it stood before that point. " +
      `Bounded by maxDepth (default ${opts.sliceMaxDepth}, max ${TOOLPACK_HARD_CAPS.sliceMaxDepth}) ` +
      `and maxNodes (default ${opts.sliceMaxNodes}, max ${TOOLPACK_HARD_CAPS.sliceMaxNodes}).`,
    inputSchema: {
      type: 'object',
      properties: {
        variable: keyProperty(index, "The state key to explain, e.g. 'quote' or 'history'."),
        element: {
          type: 'integer',
          description:
            'Optional array index: ask which step PRODUCED this element (birth attribution) ' +
            'instead of slicing the whole variable.',
        },
        before: {
          type: 'integer',
          description:
            'Optional exclusive commit index — explain the value as it stood BEFORE this point ' +
            "(chain from an element birth with: element_birth's commitIdx + 1).",
        },
        maxDepth: {
          type: 'integer',
          description: `Optional slice depth (default ${opts.sliceMaxDepth}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxDepth}).`,
        },
        maxNodes: {
          type: 'integer',
          description: `Optional node budget (default ${opts.sliceMaxNodes}, hard cap ${TOOLPACK_HARD_CAPS.sliceMaxNodes}).`,
        },
      },
      required: ['variable'],
      additionalProperties: false,
    },
    execute: ({ variable, element, before, maxDepth, maxNodes }) => {
      const key = normalizeKey(variable, index.knownPaths);

      // ── element mode: birth attribution ─────────────────────────────────
      if (element !== undefined) {
        const birth = elementProvenance(index.commitLog, key, element, {
          ...(before !== undefined && { atIdx: before - 1 }),
        });
        if (!birth) {
          const prov = arrayProvenance(index.commitLog, key, {
            ...(before !== undefined && { atIdx: before - 1 }),
          });
          if (prov.missing === 'never-written') {
            return (
              `'${displayKey(key)}' was never written in range — it may come from run input ` +
              '(args), env, pre-run state, or a closure; the commit log cannot see those.'
            );
          }
          if (prov.missing === 'not-an-array') {
            return (
              `'${displayKey(
                key,
              )}' is not an array at that point (scalar, deleted, or degraded) — ` +
              `element attribution does not apply. Call backtrack without 'element' to slice it.`
            );
          }
          if (prov.missing === 'empty-log') return 'the commit log is empty — nothing executed.';
          return (
            `element ${element} is out of range for '${displayKey(key)}' ` +
            `(length ${prov.length}). Valid indices: 0..${(prov.length ?? 1) - 1}.`
          );
        }
        return (
          `'${displayKey(key)}'[${birth.index}] = ${renderPreview(
            boundedPreview(birth.value, opts.previewChars),
          )} — ` +
          `born at ${birth.runtimeStageId} ("${birth.stageName}", verb: ${birth.verb}, ` +
          `attribution: ${birth.basis}${
            birth.basis === 'append-verb' ? ' — engine-recorded, exact' : ''
          }). ` +
          `Drill the producer with trace_node('${birth.runtimeStageId}'), or ask why it wrote this ` +
          `with backtrack({variable: '${displayKey(key)}', before: ${birth.commitIdx + 1}}).`
        );
      }

      // ── slice mode: variable-first backward slice ────────────────────────
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
      const slice = sliceForKey(index.commitLog, key, keysReadOf, {
        maxDepth: depth,
        maxNodes: nodeBudget,
        ...(before !== undefined && { before }),
        ...(artifacts.controlDeps ? { controlDeps: artifacts.controlDeps } : {}),
      });

      const lines: string[] = [
        displayText(formatSlice(slice)),
        '',
        'drill any (stepId) with trace_node; fetch values with get_value; array variables take ' +
          "'element' for per-element attribution.",
      ];
      if (slice.root !== undefined && !artifacts.controlDeps) {
        lines.push(
          '⚠ control edges unavailable — artifacts carry no controlDeps lookup; decisions that ' +
            'routed execution are not shown.',
        );
      }
      if (slice.root !== undefined && !index.hasReadTracking) {
        lines.push(
          '⚠ artifacts carry no per-step read tracking — the slice may show only the writer step.',
        );
      }
      return lines.join('\n');
    },
  });
}

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

// ── inspect_tool_call ──────────────────────────────────────────────────────

/** One conversation turn as it lands in the committed `history` array. */
interface HistoryTurn {
  readonly role?: string;
  readonly content?: unknown;
  readonly toolCallId?: string;
  readonly toolName?: string;
  readonly toolCalls?: readonly {
    readonly id?: string;
    readonly name?: string;
    readonly args?: Record<string, unknown>;
  }[];
}

/** One committed middleware-ledger row (the 8.13.0 ran-with-args evidence). */
interface LedgerRow {
  readonly middleware?: string;
  readonly moment?: string;
  readonly at?: string;
  readonly toolCallId?: string;
  readonly outcome?: string;
  readonly changed?: boolean;
  readonly why?: string;
  readonly before?: unknown;
  readonly after?: unknown;
}

/** What one tool call looks like once the four sources are joined. */
interface ToolCallFacts {
  readonly toolName?: string;
  readonly proposedArgs?: Record<string, unknown>;
  readonly result?: unknown;
  readonly runtimeStageId?: string;
}

/** The joined view of a run's tool calls, shared by the two tools that read it. */
interface ToolCallReader {
  /** Every tool call id this run recorded, in call order, with its name. */
  knownCalls(): { id: string; name: string }[];
  /** The four-source join for one call. */
  factsFor(toolCallId: string): ToolCallFacts;
  /** Committed conversation history, lazily materialised. */
  history(): readonly HistoryTurn[];
  /** The middleware ledger rows for one call (the ran-with-args evidence). */
  rowsFor(toolCallId: string): LedgerRow[];
  /** Typed events of one kind, with their payload + meta lifted. */
  eventsOf(type: string): { payload: Record<string, unknown>; meta: Record<string, unknown> }[];
}

/**
 * Resolve ONE tool call across the four places its evidence lives.
 *
 * A tool call is the most-asked-about thing in an agent run and the most
 * scattered: the model's PROPOSED args are on an assistant turn, the args
 * it actually RAN with are in the middleware ledger (and only when a rule
 * changed them), the result is a `role:'tool'` turn, and the timing exists
 * only in the event stream. Four lookups, one id — so this reader does the
 * join rather than making the model do it in four calls.
 *
 * The proposed/ran-with split is the point. A governance rule that
 * rewrites args is invisible in the conversation: the model reads its own
 * proposal in history and the tool ran on something else. That difference
 * is exactly what "why did it do that?" is often asking about.
 */
function buildToolCallReader(
  artifacts: TraceToolpackArtifacts,
  index: ToolpackIndex,
): ToolCallReader {
  // All four readers are lazy + memoized: a toolpack that never inspects a
  // tool call pays nothing, and one that inspects five pays once.
  let historyMemo: readonly HistoryTurn[] | undefined;
  const history = (): readonly HistoryTurn[] => {
    if (historyMemo === undefined) {
      const value = committedFinal(index, 'history');
      historyMemo = Array.isArray(value) ? (value as readonly HistoryTurn[]) : [];
    }
    return historyMemo;
  };

  let ledgerMemo: readonly LedgerRow[] | undefined;
  const ledger = (): readonly LedgerRow[] => {
    if (ledgerMemo === undefined) {
      const value = committedFinal(index, 'middlewareDecisions');
      ledgerMemo = Array.isArray(value) ? (value as readonly LedgerRow[]) : [];
    }
    return ledgerMemo;
  };

  const eventsOf = (
    type: string,
  ): { payload: Record<string, unknown>; meta: Record<string, unknown> }[] =>
    (artifacts.events ?? [])
      .filter((event) => event.type === type)
      .map((event) => ({
        payload: (event.payload ?? {}) as unknown as Record<string, unknown>,
        meta: (event.meta ?? {}) as unknown as Record<string, unknown>,
      }));

  /** Every tool call id this run recorded, in call order, with its name. */
  let idsMemo: { id: string; name: string }[] | undefined;
  const knownCalls = (): { id: string; name: string }[] => {
    if (idsMemo !== undefined) return idsMemo;
    const byId = new Map<string, string>();
    for (const start of eventsOf('agentfootprint.stream.tool_start')) {
      const id = start.payload.toolCallId;
      if (typeof id === 'string') byId.set(id, String(start.payload.toolName ?? '?'));
    }
    for (const turn of history()) {
      for (const call of turn.toolCalls ?? []) {
        if (typeof call.id === 'string' && !byId.has(call.id)) {
          byId.set(call.id, call.name ?? '?');
        }
      }
      if (typeof turn.toolCallId === 'string' && !byId.has(turn.toolCallId)) {
        byId.set(turn.toolCallId, turn.toolName ?? '?');
      }
    }
    idsMemo = [...byId].map(([id, name]) => ({ id, name }));
    return idsMemo;
  };

  /**
   * Which STEP ran this call. The event tail knows exactly (every event is
   * stamped with its `runtimeStageId`); without it, fall back to the first
   * committed step whose `history` carries the call's result — that is the
   * tool-execution step by construction.
   */
  const stepFor = (toolCallId: string): { id?: string; inferred: boolean } => {
    for (const start of eventsOf('agentfootprint.stream.tool_start')) {
      if (start.payload.toolCallId === toolCallId) {
        const id = start.meta.runtimeStageId;
        if (typeof id === 'string') return { id, inferred: false };
      }
    }
    for (let i = 0; i < index.commitLog.length; i++) {
      const bundle = index.commitLog[i];
      if (!bundle.trace.some((entry) => entry.path === 'history')) continue;
      const value = commitValueAt(index.commitLog, i, 'history');
      if (!Array.isArray(value)) continue;
      const landed = (value as readonly HistoryTurn[]).some(
        (turn) => turn.role === 'tool' && turn.toolCallId === toolCallId,
      );
      if (landed) return { id: bundle.runtimeStageId, inferred: true };
    }
    return { inferred: true };
  };

  const factsFor = (toolCallId: string): ToolCallFacts => {
    let toolName: string | undefined;
    let proposedArgs: Record<string, unknown> | undefined;
    let result: unknown;
    for (const turn of history()) {
      for (const call of turn.toolCalls ?? []) {
        if (call.id === toolCallId) {
          toolName = call.name ?? toolName;
          proposedArgs = call.args;
        }
      }
      if (turn.role === 'tool' && turn.toolCallId === toolCallId) {
        toolName = turn.toolName ?? toolName;
        result = turn.content;
      }
    }
    if (toolName === undefined) {
      toolName = knownCalls().find((call) => call.id === toolCallId)?.name;
    }
    const step = stepFor(toolCallId);
    return {
      ...(toolName !== undefined && { toolName }),
      ...(proposedArgs !== undefined && { proposedArgs }),
      ...(result !== undefined && { result }),
      ...(step.id !== undefined && { runtimeStageId: step.id }),
    };
  };

  return {
    knownCalls,
    factsFor,
    history,
    rowsFor: (toolCallId) => ledger().filter((row) => row.toolCallId === toolCallId),
    eventsOf,
  };
}

/**
 * The tool over {@link buildToolCallReader}'s join.
 *
 * The `toolCallId` param deliberately carries NO schema enum (unlike step
 * ids): building one would mean reconstructing the whole committed history
 * at factory time for every toolpack, including the runs that never open
 * this tool. The corrective message does the same job, on demand.
 */
function buildInspectToolCall(artifacts: TraceToolpackArtifacts, reader: ToolCallReader): Tool {
  const { knownCalls, factsFor, history, rowsFor, eventsOf } = reader;
  return defineTool<{ toolCallId: string }, string>({
    name: 'inspect_tool_call',
    description:
      'Resolve ONE tool call end to end: which tool, the arguments the model proposed, the ' +
      'arguments it actually ran with (they differ when a governance rule rewrote them), the ' +
      'bounded result, the outcome (ok / error / denied / paused), how long it took, and the ' +
      'step id that ran it. Use it whenever the question is about something a tool did — it ' +
      'joins four records that otherwise take four calls to read.',
    inputSchema: {
      type: 'object',
      properties: {
        toolCallId: {
          type: 'string',
          description:
            "The tool call's id, e.g. 'call_01'. Ids appear in trace_node on the tool step, " +
            'in the narrative, and in find_in_trace hits.',
        },
      },
      required: ['toolCallId'],
      additionalProperties: false,
    },
    execute: ({ toolCallId }) => {
      const calls = knownCalls();
      if (!calls.some((call) => call.id === toolCallId)) {
        if (calls.length === 0) {
          return (
            `unknown toolCallId '${toolCallId}' — this run recorded NO tool calls at all. ` +
            (artifacts.events === undefined && history().length === 0
              ? '⚠ it also carries no committed conversation history and no event tail, so a ' +
                'tool call could not be seen even if one happened. '
              : '') +
            'Call run_overview to see what the run did do.'
          );
        }
        const sample = calls
          .slice(0, TOOL_CALL_SUGGESTION_CAP)
          .map((call) => `${call.id} (${call.name})`)
          .join(', ');
        return (
          `unknown toolCallId '${toolCallId}'. This run recorded ${calls.length} tool call(s): ` +
          `${sample}${calls.length > TOOL_CALL_SUGGESTION_CAP ? ', …' : ''}. Retry with one of ` +
          `those ids.`
        );
      }

      const facts = factsFor(toolCallId);
      const lines: string[] = [`TOOL CALL ${toolCallId} — ${facts.toolName ?? '(unnamed tool)'}`];

      lines.push(
        facts.runtimeStageId !== undefined
          ? `step: ${facts.runtimeStageId} — drill with trace_node('${facts.runtimeStageId}')`
          : `step: ⚠ not resolvable — no event tail, and no committed step carries this call's ` +
              `result (the turn may have ended before it landed).`,
      );

      lines.push(
        facts.proposedArgs !== undefined
          ? `proposed by the model: ${displayText(
              renderPreview(boundedPreview(facts.proposedArgs, TOOL_RESULT_PREVIEW_CHARS)),
            )}`
          : `proposed by the model: ⚠ not recorded — the assistant turn carrying this call is ` +
              `not in the committed history (a window strategy may have folded it away).`,
      );

      // Ran-with args: the ledger is the ONLY record of a rule rewriting
      // them. No ledger row means no rule changed anything — say that
      // plainly rather than leaving the reader to assume it.
      const rows = rowsFor(toolCallId);
      const rewrite = [...rows]
        .reverse()
        .find((row) => row.changed === true && row.moment === 'before-tool');
      if (rewrite) {
        lines.push(
          `ran with: ${displayText(
            renderPreview(boundedPreview(rewrite.after, TOOL_RESULT_PREVIEW_CHARS)),
          )} — CHANGED at before-tool by '${rewrite.middleware ?? '?'}'` +
            (rewrite.why ? `: "${rewrite.why}"` : '') +
            '. The model proposed the line above; the tool ran on this one.',
        );
      } else if (rows.length > 0) {
        lines.push('ran with: the proposed arguments, unchanged (rules looked and allowed them).');
      } else {
        lines.push(
          'ran with: the proposed arguments — no governance rule filed a row for this call.',
        );
      }

      lines.push(
        facts.result !== undefined
          ? `result: ${displayText(
              renderPreview(
                boundedPreview(facts.result, TOOL_RESULT_PREVIEW_CHARS),
                `get_value('${facts.runtimeStageId ?? '<step>'}', 'history') for the full turn`,
              ),
            )}`
          : `result: ⚠ no result recorded for this call in the committed history — it may have ` +
              `been denied before it ran, or the turn ended (paused/failed) before it landed.`,
      );

      // Outcome + duration: the event tail is the only clock a run has.
      const denial = rows.find((row) => row.outcome === 'deny');
      const end = eventsOf('agentfootprint.stream.tool_end').find(
        (event) => event.payload.toolCallId === toolCallId,
      );
      const checkIn = eventsOf('agentfootprint.checkin.request').some(
        (event) => event.payload.toolCallId === toolCallId,
      );
      const invalid = eventsOf('agentfootprint.validation.args_invalid').some(
        (event) => event.payload.toolCallId === toolCallId,
      );
      let outcome: string;
      if (denial) {
        outcome = `denied by '${denial.middleware ?? '?'}'${denial.why ? `: "${denial.why}"` : ''}`;
      } else if (end?.payload.error === true) {
        outcome = 'error — the tool threw or returned a failure';
      } else if (checkIn && end === undefined) {
        outcome = 'paused — a check-in asked a human and this call has no recorded end';
      } else if (facts.result !== undefined) {
        outcome = 'ok';
      } else {
        outcome = '⚠ unknown — no ledger row, no result, no end event';
      }
      lines.push(`outcome: ${outcome}`);
      if (invalid) {
        lines.push(
          `⚠ the arguments failed schema validation on this call — see the validation event / ` +
            `the tool result, which carries the correction the model was given.`,
        );
      }

      if (artifacts.events === undefined) {
        lines.push(
          `duration: ⚠ unavailable — these artifacts carry no event tail. The commit log records ` +
            `what each step WROTE and has no clock; timings live only in the event stream.`,
        );
      } else if (end !== undefined && typeof end.payload.durationMs === 'number') {
        lines.push(`duration: ${end.payload.durationMs}ms`);
      } else {
        lines.push(
          `duration: ⚠ no tool_end event for this call in the retained tail (it may have been ` +
            `dropped by the tail cap, or the call never finished).`,
        );
      }

      // THE DESCENT RUNG. The boundary marker below is honest for a tool
      // that called someone else's system, and needlessly honest for one
      // that kept its own record — so when a record exists the line that
      // says "not traced" is replaced by the call that opens it. One line,
      // and it teaches the id it takes: the SAME toolCallId, one level down.
      const inner = artifacts.innerRuns?.get(toolCallId);
      lines.push(
        inner !== undefined
          ? `inside: this tool kept its own record of the run — ${inner.steps} step(s), ` +
              `${inner.outcome}. Descend with inspect_tool_run({ toolCallId: '${toolCallId}' }).`
          : '⚠ boundary: what happened INSIDE the tool is not traced — this is the envelope ' +
              '(arguments in, result out) plus what the run itself decided about it.',
      );
      return lines.join('\n');
    },
  });
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
  // One inner pack at a time, memoized by call id: three drills into one
  // inner run build one index, and the memo pins at most ONE inner run's
  // index beyond the record the store is already holding.
  let memoId: string | undefined;
  let memoTools: Tool[] | undefined;

  const innerToolsFor = (record: InnerRunRecord): Tool[] | string => {
    if (memoTools !== undefined && memoId === record.toolCallId) return memoTools;
    if (record.recording === undefined) {
      return (
        `tool call '${record.toolCallId}' ran '${record.toolName}', which keeps records — but ` +
        `THIS one could not be captured: ${record.problem ?? 'reason not recorded'}. The call ` +
        `itself was unaffected; inspect_tool_call('${record.toolCallId}') still has the ` +
        `envelope (arguments in, result out).`
      );
    }
    let inner: TraceToolpackArtifacts;
    try {
      inner = {
        // `openRecording` is the adapter, not a copy of it: same lift, same
        // two teaching refusals if the bag is malformed. The two fields it
        // cannot lift from JSON — control edges, and a narrative nobody
        // attached — are added here because this record is LIVE in process.
        ...openRecording(record.recording),
        ...(record.controlDeps !== undefined && { controlDeps: record.controlDeps }),
        ...(record.narrative !== undefined && { narrative: record.narrative }),
      };
    } catch (e) {
      return (
        `the retained record for '${record.toolCallId}' could not be opened: ` +
        `${e instanceof Error ? e.message : String(e)}`
      );
    }
    memoId = record.toolCallId;
    memoTools = traceToolpack(inner, options);
    return memoTools;
  };

  return defineTool<
    {
      toolCallId: string;
      runtimeStageId?: string;
      key?: string;
      variable?: string;
      find?: string;
    },
    string
  >({
    name: 'inspect_tool_run',
    description:
      'Go INSIDE one tool call. Some tools are themselves recorded flowcharts and keep the ' +
      'record of what they ran; this opens it. Called with just a toolCallId it returns a ' +
      'bounded overview of the inner run (its stages, its errors, its state keys). Add ' +
      "'find' to search that inner run in free text, 'variable' to ask why an inner value is " +
      "what it is, 'runtimeStageId' to open one inner step, or both 'runtimeStageId' and " +
      "'key' for an inner value in full. The ids it returns are the INNER chart's — the " +
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
            "Optional, with runtimeStageId: the inner state key to fetch in full, e.g. 'forecast'.",
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
      },
      required: ['toolCallId'],
      additionalProperties: false,
    },
    execute: async ({ toolCallId, runtimeStageId, key, variable, find }) => {
      const lookup = artifacts.innerRuns;
      if (lookup === undefined) return noInnerRecordsMessage(toolCallId);

      const record = lookup.get(toolCallId);
      if (record === undefined) return unknownInnerRunMessage(toolCallId, lookup, reader);

      const inner = innerToolsFor(record);
      if (typeof inner === 'string') return inner;

      // Param-shaped dispatch (the `backtrack({ element })` precedent): the
      // narrowest question the caller asked wins, and the default — no
      // extra params at all — is the entry point, exactly as run_overview
      // is the entry point one level up.
      let body: string;
      if (find !== undefined) {
        body = await callTraceTool(inner, 'find_in_trace', { query: find });
      } else if (variable !== undefined) {
        body = await callTraceTool(inner, 'backtrack', { variable });
      } else if (runtimeStageId !== undefined && key !== undefined) {
        body = await callTraceTool(inner, 'get_value', { runtimeStageId, key });
      } else if (runtimeStageId !== undefined) {
        body = await callTraceTool(inner, 'trace_node', { runtimeStageId });
      } else if (key !== undefined) {
        body =
          `'key' names a value AS OF a step, so it needs a step: pass runtimeStageId too, or ` +
          `use 'variable' to ask why '${displayKey(key)}' is what it is across the whole inner ` +
          `run.`;
      } else {
        body = await callTraceTool(inner, 'run_overview', {});
      }

      return [
        `INSIDE TOOL CALL ${toolCallId} — '${record.toolName}' ran a recorded flowchart ` +
          `(${record.steps} committed step(s), ${record.outcome}).`,
        body,
        `next inside this call: inspect_tool_run({ toolCallId: '${toolCallId}', ` +
          `runtimeStageId: '<inner id>' }) opens a step · add 'key' for a value in full · ` +
          `'variable' asks why an inner value is what it is · 'find' searches this inner run.`,
        `⚠ the ids above are INNER ids — they name steps of ${record.toolName}'s own chart, not ` +
          `of the run that called it. trace_node / get_value / trace_slice do not accept them; ` +
          `come back through inspect_tool_run.`,
      ].join('\n');
    },
  });
}

/** No tool in this run keeps a record — name the switch, not the emptiness. */
function noInnerRecordsMessage(toolCallId: string): string {
  return (
    `inspect_tool_run: nothing in this run kept a record below the tool boundary, so there is ` +
    `no inner run for '${toolCallId}' — or for any other call. A tool keeps one only when it ` +
    `was built to: flowchartAsTool({ name, flowchart, keepRecord: true }). That switch is OFF ` +
    `by default because retaining a run's snapshot per invocation is memory the caller has to ` +
    `agree to. Without it the trace holds the envelope — arguments in, result out — which is ` +
    `what inspect_tool_call('${toolCallId}') serves.`
  );
}

/** A record was expected and is not here: evicted, or never kept for THIS tool. */
function unknownInnerRunMessage(
  toolCallId: string,
  lookup: NonNullable<TraceToolpackArtifacts['innerRuns']>,
  reader: ToolCallReader,
): string {
  const kept = lookup.list();
  const lines: string[] = [
    `inspect_tool_run: no retained inner run for tool call '${toolCallId}'.`,
  ];

  // Did the OUTER run make this call at all? Three different situations
  // wear the same "not found", and only one of them is the consumer's to fix.
  const outer = reader.knownCalls().find((call) => call.id === toolCallId);
  if (outer === undefined) {
    lines.push(
      `⚠ the outer run does not record a call with that id either — check ` +
        `inspect_tool_call('${toolCallId}') first; it names every id this run made.`,
    );
  } else {
    lines.push(
      `That call ran '${outer.name}', which either does not keep records (only ` +
        `flowchartAsTool({ keepRecord: true }) does) or had this one dropped.`,
    );
  }

  if (kept.length === 0) {
    lines.push(
      `No inner runs are held right now. A tool that keeps records has simply not been called ` +
        `yet in the turn this trace covers.`,
    );
  } else {
    const sample = kept
      .slice(0, INNER_RUN_SUGGESTION_CAP)
      .map((row) => `${row.toolCallId} (${row.toolName}, ${row.steps} step(s), ${row.outcome})`)
      .join(', ');
    lines.push(
      `Inner runs you CAN open (${kept.length}): ${sample}` +
        (kept.length > INNER_RUN_SUGGESTION_CAP ? ', …' : '') +
        '.',
    );
  }
  if (lookup.dropped > 0) {
    lines.push(
      `⚠ ${lookup.dropped} older record(s) were dropped to stay under the retention cap of ` +
        `${lookup.limit} — this call may be one of them. Raise it with keepRecordLimit, or ask ` +
        `sooner after the call.`,
    );
  }
  return lines.join('\n');
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
