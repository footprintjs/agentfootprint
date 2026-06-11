/**
 * tool-lint — the tool-catalog confusability lint (RFC-002 tier 1,
 * blocks C1–C3).
 *
 * Build-time, CI-gateable, framework-agnostic: a plain
 * `{ name, description?, inputSchema? }[]` in (any OpenAI / Anthropic /
 * LangChain / MCP tool list coerces to it), a report with a CI-gateable
 * `ok` out. The embedding geometry comes from influence-core
 * (`pairwiseSimilarity`); this module is the policy layer — thresholds,
 * verdicts, hints, and the pluggable structural rule pack.
 *
 * Surfaces:
 *   - `analyzeToolCatalog(tools, opts)` — the API (C1)
 *   - `defaultStructuralRules` + rule factories — the rule pack (C2)
 *   - `runToolLintCli` / bin `agentfootprint-lint-tools` — the gate (C3)
 *
 * Front-door guide: docs/guides/tool-catalog-lint.md
 */

export type {
  AnalyzeToolCatalogOptions,
  CatalogTool,
  ConfusablePairFinding,
  LintRule,
  LintSeverity,
  PairVerdict,
  SimilarityReport,
  StructuralFinding,
  ToolCatalogReport,
} from './types.js';

export {
  analyzeToolCatalog,
  catalogFromTools,
  confusabilityText,
  differentiationHint,
  DEFAULT_CONFUSABILITY_THRESHOLD,
  DEFAULT_WATCH_BAND,
  MOCK_EMBEDDER_CALIBRATION,
} from './analyze.js';

export {
  defaultStructuralRules,
  descriptionRule,
  enumInProseRule,
  optionalParamRule,
  saysWhatNotWhenRule,
  DEFAULT_OMISSION_CUES,
  DEFAULT_WHEN_CUES,
  type DescriptionRuleOptions,
  type OptionalParamRuleOptions,
  type SaysWhatNotWhenRuleOptions,
} from './rules.js';

export { formatToolCatalogReport, type FormatReportOptions } from './format.js';

export { coerceCatalog, runToolLintCli, type ToolLintCliIO } from './cli.js';
