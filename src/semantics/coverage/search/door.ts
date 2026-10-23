/**
 * search/door — which result door a search tool's value came through, and the
 * facts composition reads off it.
 *
 * Pattern: one pure reader over the three doors a tool returns through —
 *          `absent()`, `coverage()`, `describedResult()` — by their own
 *          recognizers. No fourth door.
 * Role:    semantics/ layer, pure.
 * Emits:   N/A.
 *
 * A search tool's coverage comes from its declaration, so a result that ALSO
 * hand-writes a `checked` list is declined (`checked-beside-declared`): the
 * library reads it as written, files today's row, and composes nothing — a
 * row it did not compose establishes nothing. A `coverage()` wrapped around
 * `absent({ checked: 'declared' })` is refused: the declaration is the
 * boundary, so the absence is returned on its own.
 */

import { readSemantics } from '../../envelope.js';
import type { ToolSemantics } from '../../types.js';
import { readItemExtras, type CoverageSection } from '../items.js';
import { readPeriod, unservedPeriod, type DeclaredPeriod } from '../period.js';
import {
  readAbsence,
  readCoverageLedger,
  readDeclaredAbsence,
  readDeclaredLedger,
} from '../recognize.js';
import { refusal } from '../refusal.js';
import type {
  CoverageItem,
  CoveredResult,
  DeclaredCoveredResult,
  DeclaredToolAbsence,
} from '../types.js';
import { valueText } from './facets.js';
import {
  readPaging,
  readResolved,
  type PagingDeclaration,
  type ResolvedDeclaration,
} from './resultFacts.js';

/** The facts one door carries, as composition reads them. */
export interface DoorFacts {
  readonly door: 'declared-absence' | 'declared-coverage' | 'described' | 'coverage';
  /** How many rows came back; `undefined` when they cannot be counted. */
  readonly rows: number | undefined;
  readonly resolved?: readonly ResolvedDeclaration[];
  readonly paging?: PagingDeclaration;
  readonly period?: DeclaredPeriod;
  readonly handNotChecked: readonly CoverageItem[];
  readonly handCannotCover: readonly CoverageItem[];
  /** The envelope to compose in place of — present for the two `'declared'` doors. */
  readonly absence?: DeclaredToolAbsence;
  readonly ledger?: DeclaredCoveredResult;
}

/** What a value is, to a search tool's composition. */
export type DoorReading =
  | { readonly outcome: 'door'; readonly facts: DoorFacts }
  | { readonly outcome: 'checked-beside-declared' };

const nonEmpty = (list: unknown): boolean => Array.isArray(list) && list.length > 0;

/** A hand-written list, read as found: every entry kept (a gap is never lost). */
function handList(list: unknown, section: CoverageSection, toolName: string): CoverageItem[] {
  if (!Array.isArray(list)) return [];
  return list.map((raw: unknown): CoverageItem => {
    const rec = raw as { readonly what?: unknown; readonly why?: unknown } | null;
    const what =
      typeof rec?.what === 'string' && rec.what.trim() !== '' ? rec.what : valueText(raw);
    return {
      what,
      ...(typeof rec?.why === 'string' && rec.why.trim() !== '' && { why: rec.why }),
      ...readItemExtras(raw, section, toolName),
    };
  });
}

function periodOf(wire: unknown): DeclaredPeriod | undefined {
  return readPeriod(unservedPeriod(wire)).period;
}

function semanticRows(sem: ToolSemantics): number {
  return (sem.facts?.length ?? 0) + (sem.series?.length ?? 0) + (sem.edges?.length ?? 0);
}

/** A `coverage()` around `absent({ checked: 'declared' })` declares a second boundary. */
function refuseWrappedAbsence(result: unknown): void {
  if (readDeclaredAbsence(result) === undefined) return;
  throw refusal(
    "absent({ checked: 'declared' }) is returned on its own — the tool's `search` is its " +
      'boundary, so a coverage() around it would declare a second one.',
  );
}

/**
 * Read `value` as one of the three doors, or `undefined` when it is none of
 * them (plain data: nothing is composed).
 */
export function readSearchDoor(value: unknown, toolName: string): DoorReading | undefined {
  const declared = readDeclaredAbsence(value);
  if (declared !== undefined) {
    return {
      outcome: 'door',
      facts: {
        door: 'declared-absence',
        rows: 0,
        resolved: readResolved(declared.resolved),
        paging: readPaging(declared.paging),
        period: periodOf(declared.period),
        handNotChecked: handList(declared.not_checked, 'notChecked', toolName),
        handCannotCover: handList(declared.cannot_cover, 'cannotCover', toolName),
        absence: declared,
      },
    };
  }
  if (readAbsence(value) !== undefined) return { outcome: 'checked-beside-declared' };
  const sem = readSemantics(value);
  if (sem !== undefined) {
    if (nonEmpty(sem.coverage?.checked)) return { outcome: 'checked-beside-declared' };
    return {
      outcome: 'door',
      facts: {
        door: 'described',
        rows: semanticRows(sem),
        resolved: readResolved(sem.resolved),
        paging: readPaging(sem.paging),
        period: periodOf(sem.period),
        handNotChecked: handList(sem.coverage?.not_checked, 'notChecked', toolName),
        handCannotCover: handList(sem.coverage?.cannot_cover, 'cannotCover', toolName),
      },
    };
  }
  const declaredLedger = readDeclaredLedger(value);
  if (declaredLedger !== undefined) {
    refuseWrappedAbsence(declaredLedger.result);
    if (readAbsence(declaredLedger.result) !== undefined) {
      return { outcome: 'checked-beside-declared' };
    }
    const marker = declaredLedger.af_coverage;
    return {
      outcome: 'door',
      facts: {
        door: 'declared-coverage',
        rows: Array.isArray(declaredLedger.result) ? declaredLedger.result.length : undefined,
        period: periodOf(marker.period),
        handNotChecked: handList(marker.not_checked, 'notChecked', toolName),
        handCannotCover: handList(marker.cannot_cover, 'cannotCover', toolName),
        ledger: declaredLedger,
      },
    };
  }
  const covered: CoveredResult | undefined = readCoverageLedger(value);
  if (covered === undefined) return undefined;
  refuseWrappedAbsence(covered.result);
  if (nonEmpty(covered.af_coverage.checked) || readAbsence(covered.result) !== undefined) {
    return { outcome: 'checked-beside-declared' };
  }
  return {
    outcome: 'door',
    facts: {
      door: 'coverage',
      rows: Array.isArray(covered.result) ? covered.result.length : undefined,
      period: periodOf(covered.af_coverage.period),
      handNotChecked: handList(covered.af_coverage.not_checked, 'notChecked', toolName),
      handCannotCover: handList(covered.af_coverage.cannot_cover, 'cannotCover', toolName),
    },
  };
}
