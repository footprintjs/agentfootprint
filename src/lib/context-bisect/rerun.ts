/**
 * rerunWithoutSources — the counterfactual re-run as ONE call: the product
 * loop over the existing ablation machinery.
 *
 * Take a finished run's `ContextBugReport`, name the sources to ignore
 * (plain ids — injection id, tool name, or step id), and hand it the SAME
 * `AblationRunner` the localizer's causal mode already uses. It resolves the
 * ids to their `AblationSpec`s, runs the existing `runAblationProbe` (N ≥ 2
 * seeded reruns — never a single-run diff), and returns
 * `{ answer, answers, removed, whatChanged, runs }`. Companion
 * `removableSources(report)` gives a UI the toggle vocabulary.
 *
 * No new machinery: this file never calls `applyAblations` itself — the
 * resolved specs go to the consumer's runner, whose body applies them at
 * agent construction (the documented seam; see `applyAblations`' example).
 * Works with mock providers ($0) and real ones alike.
 *
 * ## Honesty tiers (§B2, unchanged)
 *
 * Without `checkBaseline: true` the result reports what was OBSERVED
 * (`whatChanged.answerFlipped`, similarity, a plain summary) and carries NO
 * `verdict` — an observation, not a conviction. With it, the unchanged
 * scenario is probed too and `verdictFor` produces the causal-tier claim —
 * the same discipline as `localizeContextBug`'s causal mode.
 */
import type { Embedder } from '../influence-core/index.js';
import type {
  AblationRunner,
  AblationRunStats,
  AblationSpec,
  AblationVerdict,
  ContextBugReport,
  OutcomeComparator,
  SimilarityStats,
  SuspectKind,
} from './types.js';
import { ablationForSuspect, probeFlipped, runAblationProbe, verdictFor } from './ablation.js';
import { suspectLabel } from './localize.js';

/** A source to remove: a plain id (resolved against the report's suspects) or an explicit spec. */
export type IgnoredSource = string | AblationSpec;

export interface RerunWithoutSourcesOptions {
  /** The completed run's localizer report — where the suspects and their ablation specs live. */
  readonly report: ContextBugReport;
  /**
   * The sources to IGNORE on the re-run. A string matches a suspect by
   * `detail.injectionId`, then `detail.toolName`, then `source` (runtimeStageId) —
   * first ranked match wins. Unknown ids THROW (listing what `removableSources`
   * offers) — a silent no-op re-run would lie. An explicit `AblationSpec`
   * passes through untouched (escape hatch, incl. `kind: 'arg'` for runners
   * that handle input overrides).
   */
  readonly ignore: readonly IgnoredSource[];
  /**
   * The consumer's counterfactual runner — the SAME `AblationRunner` contract
   * the localizer's causal mode uses (fresh agent + provider per call, apply
   * the specs with `applyAblations` at construction, thread `seed`). Works
   * with mock providers ($0) and real ones alike.
   */
  readonly runner: AblationRunner;
  /** The original run's answer the re-runs are compared against. */
  readonly originalAnswer: string;
  /** Embedder for the similarity readout + the default comparator. `mockEmbedder()` is fine offline. */
  readonly embedder: Embedder;
  /** Seeded re-runs. Default 3; clamped to ≥ 2 (never single-run claims). */
  readonly samples?: number;
  /** Did the answer CHANGE? Default: embedding similarity < `flipThreshold`.
   *  Strongly recommended with `mockEmbedder`: pass a domain comparator. */
  readonly answerChanged?: OutcomeComparator;
  /** Similarity floor for the default comparator. Default 0.8. */
  readonly flipThreshold?: number;
  /**
   * Also probe the UNCHANGED scenario (empty specs) to check it reproduces
   * stably. Costs `samples` extra runs; unlocks the causal-tier `verdict`.
   * Default false — the result then reports observations only, and says so.
   */
  readonly checkBaseline?: boolean;
}

/** What changed between the original run and the re-runs — OBSERVED tier. */
export interface WhatChanged {
  /** A MAJORITY of the seeded re-runs produced a changed answer. */
  readonly answerFlipped: boolean;
  /** Re-runs whose answer changed / total re-runs. */
  readonly flips: number;
  readonly samples: number;
  /** Embedding similarity of each re-run answer to the original (variance always reported). */
  readonly similarityToOriginal: SimilarityStats;
  /** Whether the un-ablated baseline was probed for stability (`checkBaseline`). */
  readonly baselineChecked: boolean;
  /** Plain-language recap. PRESENTATION ONLY — read the fields as data, never parse this. */
  readonly summary: string;
}

export interface RerunWithoutSourcesResult {
  /** The re-run's answer — seed 0 of the seeded re-runs. */
  readonly answer: string;
  /** Every seeded re-run's answer, in seed order (`answers[0] === answer`). */
  readonly answers: readonly string[];
  /** The resolved ablation specs the runner received — one per distinct ignored source. */
  readonly removed: readonly AblationSpec[];
  readonly whatChanged: WhatChanged;
  /** The raw probe stats behind `whatChanged` (incl. `cost` when the runner reports `RunCost`). */
  readonly runs: AblationRunStats;
  /** Baseline (nothing-removed) probe stats — present only with `checkBaseline: true`. */
  readonly baseline?: AblationRunStats;
  /**
   * The CAUSAL-tier claim — present only with `checkBaseline: true` (§B2: a
   * causal verdict needs seeded reruns AND a stable baseline). Without it the
   * result stops at `whatChanged`, honestly observational.
   */
  readonly verdict?: AblationVerdict;
}

/** Resolution of the `ignore` list → the specs to remove + the ids that name them. */
interface ResolvedIgnore {
  readonly removed: AblationSpec[];
  /** String ids (deduped, resolution order) + `'<custom spec>'` per pass-through object. */
  readonly resolvedIds: string[];
}

/** Resolve the `ignore` list against the report's suspects — see the option doc. */
function resolveIgnored(
  report: ContextBugReport,
  ignore: readonly IgnoredSource[],
): ResolvedIgnore {
  const removed: AblationSpec[] = [];
  const resolvedIds: string[] = [];
  const seenIds = new Set<string>();

  for (const entry of ignore) {
    if (typeof entry !== 'string') {
      // Explicit spec — pass through untouched (no matching, no dedup).
      removed.push(entry);
      resolvedIds.push('<custom spec>');
      continue;
    }

    const suspect = report.suspects.find(
      (s) => s.detail?.injectionId === entry || s.detail?.toolName === entry || s.source === entry,
    );
    if (suspect === undefined) {
      const offered = removableSources(report)
        .map((s) => s.id)
        .join(', ');
      throw new Error(
        `rerunWithoutSources: '${entry}' matches no suspect on the report — removable ids: [${offered}]`,
      );
    }
    if (suspect.kind === 'stage') {
      throw new Error(
        `rerunWithoutSources: '${entry}' is a plain stage — plain stages have no removable input ` +
          `(re-rank or refactor).`,
      );
    }
    if (suspect.kind === 'arg') {
      const spec = ablationForSuspect(suspect);
      const note = spec !== undefined && spec.kind === 'arg' ? spec.note : 'untracked run input';
      throw new Error(
        `rerunWithoutSources: '${entry}' is run input — ${note} pass an explicit ` +
          `\`{ kind: 'arg', … }\` spec in \`ignore\` if your runner overrides run input.`,
      );
    }

    // Dedup by the RESOLVED suspect (first wins) — two aliases of one source
    // (injectionId vs runtimeStageId) must collapse to a single spec.
    const resolvedKey = suspect.detail?.injectionId ?? suspect.detail?.toolName ?? suspect.source;
    if (seenIds.has(resolvedKey)) continue;
    seenIds.add(resolvedKey);

    const spec = suspect.ablation ?? ablationForSuspect(suspect);
    if (spec === undefined) {
      throw new Error(
        `rerunWithoutSources: '${entry}' carries no removable identity — its suspect has no ` +
          `ablation spec.`,
      );
    }
    removed.push(spec);
    resolvedIds.push(entry);
  }

  if (removed.length === 0) {
    throw new Error(
      'rerunWithoutSources: ignore is empty — nothing to remove; for a plain baseline probe use ' +
        'runAblationProbe with empty specs.',
    );
  }
  return { removed, resolvedIds };
}

export async function rerunWithoutSources(
  options: RerunWithoutSourcesOptions,
): Promise<RerunWithoutSourcesResult> {
  const { removed, resolvedIds } = resolveIgnored(options.report, options.ignore);
  const label = `sources [${resolvedIds.join(', ')}]`;

  const samples = options.samples;
  const answers: string[] = [];
  // Capture each re-run's answer with ZERO extra runs (wrap the consumer's runner).
  const capturing: AblationRunner = async (specs, run) => {
    const raw = await options.runner(specs, run);
    answers[run.seed] = typeof raw === 'string' ? raw : raw.output;
    return raw;
  };
  const rerunConfig = {
    runner: capturing,
    originalOutput: options.originalAnswer,
    ...(samples !== undefined ? { samples } : {}),
    ...(options.answerChanged !== undefined ? { outcomeChanged: options.answerChanged } : {}),
    ...(options.flipThreshold !== undefined ? { flipThreshold: options.flipThreshold } : {}),
  };

  let baseline: AblationRunStats | undefined;
  if (options.checkBaseline === true) {
    // Baseline FIRST, un-captured (baseline answers are not surfaced).
    baseline = await runAblationProbe(
      { rerun: { ...rerunConfig, runner: options.runner }, embedder: options.embedder },
      [],
    );
  }
  const runs = await runAblationProbe({ rerun: rerunConfig, embedder: options.embedder }, removed);

  const flipped = probeFlipped(runs);
  const baselineChecked = options.checkBaseline === true;
  const baselineStable = baseline !== undefined ? !probeFlipped(baseline) : true;
  const mean = runs.similarity.mean;

  let summary: string;
  if (baselineChecked && !baselineStable) {
    summary =
      'The unchanged scenario itself gave different answers across seeded re-runs — no removal ' +
      'claim is trustworthy on an unstable scenario (see verdict).';
  } else if (flipped && baselineChecked) {
    summary =
      `Removing ${label} changed the answer in ${runs.flips}/${runs.samples} seeded re-runs ` +
      `(mean similarity to the original ${mean.toFixed(3)}). The unchanged scenario stayed ` +
      'stable — see verdict for the causal claim.';
  } else if (flipped) {
    summary =
      `Removing ${label} changed the answer in ${runs.flips}/${runs.samples} seeded re-runs ` +
      `(mean similarity ${mean.toFixed(3)}). Baseline stability was not checked — pass ` +
      'checkBaseline: true for a causal-tier verdict.';
  } else {
    summary =
      `Removing ${label} did not change the answer in ${runs.samples - runs.flips}/${
        runs.samples
      } ` + 'seeded re-runs — as far as these re-runs can see, those sources were not driving it.';
  }

  const whatChanged: WhatChanged = {
    answerFlipped: flipped,
    flips: runs.flips,
    samples: runs.samples,
    similarityToOriginal: runs.similarity,
    baselineChecked,
    summary,
  };

  const verdict: AblationVerdict | undefined = baselineChecked
    ? verdictFor(label, runs, baselineStable)
    : undefined;

  return {
    answer: answers[0],
    answers,
    removed,
    whatChanged,
    runs,
    ...(baseline !== undefined ? { baseline } : {}),
    ...(verdict !== undefined ? { verdict } : {}),
  };
}

/** One source a UI can offer as an "ignore" toggle. */
export interface RemovableSource {
  /** The id `rerunWithoutSources` accepts in `ignore` (injectionId ?? toolName ?? runtimeStageId). */
  readonly id: string;
  /** `'tool' | 'injection' | 'memory'` — the library-filterable kinds only. */
  readonly kind: SuspectKind;
  /** Human label (via `suspectLabel`) for the toggle row. */
  readonly label: string;
  /** runtimeStageId — drillable with the trace-toolpack tools. */
  readonly source: string;
  readonly stageName: string;
  /** The suspect's proxy score (correlational — sizes an Influence Map node, never convicts). */
  readonly score: number;
  /** The spec `rerunWithoutSources` will send for this id. */
  readonly spec: AblationSpec;
}

/**
 * The report's removable sources, ranked order, de-duplicated by id (first =
 * highest-ranked occurrence wins). Excludes kind `'stage'` (nothing to remove)
 * and `'arg'` (the library cannot filter run input — the runner must override
 * it; pass an explicit `kind: 'arg'` spec to `ignore` if yours does).
 */
export function removableSources(report: ContextBugReport): readonly RemovableSource[] {
  const out: RemovableSource[] = [];
  const seen = new Set<string>();
  for (const suspect of report.suspects) {
    if (suspect.kind !== 'tool' && suspect.kind !== 'injection' && suspect.kind !== 'memory') {
      continue;
    }
    const spec = suspect.ablation ?? ablationForSuspect(suspect);
    if (spec === undefined) continue;
    const id = suspect.detail?.injectionId ?? suspect.detail?.toolName ?? suspect.source;
    if (seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      kind: suspect.kind,
      label: suspectLabel(suspect),
      source: suspect.source,
      stageName: suspect.stageName,
      score: suspect.score,
      spec,
    });
  }
  return out;
}
