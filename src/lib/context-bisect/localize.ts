/**
 * localizeContextBug — the contextual-bug LOCALIZER, "git bisect for
 * context" (RFC-003 Part B, block D8).
 *
 * The five-stage pipeline (each stage is a shipped piece — this file only
 * ASSEMBLES):
 *
 *   1. TRIGGER     — an explicit `atStep`, a custom trigger strategy, or
 *                    the QualityRecorder's lowest-scoring step.
 *   2. SLICE       — footprintjs `causalChain` over the commit log, WITH
 *                    control-dependence edges (D3) and honesty markers
 *                    (A2/A4) when the artifacts carry them.
 *   3. WEIGH       — D7's `llmEdgeWeigher` stamps influence weights on
 *                    every LLM-call parent edge (two-pass: prime, re-slice).
 *   4. RANK        — suspects = slice nodes classified into ablatable
 *                    context sources (tool / injection / memory / arg),
 *                    scored by max-product path weight × per-item semantic
 *                    refinement. CORRELATIONAL tier — and marked so.
 *   5. ABLATE      — optional: the consumer's `AblationRunner` re-runs the
 *                    scenario without each top suspect, N seeded times.
 *                    Verdicts (the ONLY causal claims, §B2) + variance.
 *
 * Without a runner the report stops at stage 4 with
 * `mode: 'correlational'` — explicitly a ranking of proxies, no causal
 * claim anywhere.
 *
 * Every `source` / `step` id in the report is a plain runtimeStageId —
 * drill any of them with the trace-toolpack tools (`trace_node`,
 * `trace_slice`, `get_value`) over the same artifacts bag.
 */

import type { CommitBundle, StageSnapshot } from 'footprintjs/advanced';
import type { CausalNode } from 'footprintjs/trace';
import { causalChain, commitValueAt } from 'footprintjs/trace';

import { scoreInfluence, type Embedder, type EvidenceInput } from '../influence-core/index.js';
import { ablationForSuspect, runAblationProbe, verdictFor } from './ablation.js';
import { llmEdgeWeigher, stepOutputText } from './llmEdgeWeigher.js';
import { findDroppedContext, type ContextUnit } from './missingContext.js';
import { runRestorationProbe, type RestorationRerun } from './restoration.js';
import type {
  AblationRerun,
  AblationRunStats,
  ContextBugArtifacts,
  ContextBugReport,
  EdgePathStep,
  HonestyFlag,
  RestoredCandidate,
  SliceStats,
  Suspect,
  SuspectDetail,
  SuspectKind,
} from './types.js';
import { CONTEXT_BISECT_DEFAULTS } from './types.js';

// ─── LLM-call id extraction ──────────────────────────────────────────

/**
 * Extract LLM-call step ids from captured typed events: the
 * `meta.runtimeStageId` of every `agentfootprint.stream.llm_start`
 * envelope, deduplicated in event order. Collect events with
 * `agent.on('*', (e) => events.push(e))`.
 */
export function llmCallIdsFromEvents(
  events: readonly { readonly type: string; readonly meta: { readonly runtimeStageId: string } }[],
): string[] {
  const ids: string[] = [];
  const seen = new Set<string>();
  for (const event of events) {
    if (event.type !== 'agentfootprint.stream.llm_start') continue;
    const id = event.meta.runtimeStageId;
    if (seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
  }
  return ids;
}

// ─── Classification (suspect extraction) ─────────────────────────────

/** A classified-but-unscored suspect produced by a classifier. */
export interface SuspectSeed {
  readonly kind: SuspectKind;
  readonly detail?: SuspectDetail;
}

/** What a classifier sees for one slice node. */
export interface ClassifyContext {
  readonly node: CausalNode;
  /** Keys this node committed. */
  readonly keysWritten: readonly string[];
  /** Verb-aware value of a key as of this node's last commit. */
  readonly valueOf: (key: string) => unknown;
}

/**
 * Pluggable classifier: map one slice node to its ablatable context
 * sources. Return `undefined` to fall through to the default (which
 * understands the agent chart's committed shapes); return `[]` to
 * suppress the node entirely.
 */
export type SuspectClassifier = (ctx: ClassifyContext) => readonly SuspectSeed[] | undefined;

/** Injection flavors that are engineered context (ablatable by id). */
const ENGINEERED_SOURCES = new Set([
  'rag',
  'skill',
  'memory',
  'instructions',
  'steering',
  'fact',
  'custom',
]);

const INJECTION_SLOT_KEYS = ['systemPromptInjections', 'messagesInjections', 'toolsInjections'];

/** Structural slice of the committed `InjectionRecord` shape. */
interface InjectionRecordLike {
  readonly source?: unknown;
  readonly sourceId?: unknown;
  readonly rawContent?: unknown;
  readonly contentSummary?: unknown;
}

/**
 * The default classifier — reads the node's COMMITTED values (already
 * redaction-scrubbed) and recognizes the agent chart's shapes:
 *
 * - `systemPromptInjections` / `messagesInjections` / `toolsInjections`
 *   records with an engineered source → one suspect per `Injection.id`
 *   (kind `'memory'` for source `'memory'`, else `'injection'`).
 * - `lastToolResult` → a `'tool'` suspect for the tool that ran.
 * - footprintjs A2 honesty marker `args` → an `'arg'` suspect (the
 *   consumer's runner must override the input — nothing to filter).
 * - anything else → the honest `'stage'` fallback (no ablation spec).
 */
export function defaultSuspectClassifier(ctx: ClassifyContext): readonly SuspectSeed[] {
  const seeds: SuspectSeed[] = [];
  const seenInjection = new Set<string>();

  for (const slotKey of INJECTION_SLOT_KEYS) {
    if (!ctx.keysWritten.includes(slotKey)) continue;
    const records = ctx.valueOf(slotKey);
    if (!Array.isArray(records)) continue;
    for (const record of records as InjectionRecordLike[]) {
      const source = typeof record?.source === 'string' ? record.source : undefined;
      const sourceId = typeof record?.sourceId === 'string' ? record.sourceId : undefined;
      if (source === undefined || sourceId === undefined) continue;
      if (!ENGINEERED_SOURCES.has(source)) continue; // baseline flow (user/base/registry/…)
      const kind: SuspectKind = source === 'memory' ? 'memory' : 'injection';
      const dedupeKey = `${kind}:${sourceId}`;
      if (seenInjection.has(dedupeKey)) continue;
      seenInjection.add(dedupeKey);
      const text =
        typeof record.rawContent === 'string'
          ? record.rawContent
          : typeof record.contentSummary === 'string'
          ? record.contentSummary
          : undefined;
      seeds.push({
        kind,
        detail: {
          injectionId: sourceId,
          flavor: source,
          ...(text !== undefined ? { text } : {}),
        },
      });
    }
  }

  if (ctx.keysWritten.includes('lastToolResult')) {
    const value = ctx.valueOf('lastToolResult') as
      | { toolName?: unknown; result?: unknown }
      | undefined;
    if (value && typeof value.toolName === 'string') {
      seeds.push({
        kind: 'tool',
        detail: {
          toolName: value.toolName,
          ...(typeof value.result === 'string' ? { text: value.result } : {}),
        },
      });
    }
  }

  if (ctx.node.incompleteSources?.includes('args')) {
    seeds.push({ kind: 'arg' });
  }

  return seeds.length > 0 ? seeds : [{ kind: 'stage' }];
}

// ─── Snapshot index (stageReads lookup, names) ───────────────────────

interface ArtifactIndex {
  readonly commitLog: CommitBundle[];
  readonly lastIdxOf: Map<string, number>;
  readonly readsOf: Map<string, string[]>;
  readonly hasReadTracking: boolean;
}

function buildArtifactIndex(artifacts: ContextBugArtifacts): ArtifactIndex {
  const commitLog = (artifacts.snapshot.commitLog ?? []) as CommitBundle[];
  const lastIdxOf = new Map<string, number>();
  for (let i = 0; i < commitLog.length; i++) lastIdxOf.set(commitLog[i].runtimeStageId, i);

  const readsOf = new Map<string, string[]>();
  let hasReadTracking = false;
  const visit = (node: StageSnapshot | undefined): void => {
    if (!node) return;
    const id = node.runtimeStageId;
    if (id && !readsOf.has(id)) {
      const keys = node.stageReads ? Object.keys(node.stageReads) : [];
      readsOf.set(id, keys);
      if (keys.length > 0) hasReadTracking = true;
    }
    for (const child of node.children ?? []) visit(child);
    visit(node.next);
  };
  visit(artifacts.snapshot.executionTree as StageSnapshot | undefined);

  return { commitLog, lastIdxOf, readsOf, hasReadTracking };
}

// ─── Path scoring (max-product over the weighted DAG) ────────────────

interface PathInfo {
  /** Max product of edge weights from the trigger to this node. */
  score: number;
  /** The child + edge that realized the max — for path reconstruction. */
  via?: { child: CausalNode; kind: 'data' | 'control'; key?: string; weight: number };
}

/**
 * Best (max-product) path weight from the root to every slice node.
 * The slice DAG is topologically ordered by commit index (a writer always
 * commits before its reader; a decider before its branch), so one pass in
 * DESCENDING commit order finalizes children before their parents.
 */
function computePathScores(
  root: CausalNode,
  nodes: readonly CausalNode[],
  lastIdxOf: Map<string, number>,
): Map<string, PathInfo> {
  const info = new Map<string, PathInfo>();
  info.set(root.runtimeStageId, { score: 1 });

  const ordered = [...nodes].sort(
    (a, b) => (lastIdxOf.get(b.runtimeStageId) ?? -1) - (lastIdxOf.get(a.runtimeStageId) ?? -1),
  );
  for (const node of ordered) {
    const current = info.get(node.runtimeStageId);
    if (!current) continue; // unreachable from root (defensive)
    for (const edge of node.parentEdges) {
      const candidate = current.score * edge.weight;
      const existing = info.get(edge.parent.runtimeStageId);
      if (!existing || candidate > existing.score) {
        info.set(edge.parent.runtimeStageId, {
          score: candidate,
          via: { child: node, kind: edge.kind, key: edge.key, weight: edge.weight },
        });
      }
    }
  }
  return info;
}

function buildEdgePath(node: CausalNode, info: Map<string, PathInfo>): EdgePathStep[] {
  const steps: EdgePathStep[] = [];
  let cur = node;
  for (;;) {
    const via = info.get(cur.runtimeStageId)?.via;
    if (!via) break;
    steps.push({
      from: via.child.runtimeStageId,
      fromName: via.child.stageName,
      to: cur.runtimeStageId,
      toName: cur.stageName,
      kind: via.kind,
      ...(via.key !== undefined ? { key: via.key } : {}),
      weight: via.weight,
    });
    cur = via.child;
  }
  return steps.reverse(); // trigger → … → suspect
}

// ─── Options ─────────────────────────────────────────────────────────

export interface LocalizeContextBugOptions {
  readonly artifacts: ContextBugArtifacts;
  /** Injected embedder (D6) — wrap in `embeddingCache(...)`. */
  readonly embedder: Embedder;
  /** Explicit trigger step (runtimeStageId). Wins over everything. */
  readonly atStep?: string;
  /** Custom trigger strategy — consulted when `atStep` is absent. */
  readonly trigger?: (artifacts: ContextBugArtifacts) => string | undefined;
  /**
   * The counterfactual tier: supply a runner (+ the original output) and
   * top suspects get ablation verdicts. Absent → the report stops at the
   * ranking, marked `mode: 'correlational'`.
   */
  readonly rerun?: AblationRerun;
  /**
   * Interface #3 — the MISSING-context tier. Supply what was `available` for
   * the turn and what was `sent` to the model; the report's `dropped` lists the
   * units that never reached the model (`available − sent`). Add a `rerun` and
   * each dropped candidate gets a RESTORATION verdict (the mirror of ablation:
   * restoring it flips the outcome → causal). Absent → no `dropped` section.
   */
  readonly missingContext?: {
    readonly available: readonly ContextUnit[];
    readonly sent: readonly ContextUnit[];
    readonly rerun?: RestorationRerun;
  };
  /** Slice depth budget. Default 12. */
  readonly maxDepth?: number;
  /** Slice node budget. Default 80. */
  readonly maxNodes?: number;
  /** Ranked suspects kept on the report. Default 12. */
  readonly maxSuspects?: number;
  /** Override / extend the suspect classifier. */
  readonly classify?: SuspectClassifier;
}

// ─── The localizer ───────────────────────────────────────────────────

/**
 * Localize a contextual bug: trigger → causal slice → influence-weighted
 * ranking → (optional) counterfactual ablation. See module docs for the
 * pipeline and the §B2 claim tiers.
 *
 * @throws when no trigger can be resolved (no `atStep`, no custom
 *         strategy hit, no `artifacts.quality`), or when the trigger step
 *         is not in the commit log.
 */
export async function localizeContextBug(
  options: LocalizeContextBugOptions,
): Promise<ContextBugReport> {
  const { artifacts, embedder } = options;
  const maxDepth = options.maxDepth ?? CONTEXT_BISECT_DEFAULTS.maxDepth;
  const maxNodes = options.maxNodes ?? CONTEXT_BISECT_DEFAULTS.maxNodes;
  const maxSuspects = options.maxSuspects ?? CONTEXT_BISECT_DEFAULTS.maxSuspects;
  const index = buildArtifactIndex(artifacts);

  // ── 1. Trigger ────────────────────────────────────────────────────
  let step: string | undefined;
  let triggerSource: ContextBugReport['triggerSource'];
  let triggerScore: number | undefined;
  if (options.atStep !== undefined) {
    step = options.atStep;
    triggerSource = 'explicit';
  } else if (options.trigger !== undefined) {
    step = options.trigger(artifacts);
    triggerSource = 'custom';
  } else {
    const lowest = artifacts.quality?.getLowest();
    step = lowest?.runtimeStageId;
    triggerScore = lowest?.entry.score;
    triggerSource = 'quality';
  }
  if (step === undefined) {
    throw new Error(
      'localizeContextBug: no trigger step — pass atStep, supply a trigger strategy, ' +
        'or provide artifacts.quality (a QualityRecorder from the run).',
    );
  }
  if (!index.lastIdxOf.has(step)) {
    throw new Error(
      `localizeContextBug: trigger step '${step}' is not in the commit log — ` +
        'pass a runtimeStageId of a step that committed (see snapshot.commitLog).',
    );
  }

  // ── 2 + 3. Slice, then weigh (two-pass over the same evidence) ─────
  const keysReadOf = (id: string): string[] => index.readsOf.get(id) ?? [];
  const sliceOptions = {
    maxDepth,
    maxNodes,
    ...(artifacts.controlDeps ? { controlDeps: artifacts.controlDeps } : {}),
  };
  const unweighted = causalChain(index.commitLog, step, keysReadOf, sliceOptions);
  if (!unweighted) {
    throw new Error(`localizeContextBug: causalChain found no node for '${step}'.`);
  }

  const llmCallIds =
    artifacts.llmCallIds ?? (artifacts.events ? llmCallIdsFromEvents(artifacts.events) : []);
  const weigher = llmEdgeWeigher({
    embedder,
    llmCallIds,
    commitLog: index.commitLog,
  });
  await weigher.prime(unweighted);
  const root =
    causalChain(index.commitLog, step, keysReadOf, { ...sliceOptions, weigh: weigher.weigh }) ??
    unweighted;

  // ── 4. Rank ─────────────────────────────────────────────────────────
  const nodes = collectNodes(root);
  const pathInfo = computePathScores(root, nodes, index.lastIdxOf);
  const classify = options.classify;

  interface Draft {
    node: CausalNode;
    seed: SuspectSeed;
    structuralScore: number;
    edgePath: EdgePathStep[];
    semanticScore?: number;
  }
  const drafts: Draft[] = [];
  for (const node of nodes) {
    if (node.runtimeStageId === root.runtimeStageId) continue; // the trigger itself
    const info = pathInfo.get(node.runtimeStageId);
    if (!info) continue;
    const ctx: ClassifyContext = {
      node,
      keysWritten: node.keysWritten,
      valueOf: (key) => {
        const idx = index.lastIdxOf.get(node.runtimeStageId);
        return idx === undefined ? undefined : commitValueAt(index.commitLog, idx, key);
      },
    };
    const seeds = classify?.(ctx) ?? defaultSuspectClassifier(ctx);
    const edgePath = buildEdgePath(node, pathInfo);
    for (const seed of seeds) {
      drafts.push({ node, seed, structuralScore: info.score, edgePath });
    }
  }

  // Semantic refinement: ONE influence-core pass over every suspect that
  // has its own content text, against the trigger step's output. Ancestor
  // texts = LLM-call outputs on the suspect's path (the FDL casting).
  const triggerOutput = stepOutputText(
    index.commitLog,
    index.lastIdxOf,
    root.runtimeStageId,
    CONTEXT_BISECT_DEFAULTS.maxTextChars,
  );
  if (triggerOutput !== undefined) {
    const llmIdSet = new Set(llmCallIds);
    const evidence: EvidenceInput[] = [];
    const evidenceDraft: Draft[] = [];
    drafts.forEach((draft, i) => {
      const text = draft.seed.detail?.text;
      if (text === undefined || text.length === 0) return;
      const ancestorTexts: string[] = [];
      for (const hop of draft.edgePath) {
        // Intermediate LLM steps between trigger and suspect (exclusive).
        if (hop.from !== root.runtimeStageId && llmIdSet.has(hop.from)) {
          const ancestorText = stepOutputText(
            index.commitLog,
            index.lastIdxOf,
            hop.from,
            CONTEXT_BISECT_DEFAULTS.maxTextChars,
          );
          if (ancestorText !== undefined) ancestorTexts.push(ancestorText);
        }
      }
      evidence.push({ id: String(i), text, ancestorTexts });
      evidenceDraft.push(draft);
    });
    if (evidence.length > 0) {
      const scores = await scoreInfluence({ evidence, finalAnswerText: triggerOutput, embedder });
      const byId = new Map(scores.map((s) => [s.id, s.score]));
      evidence.forEach((item, i) => {
        const composite = byId.get(item.id);
        if (composite !== undefined) {
          evidenceDraft[i].semanticScore = Math.max(0, Math.min(1, composite));
        }
      });
    }
  }

  const ranked: Suspect[] = drafts
    .map((draft) => {
      const score =
        draft.semanticScore !== undefined
          ? draft.structuralScore * draft.semanticScore
          : draft.structuralScore;
      const suspect: Suspect = {
        source: draft.node.runtimeStageId,
        stageName: draft.node.stageName,
        kind: draft.seed.kind,
        ...(draft.seed.detail !== undefined ? { detail: draft.seed.detail } : {}),
        score,
        structuralScore: draft.structuralScore,
        ...(draft.semanticScore !== undefined ? { semanticScore: draft.semanticScore } : {}),
        hasContentEvidence: draft.semanticScore !== undefined,
        edgePath: draft.edgePath,
      };
      const ablation = ablationForSuspect(suspect);
      return ablation !== undefined ? { ...suspect, ablation } : suspect;
    })
    .sort((a, b) => b.score - a.score) // stable: ties keep slice order
    .slice(0, maxSuspects);

  // ── Slice stats + honesty flags ─────────────────────────────────────
  const sliceStats = buildSliceStats(root, nodes, maxDepth, maxNodes);
  const honestyFlags = buildHonestyFlags(artifacts, index, sliceStats, llmCallIds.length);

  // ── 5b. Missing-context tier (interface #3) ─────────────────────────
  // Independent of ablation: finds what was available but never sent, and —
  // with a restoration runner — confirms each by restoration (the causal mirror).
  const missing = options.missingContext
    ? await runMissingContextTier(options.missingContext, embedder)
    : undefined;
  const dropped = missing?.candidates;
  // A restoration verdict (even not-confirmed) is a causal-tier statement.
  const restorationRan = dropped?.some((d) => d.verdict !== undefined) ?? false;
  // Mirror ablation's honesty: an unstable un-restored baseline (the buggy
  // output itself not reproducing) invalidates every restoration verdict —
  // surface it as a machine-readable flag, not just inside each claim string.
  const restorationFlags: HonestyFlag[] =
    missing?.baseline !== undefined && !missing.baselineStable
      ? [
          {
            flag: 'baseline-unstable',
            note:
              `the un-restored baseline changed outcome in ${missing.baseline.flips}/${missing.baseline.samples} ` +
              'seeded reruns — all restoration verdicts are inconclusive.',
          },
        ]
      : [];

  // ── 5. Ablate (the causal tier) ─────────────────────────────────────
  if (options.rerun === undefined) {
    return {
      step,
      stepName: root.stageName,
      triggerSource,
      ...(triggerScore !== undefined ? { triggerScore } : {}),
      mode: restorationRan ? 'causal' : 'correlational',
      suspects: ranked,
      ...(dropped ? { dropped } : {}),
      sliceStats,
      honestyFlags: [...honestyFlags, ...restorationFlags],
      ...(missing?.baseline !== undefined ? { restorationBaseline: missing.baseline } : {}),
    };
  }

  const probeConfig = { rerun: options.rerun, embedder };
  const maxAblations = options.rerun.maxSuspects ?? 5;

  // Baseline first: an unstable scenario invalidates every verdict.
  const baseline = await runAblationProbe(probeConfig, []);
  const baselineStable = baseline.flips === 0;
  const flags = baselineStable
    ? honestyFlags
    : [
        ...honestyFlags,
        {
          flag: 'baseline-unstable' as const,
          note:
            `the un-ablated baseline changed outcome in ${baseline.flips}/${baseline.samples} ` +
            'seeded reruns — all ablation verdicts are inconclusive.',
        },
      ];

  const withVerdicts: Suspect[] = [];
  let ablated = 0;
  for (const suspect of ranked) {
    if (
      suspect.ablation === undefined ||
      suspect.ablation.kind === 'arg' ||
      ablated >= maxAblations
    ) {
      withVerdicts.push(suspect);
      continue;
    }
    ablated++;
    const stats = await runAblationProbe(probeConfig, [suspect.ablation]);
    const verdict = verdictFor(suspectLabel(suspect), stats, baselineStable);
    withVerdicts.push({ ...suspect, runs: stats, verdict });
  }

  return {
    step,
    stepName: root.stageName,
    triggerSource,
    ...(triggerScore !== undefined ? { triggerScore } : {}),
    mode: 'causal',
    suspects: withVerdicts,
    ...(dropped ? { dropped } : {}),
    sliceStats,
    honestyFlags: [...flags, ...restorationFlags],
    baseline,
    ...(missing?.baseline !== undefined ? { restorationBaseline: missing.baseline } : {}),
  };
}

/** Result of the missing-context tier — candidates plus the restoration
 *  baseline (mirrors how the ablation tier surfaces `baseline` + stability). */
interface MissingContextTierResult {
  readonly candidates: readonly RestoredCandidate[];
  /** The un-restored baseline probe (only when a runner ran). */
  readonly baseline?: AblationRunStats;
  /** False only when the baseline ran and was unstable. */
  readonly baselineStable: boolean;
}

/**
 * Interface #3 tier: find context available but not sent, and — with a
 * restoration runner — confirm each by restoration (the mirror of ablation).
 * Without a runner, returns the dropped units as candidates (no verdicts).
 * Only the first `maxCandidates` dropped units are probed (REAL LLM re-runs);
 * the rest are listed as bare candidates (`verdict`/`runs` undefined), exactly
 * like the ablation tier leaves over-budget suspects verdict-less.
 */
async function runMissingContextTier(
  missing: NonNullable<LocalizeContextBugOptions['missingContext']>,
  embedder: Embedder,
): Promise<MissingContextTierResult> {
  const { dropped } = findDroppedContext(missing.available, missing.sent);
  const asCandidate = (u: ContextUnit): RestoredCandidate =>
    u.content === undefined ? { id: u.id } : { id: u.id, content: u.content };

  // Nothing dropped → no candidates and NO baseline probe (don't spend real
  // model calls confirming an empty set — the common healthy case).
  if (dropped.length === 0) return { candidates: [], baselineStable: true };
  if (missing.rerun === undefined) return { candidates: dropped.map(asCandidate), baselineStable: true };

  const config = { rerun: missing.rerun, embedder };
  const maxCandidates = missing.rerun.maxCandidates ?? 5;
  // Baseline: restoring nothing must reproduce the buggy output (stable).
  const baseline = await runRestorationProbe(config, []);
  const baselineStable = baseline.flips === 0;

  const out: RestoredCandidate[] = [];
  let restored = 0;
  for (const unit of dropped) {
    if (restored >= maxCandidates) {
      out.push(asCandidate(unit)); // over budget — listed, not probed (no verdict)
      continue;
    }
    restored++;
    const runs = await runRestorationProbe(config, [unit]);
    const verdict = verdictFor(`dropped "${unit.id}"`, runs, baselineStable, 'restoring');
    out.push({ ...asCandidate(unit), runs, verdict });
  }
  return { candidates: out, baseline, baselineStable };
}

// ─── Internals ───────────────────────────────────────────────────────

function collectNodes(root: CausalNode): CausalNode[] {
  const out: CausalNode[] = [];
  const seen = new Set<string>();
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift() as CausalNode;
    if (seen.has(node.runtimeStageId)) continue;
    seen.add(node.runtimeStageId);
    out.push(node);
    for (const parent of node.parents) queue.push(parent);
  }
  return out;
}

function buildSliceStats(
  root: CausalNode,
  nodes: readonly CausalNode[],
  maxDepth: number,
  maxNodes: number,
): SliceStats {
  let dataEdges = 0;
  let controlEdges = 0;
  let weightedEdges = 0;
  let incompleteNodes = 0;
  for (const node of nodes) {
    if (node.incompleteSources && node.incompleteSources.length > 0) incompleteNodes++;
    for (const edge of node.parentEdges) {
      if (edge.kind === 'data') dataEdges++;
      else controlEdges++;
      if (edge.weight !== 1) weightedEdges++;
    }
  }
  return {
    nodes: nodes.length,
    dataEdges,
    controlEdges,
    weightedEdges,
    incompleteNodes,
    maxDepth,
    maxNodes,
    ...(root.truncated !== undefined ? { truncated: root.truncated } : {}),
  };
}

function buildHonestyFlags(
  artifacts: ContextBugArtifacts,
  index: ArtifactIndex,
  sliceStats: SliceStats,
  llmCallIdCount: number,
): HonestyFlag[] {
  const flags: HonestyFlag[] = [];
  if (sliceStats.truncated !== undefined) {
    const causes = [
      sliceStats.truncated.byDepth && `maxDepth (${sliceStats.maxDepth})`,
      sliceStats.truncated.byNodes && `maxNodes (${sliceStats.maxNodes})`,
    ]
      .filter(Boolean)
      .join(' + ');
    flags.push({
      flag: 'slice-truncated',
      note: `the slice was cut by ${causes} — older causes exist beyond this horizon; the ranking cannot see them.`,
    });
  }
  if (sliceStats.incompleteNodes > 0) {
    flags.push({
      flag: 'untracked-sources',
      note:
        `${sliceStats.incompleteNodes} slice node(s) also consumed untracked inputs ` +
        '(args/env/silent reads) — those inputs produce no edges; the slice through them is incomplete.',
    });
  }
  if (!artifacts.controlDeps) {
    flags.push({
      flag: 'no-control-deps',
      note:
        'no control-dependence lookup in the artifacts (attach controlDepRecorder() to the run) — ' +
        'decisions that routed execution are missing from the slice.',
    });
  }
  if (!index.hasReadTracking) {
    flags.push({
      flag: 'no-read-tracking',
      note:
        'the snapshot carries no per-step read tracking — read→write edges cannot be followed; ' +
        'the slice may contain only the trigger step.',
    });
  }
  if (llmCallIdCount === 0) {
    flags.push({
      flag: 'no-llm-call-ids',
      note:
        'no LLM-call step ids (pass llmCallIds or captured events) — no edge received an ' +
        'influence weight; the ranking is structure-only.',
    });
  }
  return flags;
}

export function suspectLabel(suspect: Suspect): string {
  const id = suspect.detail?.toolName ?? suspect.detail?.injectionId ?? suspect.source;
  return `${suspect.kind} '${id}'`;
}

// ─── Formatting ──────────────────────────────────────────────────────

/**
 * Human-readable report. The claim tiers are spelled out in the output
 * itself (§B2): scores are proxies; verdict lines are the only causal
 * claims; every ⚠ honesty flag prints.
 */
export function formatContextBugReport(report: ContextBugReport): string {
  const lines: string[] = [];
  lines.push(
    `CONTEXT BUG LOCALIZATION — trigger ${report.step} "${report.stepName}" ` +
      `(${report.triggerSource}${
        report.triggerScore !== undefined ? `, score ${report.triggerScore.toFixed(2)}` : ''
      })`,
  );
  lines.push(
    report.mode === 'causal'
      ? 'mode: CAUSAL — ranked proxies + counterfactual ablation verdicts (verdicts are the only causal claims)'
      : 'mode: CORRELATIONAL — ranking only; every score is an embedding-geometry proxy, no causal claim is made',
  );
  const s = report.sliceStats;
  lines.push(
    `slice: ${s.nodes} nodes · ${s.dataEdges} data edges · ${s.controlEdges} control edges · ` +
      `${s.weightedEdges} influence-weighted`,
  );

  lines.push('', `SUSPECTS (${report.suspects.length}, ranked by correlational proxy score):`);
  report.suspects.forEach((suspect, i) => {
    const scoreParts =
      suspect.semanticScore !== undefined
        ? `${suspect.score.toFixed(3)} (path ${suspect.structuralScore.toFixed(
            3,
          )} × content ${suspect.semanticScore.toFixed(3)})`
        : `${suspect.score.toFixed(3)} (path only — no content signal; an upper bound)`;
    lines.push(
      `${String(i + 1).padStart(2)}. [${suspectLabel(suspect)}] at ${suspect.source} ` +
        `"${suspect.stageName}" — score ${scoreParts}`,
    );
    if (suspect.edgePath.length > 0) {
      const hops = suspect.edgePath
        .map((hop) => {
          const link =
            hop.kind === 'control'
              ? `[control${hop.key ? `: ${hop.key}` : ''}]`
              : hop.key ?? 'data';
          const weight = hop.weight !== 1 ? ` ${hop.weight.toFixed(3)}` : '';
          return `←(${link}${weight})— ${hop.to}`;
        })
        .join(' ');
      lines.push(`    path: ${suspect.edgePath[0].from} ${hops}`);
    }
    if (suspect.verdict !== undefined && suspect.runs !== undefined) {
      lines.push(`    verdict: ${suspect.verdict.claim}`);
      lines.push(
        `    runs: ${suspect.runs.flips}/${suspect.runs.samples} flipped · similarity to original ` +
          `${suspect.runs.similarity.mean.toFixed(3)} ± ${suspect.runs.similarity.stdev.toFixed(
            3,
          )} ` +
          `[${suspect.runs.similarity.min.toFixed(3)}, ${suspect.runs.similarity.max.toFixed(3)}]`,
      );
    } else if (report.mode === 'correlational') {
      lines.push(
        '    verdict: (none — correlational ranking only; supply an AblationRunner to test causally)',
      );
    }
  });

  // Missing-context tier (interface #3) — symmetric with the SUSPECTS block.
  if (report.dropped !== undefined && report.dropped.length > 0) {
    lines.push('', `MISSING CONTEXT (${report.dropped.length} dropped — available but never sent to the model):`);
    report.dropped.forEach((c, i) => {
      lines.push(`${String(i + 1).padStart(2)}. [dropped '${c.id}']`);
      if (c.verdict !== undefined && c.runs !== undefined) {
        lines.push(`    verdict: ${c.verdict.claim}`);
        lines.push(
          `    runs: ${c.runs.flips}/${c.runs.samples} flipped on restore · similarity to original ` +
            `${c.runs.similarity.mean.toFixed(3)} ± ${c.runs.similarity.stdev.toFixed(3)}`,
        );
      } else {
        lines.push(
          '    verdict: (none — candidate only; supply missingContext.rerun to confirm by restoration)',
        );
      }
    });
  }

  if (report.baseline !== undefined) {
    lines.push(
      '',
      `baseline (no ablation): ${report.baseline.flips}/${report.baseline.samples} flipped · ` +
        `similarity ${report.baseline.similarity.mean.toFixed(
          3,
        )} ± ${report.baseline.similarity.stdev.toFixed(3)}`,
    );
  }

  if (report.restorationBaseline !== undefined) {
    lines.push(
      `baseline (no restoration): ${report.restorationBaseline.flips}/${report.restorationBaseline.samples} flipped · ` +
        `similarity ${report.restorationBaseline.similarity.mean.toFixed(3)} ± ${report.restorationBaseline.similarity.stdev.toFixed(3)}`,
    );
  }

  if (report.honestyFlags.length > 0) {
    lines.push('', 'HONESTY:');
    for (const flag of report.honestyFlags) lines.push(`⚠ [${flag.flag}] ${flag.note}`);
  }
  lines.push(
    '',
    'claims: scores/weights are deterministic embedding-geometry PROXIES (semantic alignment, ' +
      'not model internals); slice completeness is bounded by tracking (see HONESTY); only ' +
      'ablation verdicts make causal claims.',
  );
  return lines.join('\n');
}
