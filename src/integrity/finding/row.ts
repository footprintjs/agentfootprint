/**
 * The committed row one filed finding leaves on the findings ledger, so the
 * answer's standing can read it (`core/agent/assessment/integrityReasons.ts`).
 *
 * Pattern: Map. One builder, a closed set of fields. Pure.
 * Role:    a `ContextError` holds values: its `message` and `witnesses` quote
 *          the arguments and the rows it is about, and a `predicate` names an
 *          argument path or a column. The event channel carries those. The row
 *          carries none of them: the kind, the seam, the iteration, the softer
 *          class, and the names of the tools among its subjects. A value cannot
 *          reach the record through a field that does not exist.
 */

import type { IntegritySeam } from '../disposition/types.js';
import type { ContextError, ContextErrorKind } from './types.js';

/** Tool names one row keeps. Past it the row is still a witness; `tools` is only where to look. */
const MAX_ROW_TOOLS = 32;
/** A subject longer than this is no registered tool name, so it is left off, never shortened. */
const MAX_TOOL_NAME_CHARS = 256;

export interface IntegrityFindingRow {
  readonly kind: 'integrity-finding';
  /** The conversation turn; the one writer stamps it when the row is filed. */
  readonly turn?: number;
  readonly iteration: number;
  readonly finding: ContextErrorKind;
  readonly seam: IntegritySeam;
  /** The tools among the finding's subjects, by registered name. */
  readonly tools?: readonly string[];
  /** Copied from the finding: it reports doubt rather than contradiction. */
  readonly advisory?: true;
}

/**
 * The row for one finding, as filed.
 *
 * @example
 * ```ts
 * integrityFindingRowOf(finding, 3);
 * // { kind: 'integrity-finding', iteration: 3, finding: 'missing-column', seam: 'write', tools: ['list_ports'] }
 * ```
 */
export function integrityFindingRowOf(f: ContextError, iteration: number): IntegrityFindingRow {
  const tools = f.subjects
    .filter((s) => s.kind === 'tool' && s.id.length <= MAX_TOOL_NAME_CHARS)
    .map((s) => s.id)
    .slice(0, MAX_ROW_TOOLS);
  return {
    kind: 'integrity-finding',
    iteration,
    finding: f.kind,
    seam: f.seam,
    ...(tools.length > 0 && { tools }),
    ...(f.advisory === true && { advisory: true as const }),
  };
}
