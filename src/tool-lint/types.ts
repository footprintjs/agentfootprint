/**
 * tool-lint types — the tool-catalog confusability lint contract
 * (RFC-002 tier 1, blocks C1–C3).
 *
 * Pattern: Strategy seam (the plug-and-play meta-pattern) — the frame
 *          and rule engine are the library's; the embedder, thresholds,
 *          and structural rule pack are all consumer-injected, with our
 *          defaults. Exactly like NarrativeFormatter / reliability /
 *          permission / commentary strategies.
 * Role:    `src/lib/` leaf module. ZERO stack buy-in: input is a plain
 *          `{ name, description?, inputSchema? }[]` — any OpenAI /
 *          Anthropic / LangChain / MCP tool list normalizes to it
 *          (see `coerceCatalog`). The library's own `Tool[]` adapts via
 *          `catalogFromTools`.
 *
 * ## Honest claim (RFC-002 §2)
 *
 * Confusability here is embedding geometry over what the model READS
 * (tool name + description) — a deterministic heuristic for "could the
 * model mix these up", never a measurement of any model's actual
 * selection function. Tier 3 (choice-entropy sampling) validates the
 * proxy; until then treat verdicts as review prompts, not ground truth.
 */

import type { Embedder, SimilarityPair } from '../influence-core/index.js';

/**
 * One tool as the lint sees it — the minimal, framework-agnostic shape.
 * `inputSchema` is a JSON Schema object (the same one the LLM sees);
 * structural rules read `properties` / `required` / `enum` from it.
 */
export interface CatalogTool {
  readonly name: string;
  readonly description?: string;
  /** JSON Schema for the tool's arguments (`type: 'object'` shape). */
  readonly inputSchema?: Readonly<Record<string, unknown>>;
}

/** Verdict for one description pair from the similarity analysis. */
export type PairVerdict = 'confusable' | 'watch';

/** One flagged pair: two tools the model could plausibly mix up. */
export interface ConfusablePairFinding {
  readonly kind: PairVerdict;
  /** Tool names (input order: `a` has the lower catalog index). */
  readonly a: string;
  readonly b: string;
  /** cosine(embed(a), embed(b)) over `confusabilityText` of each tool. */
  readonly similarity: number;
  /**
   * Heuristic suggestion for the DIFFERENTIATING AXIS — what to make
   * explicit in the descriptions so the model can tell them apart
   * (e.g. "names differ only by 'influx' — say WHEN to use each").
   */
  readonly hint: string;
}

/** Severity of a structural finding. `error` fails the gate by default. */
export type LintSeverity = 'error' | 'warn';

/** One structural finding from a `LintRule`. */
export interface StructuralFinding {
  /** Id of the rule that produced this finding. */
  readonly rule: string;
  /** Name of the offending tool. */
  readonly tool: string;
  readonly severity: LintSeverity;
  readonly message: string;
  /** Offending parameter name, when the finding is param-scoped. */
  readonly param?: string;
  /** Concrete fix suggestion (e.g. the JSON-Schema `enum` to add). */
  readonly suggestion?: string;
}

/**
 * One pluggable structural rule. Rules are plain objects — add your own
 * to `rules` in `analyzeToolCatalog` options, or filter the exported
 * `defaultStructuralRules` to remove ours.
 */
export interface LintRule {
  /** Stable id, kebab-case (shows on findings + CLI output). */
  readonly id: string;
  /** Inspect ONE tool (with the whole catalog for context) and return
   *  zero or more findings. Must not throw on weird-but-valid input. */
  check(tool: CatalogTool, catalog: readonly CatalogTool[]): readonly StructuralFinding[];
}

export interface AnalyzeToolCatalogOptions {
  /**
   * Injected embedder for the confusability analysis. OMITTED → the
   * similarity analysis is skipped (structural rules still run) and
   * `report.similarity.analyzed` is false.
   *
   * Wrap in an `EmbeddingCache` (from `agentfootprint/observe`) so
   * catalog descriptions embed once across lint runs — keyed by content
   * hash, so unchanged descriptions cost nothing on re-lint.
   */
  readonly embedder?: Embedder;
  /**
   * Pairs with similarity ≥ this are `confusable`. Default 0.85 — a
   * STARTING point calibrated for real sentence embedders (where
   * unrelated tool descriptions typically land 0.3–0.7).
   *
   * ⚠ Per-embedder calibration is REQUIRED (RFC-002 §3): absolute
   * cosine ranges differ by embedder. The test/demo `mockEmbedder`
   * (character-frequency) compresses unrelated prose into ~0.85–0.97,
   * so with the mock use `MOCK_EMBEDDER_CALIBRATION` and trust only
   * RELATIVE ordering of pairs, never absolute verdicts.
   */
  readonly confusabilityThreshold?: number;
  /**
   * Pairs within this band BELOW the threshold are `watch` (advisory —
   * never fail the gate). Default 0.05.
   */
  readonly watchBand?: number;
  /**
   * The structural rule pack. Default `defaultStructuralRules`.
   * Add/remove freely — rules are plain `{ id, check }` objects.
   */
  readonly rules?: readonly LintRule[];
  /**
   * Which structural severity fails the gate (`report.ok`).
   * Default 'error' — warnings are advisory. 'warn' = strict mode.
   */
  readonly failOn?: LintSeverity;
  /** Abort signal threaded to the embedder (network backends). */
  readonly signal?: AbortSignal;
}

/** The similarity section of a report. */
export interface SimilarityReport {
  /** False when no embedder was supplied — similarity was skipped. */
  readonly analyzed: boolean;
  readonly confusable: readonly ConfusablePairFinding[];
  readonly watch: readonly ConfusablePairFinding[];
  /**
   * EVERY pair ranked by similarity, descending — the relative-ordering
   * view that stays meaningful under ANY embedder (including the mock).
   * Empty when `analyzed` is false.
   */
  readonly ranked: readonly SimilarityPair[];
  readonly thresholds: {
    readonly confusabilityThreshold: number;
    readonly watchBand: number;
  };
}

/** The lint report — `ok` is the CI-gateable verdict. */
export interface ToolCatalogReport {
  /**
   * True when there are no confusable pairs AND no structural findings
   * at/above `failOn` severity. The CI gate: exit non-zero on `!ok`.
   */
  readonly ok: boolean;
  readonly toolCount: number;
  readonly similarity: SimilarityReport;
  readonly structural: readonly StructuralFinding[];
  readonly summary: {
    readonly confusable: number;
    readonly watch: number;
    readonly errors: number;
    readonly warnings: number;
  };
}

export type { Embedder, SimilarityPair };
