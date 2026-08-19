/**
 * The semantic tool-result envelope + the `check:semantics` gate (9.53.0).
 *
 * The door: the main barrel publishes the AUTHORING half (`semantic()`, the
 * recognizer, the vocabulary) — what a tool author writes and what a
 * consumer reading raw results needs; `/observe` (via debug.ts) publishes
 * the GATE half (`checkSemantics`, the CLI core, the formatter) — beside
 * tool-lint, its pattern sibling. See README.md for the arguments.
 */

export {
  composeNotCovered,
  coverageOfSemantics,
  explainSemantics,
  isCounterLookingAggregation,
  readSemantics,
  semantic,
  semanticIssues,
  semanticsForModel,
  type SemanticIssue,
  type SemanticIssueCode,
} from './envelope.js';

export {
  checkSemantics,
  type SemanticsCatalogEntry,
  type SemanticsFinding,
  type SemanticsFindingCode,
  type SemanticsReport,
} from './check.js';

export { formatSemanticsReport } from './format.js';

export { coerceSemanticsCatalog, runCheckSemanticsCli, type SemanticsCliIO } from './cli.js';

export {
  COUNTER_AGGREGATION_WORDS,
  RESULT_CLASSES,
  SEMANTICS_MARKER,
  SEMANTICS_NOTE,
  type SemanticClarify,
  type SemanticCoverage,
  type SemanticDeclaration,
  type SemanticEdge,
  type SemanticFact,
  type SemanticGrain,
  type SemanticProvenance,
  type SemanticRender,
  type SemanticSeriesPoint,
  type ToolResultClass,
  type ToolSemantics,
} from './types.js';
