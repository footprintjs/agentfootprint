import type { Coverage } from '../../semantics/coverage/types.js';
import type { DeclaredPeriod } from '../../semantics/coverage/period.js';
import type { ToolResultStatus } from '../../semantics/toolOutcome.js';
import type { ArtifactRef, ArtifactOrigin } from '../types.js';

/** Exact producer-owned identity. Values are never normalized or extracted from prose. */
export interface SourceEvidenceSubject {
  readonly kind: string;
  readonly value: string;
}
export type SourceEvidenceScalar = string | number | boolean | null;
export type SourceEvidenceScope = Readonly<Record<string, SourceEvidenceScalar>>;

/** One already-published dataset, associated with the observed native source call. */
export interface SourceEvidenceDataset {
  readonly key: string;
  readonly ref: ArtifactRef;
  readonly kind: string;
  readonly digest?: string;
  /** Explicit producer-authorized fields; aliases retain their declared JSON paths. */
  readonly fields?: Readonly<Record<string, readonly string[]>>;
}

/** A trusted producer's exact association over its final governed payload. */
export interface SourceEvidenceDeclaration {
  readonly subject: SourceEvidenceSubject;
  readonly operation: string;
  readonly scope: SourceEvidenceScope;
  readonly scalars?: Readonly<Record<string, SourceEvidenceScalar>>;
  readonly datasets?: readonly SourceEvidenceDataset[];
}

/** Historical source facts. Status, coverage and period are stamped by native delivery. */
export interface SourceEvidenceProjection extends SourceEvidenceDeclaration {
  readonly status?: ToolResultStatus;
  readonly coverage?: Coverage;
  readonly period?: DeclaredPeriod;
}

/** Native authority is membership in the admitted checkpoint index, never this shape or kind. */
export interface SourceEvidenceCandidate extends SourceEvidenceProjection {
  readonly ref: ArtifactRef;
  readonly producer: { readonly name: string; readonly source?: string };
  /** Retention time stamped by the artifact store; never source collection time. */
  readonly recordedAt: number;
  readonly origin?: ArtifactOrigin;
}

/** Small native continuation carrier; payloads stay in the existing artifact store. */
export interface SourceEvidenceIndex {
  readonly version: 1;
  readonly refs: readonly ArtifactRef[];
  readonly omitted: number;
}

/** Bound every native write, scan and response. These limits never enlarge store retention. */
export interface SourceEvidenceLimits {
  readonly maxReceipts?: number;
  readonly maxReceiptBytes?: number;
  readonly maxScanned?: number;
  readonly maxResponseBytes?: number;
  /** Maximum wait for one retention/discovery/read operation, including host callbacks. */
  readonly timeoutMs?: number;
}

export interface SourceEvidenceFindArgs {
  readonly subject: SourceEvidenceSubject;
  readonly operation?: string;
  /** When supplied, the entire declared scope must match, not an inferred subset. */
  readonly scope?: SourceEvidenceScope;
  readonly cursor?: string;
  readonly limit?: number;
}
export interface SourceEvidenceReadArgs {
  readonly ref: ArtifactRef;
  readonly dataset?: string;
  readonly path?: string;
  readonly offset?: number;
  readonly limit?: number;
}

/** Static permission to read selected fields from a governed native publication at capture. */
export interface SourceEvidenceDatasetDeclaration {
  readonly key: string;
  readonly refPath: readonly string[];
  readonly kind: string;
  readonly fields: Readonly<Record<string, readonly string[]>>;
  readonly maxBytes?: number;
  readonly maxRows?: number;
}
export interface SourceEvidenceSource {
  readonly ref: ArtifactRef;
  readonly rows: readonly Readonly<Record<string, unknown>>[];
  /** All rows of the retained artifact were read; never source/query completeness. */
  readonly complete: boolean;
}
