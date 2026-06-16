/**
 * Ablation — the counterfactual seam (RFC-003 Part B, D8 stage 4 + the
 * D9 stats engine).
 *
 * Three pieces:
 *
 *   1. **Adapters** — `ablationForSuspect` maps a classified suspect to
 *      the spec that removes it (tool → drop from catalog; injection /
 *      fact / skill → exclude the `Injection.id`; memory → filter the
 *      `MemoryEntry.id`; arg → consumer-override note).
 *
 *   2. **The seam** — `applyAblations` filters the inputs an agent is
 *      BUILT from. Documented here because the seam did not previously
 *      exist: `AgentOptions` has no `ignoredTools` runtime kill-switch, so
 *      tool ablation happens at construction (the consumer's
 *      `AblationRunner` rebuilds the agent from filtered inputs). Same for
 *      injections and memory entries.
 *
 *   3. **The probe engine** — `runAblationProbe` calls the consumer's
 *      runner N seeded times, measures embedding similarity to the
 *      original output, counts outcome flips, and returns variance —
 *      never a single-run verdict (D9 discipline).
 *
 * §B2: only `runAblationProbe`-derived verdicts are causal claims; every
 * score elsewhere is a correlational proxy.
 */

import { cosineSimilarity } from '../../memory/embedding/cosine.js';
import type { Embedder } from '../influence-core/index.js';
import type {
  AblationRerun,
  AblationRunStats,
  AblationSpec,
  AblationVerdict,
  CostRange,
  CostStats,
  OutcomeComparator,
  SimilarityStats,
  Suspect,
} from './types.js';
import { CONTEXT_BISECT_DEFAULTS } from './types.js';

// ─── Adapters: suspect → spec ────────────────────────────────────────

/**
 * The spec that removes one suspect — or `undefined` for kind `'stage'`
 * (plain pipeline stages have no removable input; re-rank or refactor).
 */
export function ablationForSuspect(suspect: Suspect): AblationSpec | undefined {
  switch (suspect.kind) {
    case 'tool':
      return suspect.detail?.toolName !== undefined
        ? { kind: 'tool', ignoredTools: [suspect.detail.toolName] }
        : undefined;
    case 'injection':
      return suspect.detail?.injectionId !== undefined
        ? { kind: 'injection', excludeInjectionIds: [suspect.detail.injectionId] }
        : undefined;
    case 'memory':
      return suspect.detail?.injectionId !== undefined
        ? { kind: 'memory', excludeMemoryIds: [suspect.detail.injectionId] }
        : undefined;
    case 'arg':
      return {
        kind: 'arg',
        source: suspect.source,
        note:
          `step ${suspect.source} consumed untracked run input ($getArgs()/env) — ` +
          `the runner must override the input itself; the library cannot filter it.`,
      };
    case 'stage':
      return undefined;
  }
}

// ─── The seam: apply specs to agent-construction inputs ──────────────

/** Anything with a stable id — `Injection` and `MemoryEntry` both fit. */
interface Identified {
  readonly id: string;
}

/** Anything with a named schema — the library's `Tool` fits. */
interface NamedTool {
  readonly schema: { readonly name: string };
}

export interface AblationTargets<
  TTool extends NamedTool = NamedTool,
  TInjection extends Identified = Identified,
  TMemoryEntry extends Identified = Identified,
> {
  readonly tools?: readonly TTool[];
  readonly injections?: readonly TInjection[];
  readonly memoryEntries?: readonly TMemoryEntry[];
}

/**
 * Apply ablation specs to the inputs an agent is constructed from —
 * THE documented seam (see module docs). Generic over the concrete tool /
 * injection / memory-entry types so it filters without importing them.
 *
 * `'arg'` specs are deliberately NOT handled here: run input belongs to
 * the consumer's runner (`spec.note` says so).
 *
 * @example inside an AblationRunner
 * ```ts
 * const { tools, injections } = applyAblations(specs, {
 *   tools: ALL_TOOLS, injections: ALL_FACTS,
 * });
 * const agent = Agent.create({ provider: freshProvider(), model })
 *   .tools([...tools]);
 * for (const inj of injections) agent.fact(inj);
 * ```
 */
export function applyAblations<
  TTool extends NamedTool,
  TInjection extends Identified,
  TMemoryEntry extends Identified,
>(
  specs: readonly AblationSpec[],
  targets: AblationTargets<TTool, TInjection, TMemoryEntry>,
): {
  tools: readonly TTool[];
  injections: readonly TInjection[];
  memoryEntries: readonly TMemoryEntry[];
} {
  const ignoredTools = new Set<string>();
  const excludedInjections = new Set<string>();
  const excludedMemory = new Set<string>();
  for (const spec of specs) {
    if (spec.kind === 'tool') for (const name of spec.ignoredTools) ignoredTools.add(name);
    if (spec.kind === 'injection')
      for (const id of spec.excludeInjectionIds) excludedInjections.add(id);
    if (spec.kind === 'memory') for (const id of spec.excludeMemoryIds) excludedMemory.add(id);
  }
  return {
    tools: (targets.tools ?? []).filter((tool) => !ignoredTools.has(tool.schema.name)),
    injections: (targets.injections ?? []).filter(
      (injection) => !excludedInjections.has(injection.id),
    ),
    memoryEntries: (targets.memoryEntries ?? []).filter((entry) => !excludedMemory.has(entry.id)),
  };
}

// ─── The probe engine (D9 stats) ─────────────────────────────────────

/** Resolve the seeded-rerun count: default on non-finite, floor, clamp to >= 2
 *  (no single-run verdicts — D9). Shared by the ablation + restoration probes. */
export function resolveSamples(samples: number | undefined): number {
  const raw = samples ?? CONTEXT_BISECT_DEFAULTS.samples;
  return Math.max(2, Number.isFinite(raw) ? Math.floor(raw) : CONTEXT_BISECT_DEFAULTS.samples);
}

/** Median of a numeric sample (mean of the two middles for even length). */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function costRange(values: readonly number[]): CostRange {
  return { median: median(values), min: Math.min(...values), max: Math.max(...values) };
}

/** Build a probe's CostStats from per-seed loop/token samples — undefined when
 *  the runner reported no cost (keeps quality-only behavior byte-identical). */
export function costStatsFrom(
  samples: number,
  loops: readonly number[],
  tokens: readonly number[],
): CostStats | undefined {
  if (loops.length === 0 && tokens.length === 0) return undefined;
  return {
    samples,
    ...(loops.length > 0 ? { loops: costRange(loops) } : {}),
    ...(tokens.length > 0 ? { tokens: costRange(tokens) } : {}),
  };
}

export function similarityStats(values: readonly number[]): SimilarityStats {
  if (values.length === 0) return { mean: 0, min: 0, max: 0, stdev: 0 };
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length;
  return {
    mean,
    min: Math.min(...values),
    max: Math.max(...values),
    stdev: Math.sqrt(variance),
  };
}

/** The default comparator: embedding similarity below the threshold. */
export function defaultOutcomeComparator(
  embedder: Embedder,
  flipThreshold: number,
): OutcomeComparator {
  return async (original, ablated) => {
    const [a, b] = await Promise.all([
      embedder.embed({ text: original }),
      embedder.embed({ text: ablated }),
    ]);
    return cosineSimilarity(a, b) < flipThreshold;
  };
}

/** Resolved probe configuration shared by D8 and D9. */
export interface ProbeConfig {
  readonly rerun: AblationRerun;
  readonly embedder: Embedder;
}

/**
 * Run ONE probe: call the consumer's runner with `specs` once per seed
 * (0..samples-1), measure each output's embedding similarity to the
 * original, and count outcome flips. Variance is always reported.
 *
 * `samples` is clamped to ≥ 2 — D9: never single-run verdicts.
 */
export async function runAblationProbe(
  config: ProbeConfig,
  specs: readonly AblationSpec[],
): Promise<AblationRunStats> {
  const samples = resolveSamples(config.rerun.samples);
  const flipThreshold = config.rerun.flipThreshold ?? CONTEXT_BISECT_DEFAULTS.flipThreshold;
  const outcomeChanged =
    config.rerun.outcomeChanged ?? defaultOutcomeComparator(config.embedder, flipThreshold);

  const similarities: number[] = [];
  const loopsPerSeed: number[] = [];
  const tokensPerSeed: number[] = [];
  let flips = 0;
  const originalVec = await config.embedder.embed({ text: config.rerun.originalOutput });
  for (let seed = 0; seed < samples; seed++) {
    // Normalize string | { output, cost } — backward-compatible (one ablation,
    // two readouts: output for the flip, cost for the second score).
    const raw = await config.rerun.runner(specs, { seed });
    const output = typeof raw === 'string' ? raw : raw.output;
    const cost = typeof raw === 'string' ? undefined : raw.cost;
    if (cost?.loops !== undefined) loopsPerSeed.push(cost.loops);
    if (cost?.tokens !== undefined) tokensPerSeed.push(cost.tokens);
    const outputVec = await config.embedder.embed({ text: output });
    similarities.push(cosineSimilarity(originalVec, outputVec));
    if (await outcomeChanged(config.rerun.originalOutput, output)) flips++;
  }
  const cost = costStatsFrom(samples, loopsPerSeed, tokensPerSeed);
  return {
    samples,
    flips,
    similarity: similarityStats(similarities),
    ...(cost !== undefined ? { cost } : {}),
  };
}

/** Majority-flip rule shared by D8 verdicts and D9 probes. */
export function probeFlipped(stats: AblationRunStats): boolean {
  return stats.flips * 2 > stats.samples;
}

/**
 * Translate probe evidence into the verdict — the ONLY causal claim tier
 * (§B2). `baselineStable=false` (the un-ablated scenario itself flipped)
 * forces `'inconclusive'`: no ablation verdict is trustworthy on an
 * unstable baseline.
 */
export function verdictFor(
  label: string,
  stats: AblationRunStats,
  baselineStable: boolean,
  /** The counterfactual intervention. `'ablating'` (default) for present
   *  suspects; `'restoring'` for missing-context candidates (interface #3).
   *  Default keeps every claim string byte-identical to before. */
  action: 'ablating' | 'restoring' = 'ablating',
): AblationVerdict {
  const baselineWord = action === 'ablating' ? 'un-ablated' : 'un-restored';
  const tierWord = action === 'ablating' ? 'ablation' : 'restoration';
  if (!baselineStable) {
    return {
      verdict: 'inconclusive',
      claim:
        `INCONCLUSIVE: the ${baselineWord} baseline itself changed outcome across seeded reruns — ` +
        `no ${tierWord} verdict for ${label} is trustworthy on an unstable scenario.`,
    };
  }
  if (probeFlipped(stats)) {
    return {
      verdict: 'confirmed',
      claim:
        `CAUSAL: ${action} ${label} flipped the outcome in ${stats.flips}/${stats.samples} ` +
        `seeded reruns (mean similarity to original ${stats.similarity.mean.toFixed(3)} ` +
        `± ${stats.similarity.stdev.toFixed(3)}).`,
    };
  }
  if (stats.flips > 0) {
    return {
      verdict: 'inconclusive',
      claim:
        `INCONCLUSIVE: ${action} ${label} flipped only ${stats.flips}/${stats.samples} seeded ` +
        `reruns — below majority; raise samples or check scenario stability.`,
    };
  }
  return {
    verdict: 'not-confirmed',
    claim:
      `NOT CONFIRMED: ${action} ${label} did not change the outcome in ${stats.samples} seeded ` +
      `reruns — its ranking remains a correlational proxy only.`,
  };
}
