import type { ToolSemantics } from './dependencyTypes.js';
import type { CoverageCompositionPayload, PeriodPayload } from './toolEffects.js';

export interface ToolCoverageDeclaredPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly checked?: readonly CoverageItemPayload[];
  readonly notChecked?: readonly CoverageItemPayload[];
  readonly cannotCover?: readonly CoverageItemPayload[];
  /**
   * What the read behind the value covered in time (honesty step 7b) — a
   * `coverage()`'s `period`, or a described result's (whose boundary this
   * event carries). Default-omitted.
   */
  readonly period?: PeriodPayload;
  /**
   * What a `coverage()`'s read found still running — its outcome not known
   * yet — as the tool declared it (a copy). Default-omitted: present only when
   * the ledger declared a well-formed, non-empty `in_progress`.
   */
  readonly inProgress?: readonly InProgressItemPayload[];
  /** What the library composed for a `search` tool — see {@link ToolAbsentPayload.composition}. */
  readonly composition?: CoverageCompositionPayload;
}

/** One thing a read found still running, as it rides an event: detached plain
 *  data, copied out of the tool's own declaration. */
export interface InProgressItemPayload {
  readonly what: string;
  readonly why?: string;
  /** RECORD-ONLY short form — the model was served the envelope without it. */
  readonly short?: string;
  /** How many things this entry stands for; absent = one. Served. */
  readonly count?: number;
}

/** One piece of declared ground, as it rides an event: detached plain data,
 *  copied out of the tool's own declaration. */
export interface CoverageItemPayload {
  readonly what: string;
  readonly why?: string;
  /** The item's short plain form, as the tool declared it — RECORD-ONLY: the
   *  model was served the envelope without it. Absent when not declared (or
   *  declared invalid by an envelope minted outside `absent()` / `coverage()`,
   *  which is read, never repaired). */
  readonly short?: string;
  /** What kind of ground the item is (`'existence' | 'scope'`), on
   *  `notChecked` / `cannotCover` only — RECORD-ONLY, like `short`. Absent =
   *  not declared; never inferred from `what`. */
  readonly kind?: 'existence' | 'scope';
}

/**
 * A tool returned a semantic envelope (`describedResult(…)`) — typed
 * series/facts/edges with the caveats that make them honest (grain,
 * provenance, coverage) as data.
 *
 * The event carries the FULL envelope — render hints, the three-list
 * coverage detail, the marker, everything — because this is the channel
 * recordings and UIs read; the MODEL received only the compact
 * rendering-free projection (`semanticsForModel`). Emitted BEFORE the
 * result ceiling is measured, so grain and provenance survive to the record
 * even when the content itself was refused as oversized. Detached plain
 * data (structuredClone), never a live reference into the tool's own value.
 */
export interface ToolSemanticsDeclaredPayload {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly iteration: number;
  readonly semantics: ToolSemantics;
}
