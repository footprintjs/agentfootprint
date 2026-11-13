import type {
  PagingDeclaration,
  ResolvedDeclaration,
} from '../../../../semantics/coverage/search/resultFacts.js';
import type { PeriodOnWire } from '../../../../semantics/coverage/period.js';
import type {
  SemanticClarify,
  SemanticCoverage,
  SemanticEdge,
  SemanticFact,
  SemanticGrain,
  SemanticProvenance,
  SemanticRender,
  SemanticSeriesPoint,
  ToolSemantics,
} from '../../../../semantics/types.js';
import { bool, charsMarker, listOf, nullOr, num, shapeOf, str } from '../../auditBounding.js';
import { boundCoverageItem, boundHeld, boundInstants } from './coverage.js';

/** What a tool returned, as `describedResult()` declared it: the data is content;
 *  its kinds, field and column names, counts and the library's static note stay. */
export const boundSemantics = shapeOf<ToolSemantics>({
  af_semantics: bool,
  series: listOf(
    shapeOf<SemanticSeriesPoint>({
      t: charsMarker,
      entity: charsMarker,
      metric: str,
      value: charsMarker,
    }),
  ),
  // An open record: `entity` and every other value is the data; the keys stay.
  facts: listOf(shapeOf<SemanticFact>({ entity: charsMarker })),
  edges: listOf(shapeOf<SemanticEdge>({ from: charsMarker, to: charsMarker, kind: str })),
  grain: shapeOf<SemanticGrain>({
    interval: str,
    aggregation: str,
    is_counter: bool,
    collapsed: charsMarker,
  }),
  provenance: shapeOf<SemanticProvenance>({
    measured_at: charsMarker,
    age_seconds: num,
    source: charsMarker,
    source_export_date: charsMarker,
  }),
  period: shapeOf<PeriodOnWire>({ queried: boundInstants, held: boundHeld, read_at: charsMarker }),
  resolved: listOf(
    shapeOf<ResolvedDeclaration>({
      argument: str,
      id: charsMarker,
      name: charsMarker,
      aliases: listOf(charsMarker),
    }),
  ),
  // `null` says there is no next page; a cursor or page number is a value.
  paging: shapeOf<PagingDeclaration>({ next: nullOr(charsMarker) }),
  coverage: shapeOf<SemanticCoverage>({
    checked: listOf(boundCoverageItem),
    not_checked: listOf(boundCoverageItem),
    cannot_cover: listOf(boundCoverageItem),
  }),
  not_covered: listOf(charsMarker),
  clarify: nullOr(
    shapeOf<SemanticClarify>({ question: charsMarker, candidates: listOf(charsMarker) }),
  ),
  render: shapeOf<SemanticRender>({
    default: str,
    columns: listOf(str),
    sort: str,
    filter_note: charsMarker,
    chart_hint: charsMarker,
  }),
  // "The static sentence. Never interpolated."
  note: str,
});
