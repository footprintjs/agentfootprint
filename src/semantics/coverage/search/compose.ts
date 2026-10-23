/**
 * search/compose — ONE call's coverage, composed by the library from the
 * tool's `search` declaration and the arguments the call ran with.
 *
 * Pattern: linear composition of small pure rules —
 *          door (what came back) → inEffect (each argument) → facets
 *          (`checked`) → gaps → complete → the reading the funnel files.
 * Role:    semantics/ layer, pure. Called by the dispatch funnel
 *          (`../../../core/agent/stages/searchCoverage.ts` · `buildSearchCoverage`) at
 *          every execute boundary, before `declareCoverage`.
 * Emits:   N/A (the funnel emits, from the reading).
 *
 * ## Composition can only under-claim
 *
 * A facet enters `checked` from exactly four places — a value the call sent, a
 * declared default composed as if sent, a declared fixed qualifier, the
 * declared (or sent) source — plus a host-filled identity filter (which only
 * narrows) and a result-declared period (which only narrows). Every
 * classified argument none of them covers is a bearing gap; a cap in effect,
 * a declared server cap, a page, a `partial` outcome is a completeness gap
 * unless the result says otherwise. So the composed scope is never wider than
 * what the declaration and the arguments say. A wrong declaration is the
 * trusted base, said out loud.
 *
 * ## Local and remote
 *
 * A `search` that arrived over MCP or from a `ToolProvider` composes the same
 * shape, marked `'remote'`, and is never `complete`: it establishes nothing.
 */

import type { PeriodShapes } from '../../../time/periodForm.js';
import type { ToolResultStatus } from '../../toolOutcome.js';
import type { ComposedItem } from '../composedCoverage.js';
import { readCoverageResult, type CoverageFacts, type CoverageReading } from '../read.js';
import { readSearchDoor, type DoorFacts } from './door.js';
import { composeChecked } from './facets.js';
import { blocksComplete, composeGaps } from './gaps.js';
import { readArgument, type HostFilledArguments } from './inEffect.js';
import { servedAbsence, servedLedger } from './served.js';
import type { ToolSearch } from './types.js';

/** One call of a search tool, as the funnel knows it. */
export interface SearchCall {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  /** The row's address — `claim-result/<namespace>/<runId>/<ordinal>`, minted by the funnel. */
  readonly resultId: string;
  readonly search: ToolSearch;
  /** `'remote'` for a declaration that arrived over MCP or from a `ToolProvider`. */
  readonly origin: 'local' | 'remote';
  /** The arguments the tool ran with — after the inputs layer's fill and any before-tool rewrite. */
  readonly args: Readonly<Record<string, unknown>>;
  /** Arguments `hostFilled` fills inside `execute`, from its own declaration. */
  readonly hostFilled?: HostFilledArguments;
  /** The tool's `period`, for resolving a relative window. */
  readonly period?: PeriodShapes;
  /** The TURN's clock (an ISO instant), injected so one spelling is one span per turn. */
  readonly turnNow?: string;
  /** The outcome the tool declared on its effects envelope, if any. */
  readonly status?: ToolResultStatus;
}

/** What composition made of one result. */
export type SearchComposition =
  | {
      readonly outcome: 'composed';
      /** What the model is served: the composed absence, or the value as returned. */
      readonly value: unknown;
      readonly reading: CoverageReading;
    }
  /** The result hand-wrote `checked` beside the declaration: filed as written, composed never. */
  | { readonly outcome: 'declined'; readonly code: 'checked-beside-declared' };

/** The facts the reader files for a door, before composition overrides its lists. */
function baseFacts(served: unknown, door: DoorFacts, toolName: string): CoverageFacts {
  const read = readCoverageResult(served, toolName)?.declared[0];
  if (read !== undefined) return read;
  return {
    kind: door.door === 'declared-absence' ? 'absence' : 'ledger',
    coverage: { checked: [], notChecked: [], cannotCover: [] },
    ...(door.period !== undefined && { period: door.period }),
  };
}

/**
 * Compose one call's coverage from its search, or `undefined` when the value
 * came through no door (plain data: nothing is composed, nothing changes).
 * THROWS a refusal (`refused: …`) for a `coverage()` wrapped around a
 * declared absence — at the execute boundary, that is the call's error.
 *
 * @example
 * ```ts
 * const out = composeSearchCoverage(call, absent({ what: 'x', checked: 'declared' }));
 * out?.outcome === 'composed' && out.reading.declared[0]?.composed?.complete;
 * ```
 */
export function composeSearchCoverage(
  call: SearchCall,
  result: unknown,
): SearchComposition | undefined {
  const door = readSearchDoor(result, call.toolName);
  if (door === undefined) return undefined;
  if (door.outcome === 'checked-beside-declared') {
    return { outcome: 'declined', code: 'checked-beside-declared' };
  }
  const facts = door.facts;
  const readings = call.search.arguments.map(
    (arg) => [arg, readArgument(arg, call.args, call.hostFilled)] as const,
  );
  const checked: readonly ComposedItem[] = composeChecked({
    search: call.search,
    readings,
    ...(facts.resolved !== undefined && { resolved: facts.resolved }),
    ...(facts.period !== undefined && { resultPeriod: facts.period }),
    ...(call.period !== undefined && { period: call.period }),
    ...(call.turnNow !== undefined && { turnNow: call.turnNow }),
  });
  const { gaps, notChecked, cannotCover } = composeGaps({
    search: call.search,
    readings,
    rows: facts.rows,
    ...(facts.paging !== undefined && { paging: facts.paging }),
    ...(facts.period !== undefined && { period: facts.period }),
    ...(call.status !== undefined && { status: call.status }),
    handNotChecked: facts.handNotChecked,
    handCannotCover: facts.handCannotCover,
  });
  const complete =
    call.origin === 'local' &&
    call.search.complete === 'within-arguments' &&
    !gaps.some(blocksComplete);
  const lists = { notChecked, cannotCover };
  const value =
    facts.absence !== undefined
      ? servedAbsence(facts.absence, checked, lists, complete)
      : facts.ledger !== undefined
      ? servedLedger(facts.ledger, checked, lists, complete)
      : result;
  const base = baseFacts(value, facts, call.toolName);
  const composedFacts: CoverageFacts = {
    ...base,
    coverage: { checked, notChecked, cannotCover },
    composed: {
      origin: call.origin,
      resultId: call.resultId,
      complete,
      gaps,
    },
  };
  return {
    outcome: 'composed',
    value,
    reading: {
      ...(facts.door === 'declared-absence' && { status: 'absent' as const }),
      declared: [composedFacts],
    },
  };
}
