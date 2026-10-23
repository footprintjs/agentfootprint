/**
 * search/events — what a `search` tool's composed coverage puts on an EVENT.
 *
 * Pattern: one pure projection, read by the dispatch funnel for
 *          `tools.absent` and `tools.coverage_declared`.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A (it shapes the payload; the funnel emits).
 *
 * Composed VALUES ride no event, in any mode. Events reach exporters, sinks
 * and browsers that the run's redaction policy does not govern the way it
 * governs the committed row, so a value the call sent — or a default, a
 * host-filled identity, a result-declared instant — rides as a REFERENCE
 * `{ resultId, argument }` to the row that holds it. What does ride:
 *
 *   • `checked` — the declaration's constants only (the declared source and
 *     the fixed qualifiers), as `{ what }`;
 *   • `notChecked` / `cannotCover` — the plain gap lists, whose words name
 *     arguments and verdicts, never a value;
 *   • `composition` — origin, the row's address, `complete`, the facet
 *     references and the typed gaps.
 *
 * `lookedFor` is the tool's own words: today's bytes while `.negativeClaims()`
 * is unarmed, and a reference to the row's field under the arm.
 */

import type {
  CoverageCompositionPayload,
  CoverageFacetReferencePayload,
  CoverageFieldReference,
  CoverageGapPayload,
  CoverageItemPayload,
} from '../../../events/payloads.js';
import type { ComposedItem, CoverageGap } from '../composedCoverage.js';
import type { CoverageFacts } from '../read.js';
import type { CoverageItem } from '../types.js';

/** The payload fields a composed statement contributes. */
export interface ComposedEventFields {
  readonly checked: readonly CoverageItemPayload[];
  readonly notChecked: readonly CoverageItemPayload[];
  readonly cannotCover: readonly CoverageItemPayload[];
  readonly composition: CoverageCompositionPayload;
  readonly lookedFor?: string;
  readonly lookedForRef?: CoverageFieldReference;
}

/** Whether an item's `what` is the declaration's own words (no value of the call's). */
const isConstant = (item: ComposedItem): boolean => item.from === 'tool' || item.from === 'fixed';

function plainCopy(item: CoverageItem): CoverageItemPayload {
  return {
    what: item.what,
    ...(item.why !== undefined && { why: item.why }),
    ...(item.short !== undefined && { short: item.short }),
    ...(item.kind !== undefined && { kind: item.kind }),
  };
}

function gapCopy(gap: CoverageGap): CoverageGapPayload {
  const bears = gap.bears;
  return {
    kind: gap.kind,
    what: gap.what,
    ...(gap.why !== undefined && { why: gap.why }),
    ...(bears !== undefined && {
      bears:
        typeof bears === 'string'
          ? bears
          : {
              filter: bears.filter,
              ...(bears.values !== undefined && { values: [...bears.values] }),
            },
    }),
    ...(gap.argument !== undefined && { argument: gap.argument }),
  };
}

/** One reference per facet, argument and origin — a list population is one reference. */
function references(
  items: readonly ComposedItem[],
  resultId: string,
): readonly CoverageFacetReferencePayload[] {
  const out: CoverageFacetReferencePayload[] = [];
  const seen = new Set<string>();
  for (const item of items) {
    if (isConstant(item)) continue;
    const key = `${item.facet}\u0000${item.from}\u0000${item.argument ?? ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      facet: item.facet,
      from: item.from as CoverageFacetReferencePayload['from'],
      ref: { resultId, ...(item.argument !== undefined && { argument: item.argument }) },
      ...(item.any === true && { any: true as const }),
    });
  }
  return out;
}

/**
 * The event fields of one composed statement. `facts` must carry `composed`
 * (the funnel asks only for those).
 */
export function composedEventFields(
  facts: CoverageFacts,
  opts: { readonly armed: boolean },
): ComposedEventFields {
  const composed = facts.composed;
  if (composed === undefined) throw new TypeError('composedEventFields: not a composed statement');
  const items = facts.coverage.checked as readonly ComposedItem[];
  const lookedFor =
    facts.lookedFor === undefined
      ? {}
      : opts.armed
      ? { lookedForRef: { resultId: composed.resultId, field: 'lookedFor' as const } }
      : { lookedFor: facts.lookedFor };
  return {
    checked: items.filter(isConstant).map((i) => ({ what: i.what })),
    notChecked: facts.coverage.notChecked.map(plainCopy),
    cannotCover: facts.coverage.cannotCover.map(plainCopy),
    composition: {
      origin: composed.origin,
      resultId: composed.resultId,
      complete: composed.complete,
      facets: references(items, composed.resultId),
      gaps: composed.gaps.map(gapCopy),
    },
    ...lookedFor,
  };
}
