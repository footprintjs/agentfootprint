/**
 * analyzeToolCatalog — the tool-catalog confusability lint
 * (RFC-002 block C1, the adoption front door).
 *
 * Pattern: policy layer over `pairwiseSimilarity` (influence-core) — the
 *          geometry is computed there; thresholds, verdicts, hints and
 *          the structural rule pack live here. Everything is consumer-
 *          injectable with our defaults (the plug-and-play meta-pattern).
 * Role:    `src/lib/tool-lint/`. ZERO stack buy-in — plain
 *          `{ name, description?, inputSchema? }[]` in, report out.
 *          `catalogFromTools` adapts the library's own `Tool[]`;
 *          `coerceCatalog` (cli.ts) normalizes OpenAI/Anthropic/MCP
 *          shapes.
 *
 * ## What is embedded (and why)
 *
 * `confusabilityText(tool)` = tokenized name + ': ' + description. The
 * model differentiates tools by name AND description together, so two
 * tools with near-identical names and overlapping descriptions ARE the
 * confusability case (`get_fcns_database` vs `influx_get_fcns_database`)
 * — embedding only the prose would miss the name signal.
 *
 * ## Calibration (RFC-002 §3 — read this before trusting verdicts)
 *
 * Absolute cosine ranges are PER-EMBEDDER. The default threshold (0.85)
 * is a starting point for real sentence embedders. The test/demo
 * `mockEmbedder` (character-frequency) compresses unrelated prose into
 * ~0.85–0.97 — with it, use `MOCK_EMBEDDER_CALIBRATION` and trust only
 * the RELATIVE ordering in `report.similarity.ranked` (the acceptance
 * fixtures assert ordering, never absolute scores).
 */

import type { Tool } from '../../core/tools.js';
import { pairwiseSimilarity, type SimilarityPair } from '../influence-core/index.js';
import { defaultStructuralRules } from './rules.js';
import type {
  AnalyzeToolCatalogOptions,
  CatalogTool,
  ConfusablePairFinding,
  StructuralFinding,
  ToolCatalogReport,
} from './types.js';

/** Default `confusabilityThreshold` — a starting point for REAL sentence
 *  embedders (unrelated tool descriptions typically land 0.3–0.7).
 *  Calibrate per embedder; meaningless for the mock (see below). */
export const DEFAULT_CONFUSABILITY_THRESHOLD = 0.85;

/** Default `watchBand` below the threshold. */
export const DEFAULT_WATCH_BAND = 0.05;

/**
 * Threshold/band calibrated for the char-frequency `mockEmbedder` on
 * realistic tool prose (seed corpus: the Neo SAN catalog). The mock
 * compresses unrelated descriptions into ~0.85–0.97 cosine, so expect
 * false positives even at 0.94 — with the mock, the RELATIVE ordering
 * of `report.similarity.ranked` is the trustworthy signal; absolute
 * verdicts are only honest with a real embedder + per-embedder
 * calibration.
 */
export const MOCK_EMBEDDER_CALIBRATION = Object.freeze({
  confusabilityThreshold: 0.94,
  watchBand: 0.02,
});

/**
 * Adapt the library's `Tool[]` (from `defineTool` / `Agent.tool`) to the
 * lint's plain catalog shape. Trivial on purpose: `Tool.schema` already
 * IS `{ name, description, inputSchema }`.
 */
export function catalogFromTools(tools: readonly Tool[]): readonly CatalogTool[] {
  return tools.map((tool) => ({
    name: tool.schema.name,
    description: tool.schema.description,
    inputSchema: tool.schema.inputSchema,
  }));
}

/**
 * The text the confusability analysis embeds for one tool: the name with
 * `_`/`-`/camelCase boundaries opened into words, then the description.
 * Exported so consumers can reproduce or replace the construction.
 */
export function confusabilityText(tool: CatalogTool): string {
  const name = tool.name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .trim();
  const description = tool.description?.trim() ?? '';
  return description.length > 0 ? `${name}: ${description}` : name;
}

/**
 * Lint a tool catalog: pairwise confusability over what the model reads
 * (when an embedder is supplied) + the structural rule pack. Returns a
 * report whose `ok` is the CI gate.
 *
 * Duplicate tool names are themselves reported as structural errors
 * (rule `duplicate-name`, built-in precondition — a catalog where two
 * tools share a name is broken before any similarity question); the
 * duplicates are dropped from the similarity analysis (first one wins).
 */
export async function analyzeToolCatalog(
  tools: readonly CatalogTool[],
  options: AnalyzeToolCatalogOptions = {},
): Promise<ToolCatalogReport> {
  const confusabilityThreshold = options.confusabilityThreshold ?? DEFAULT_CONFUSABILITY_THRESHOLD;
  const watchBand = options.watchBand ?? DEFAULT_WATCH_BAND;
  const rules = options.rules ?? defaultStructuralRules;
  const failOn = options.failOn ?? 'error';

  // ── built-in precondition: duplicate names ──
  const structural: StructuralFinding[] = [];
  const seen = new Set<string>();
  const unique: CatalogTool[] = [];
  for (const tool of tools) {
    if (seen.has(tool.name)) {
      structural.push({
        rule: 'duplicate-name',
        tool: tool.name,
        severity: 'error',
        message: 'two tools share this name — the model cannot address them distinctly',
      });
    } else {
      seen.add(tool.name);
      unique.push(tool);
    }
  }

  // ── structural rule pack ──
  for (const tool of unique) {
    for (const rule of rules) {
      structural.push(...rule.check(tool, unique));
    }
  }

  // ── pairwise confusability (embedder-gated) ──
  let ranked: readonly SimilarityPair[] = [];
  const confusable: ConfusablePairFinding[] = [];
  const watch: ConfusablePairFinding[] = [];
  const analyzed = options.embedder !== undefined && unique.length >= 2;
  if (options.embedder !== undefined && unique.length >= 2) {
    const byName = new Map(unique.map((tool) => [tool.name, tool]));
    const result = await pairwiseSimilarity({
      items: unique.map((tool) => ({ id: tool.name, text: confusabilityText(tool) })),
      embedder: options.embedder,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    ranked = result.pairs;
    for (const pair of result.pairs) {
      if (pair.similarity >= confusabilityThreshold) {
        confusable.push({
          kind: 'confusable',
          a: pair.a,
          b: pair.b,
          similarity: pair.similarity,
          // byName lookups are safe: pair ids come from `unique` itself.
          hint: differentiationHint(
            byName.get(pair.a) as CatalogTool,
            byName.get(pair.b) as CatalogTool,
          ),
        });
      } else if (pair.similarity >= confusabilityThreshold - watchBand) {
        watch.push({
          kind: 'watch',
          a: pair.a,
          b: pair.b,
          similarity: pair.similarity,
          hint: differentiationHint(
            byName.get(pair.a) as CatalogTool,
            byName.get(pair.b) as CatalogTool,
          ),
        });
      }
    }
  }

  const errors = structural.filter((f) => f.severity === 'error').length;
  const warnings = structural.length - errors;
  const gateFailures = failOn === 'warn' ? structural.length : errors;

  return {
    ok: confusable.length === 0 && gateFailures === 0,
    toolCount: tools.length,
    similarity: {
      analyzed,
      confusable,
      watch,
      ranked,
      thresholds: { confusabilityThreshold, watchBand },
    },
    structural,
    summary: { confusable: confusable.length, watch: watch.length, errors, warnings },
  };
}

// ── differentiating-axis hint (heuristic, honest) ────────────────────

const STOPWORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'by',
  'for',
  'from',
  'get',
  'in',
  'into',
  'is',
  'its',
  'of',
  'on',
  'or',
  'the',
  'to',
  'which',
  'with',
]);

function nameTokens(name: string): string[] {
  return name
    .replace(/[_-]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
}

function descriptionTokens(tool: CatalogTool): Set<string> {
  return new Set(
    (tool.description ?? '')
      .toLowerCase()
      .split(/[^a-z0-9_]+/)
      .filter((t) => t.length >= 3 && !STOPWORDS.has(t)),
  );
}

/**
 * Suggest the DIFFERENTIATING AXIS for a flagged pair. Heuristic: when
 * the names are near-twins (≤2 distinct tokens), the qualifier IS the
 * axis — the descriptions must say when to choose each variant. When the
 * names differ, surface the few description terms each tool does NOT
 * share, as the place to anchor an explicit choice condition.
 */
export function differentiationHint(a: CatalogTool, b: CatalogTool): string {
  const aTokens = nameTokens(a.name);
  const bTokens = nameTokens(b.name);
  const aOnly = aTokens.filter((t) => !bTokens.includes(t));
  const bOnly = bTokens.filter((t) => !aTokens.includes(t));
  const shared = aTokens.filter((t) => bTokens.includes(t));

  if (shared.length >= 2 && aOnly.length + bOnly.length <= 2) {
    const diff =
      [...aOnly, ...bOnly].map((t) => `'${t}'`).join(' vs ') || 'nothing — the names match';
    return (
      `names differ only by ${diff} — make the descriptions say WHEN to choose each ` +
      `(different backend/data source? live vs historical? freshness?), ` +
      `e.g. "Use for …; prefer ${b.name} when …"`
    );
  }

  const aDesc = descriptionTokens(a);
  const bDesc = descriptionTokens(b);
  const aDistinct = [...aDesc].filter((t) => !bDesc.has(t)).slice(0, 3);
  const bDistinct = [...bDesc].filter((t) => !aDesc.has(t)).slice(0, 3);
  if (aDistinct.length === 0 && bDistinct.length === 0) {
    return `the descriptions are near-duplicates — rewrite one to state when it, and not ${b.name}, is the right call`;
  }
  return (
    `descriptions overlap heavily; the distinct terms are ` +
    `${a.name}: [${aDistinct.join(', ')}] vs ${b.name}: [${bDistinct.join(', ')}] — ` +
    `lead with an explicit choice condition ("use when …") built on those`
  );
}
