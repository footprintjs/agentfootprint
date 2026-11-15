import type { Tool, ToolExecutionContext } from './tools.js';
import { ownData } from '../lib/boundedJson.js';
import { sourceDatasetDeclarations } from '../artifacts/sourceEvidence/datasets.js';
import { sourceEvidenceLimits } from '../artifacts/sourceEvidence/guards.js';
import type {
  SourceEvidenceCandidate,
  SourceEvidenceDeclaration,
  SourceEvidenceDatasetDeclaration,
  SourceEvidenceLimits,
  SourceEvidenceProjection,
  SourceEvidenceSource,
} from '../artifacts/sourceEvidence/types.js';

/** Producer metadata only. It is consulted by native final delivery, never by execute. */
export interface SourceEvidenceDescriptor<TServed = unknown> {
  readonly datasets?: readonly SourceEvidenceDatasetDeclaration[];
  /** Receives a detached final model payload and only explicitly authorized stored fields. */
  readonly describe: (
    served: TServed,
    sources: Readonly<Record<string, SourceEvidenceSource>>,
  ) =>
    | readonly SourceEvidenceDeclaration[]
    | undefined
    | Promise<readonly SourceEvidenceDeclaration[] | undefined>;
}

/** An explicit native mount. The host must re-authorize every discovery and read. */
export interface SourceEvidenceOptions {
  /** Return an exact permitted subset, or undefined. No source query or refresh occurs. */
  readonly admit: (
    candidate: SourceEvidenceCandidate,
    context: ToolExecutionContext,
  ) => SourceEvidenceProjection | undefined | Promise<SourceEvidenceProjection | undefined>;
  readonly limits?: SourceEvidenceLimits;
  /** Opt in to metadata-only discovery during native turn preparation. */
  readonly preparation?: {
    /** Fresh source-scope/privacy admission; no tool execution context is fabricated. */
    readonly admit: (
      candidate: SourceEvidenceMetadata,
      context: SourceEvidencePreparationContext,
    ) => SourceEvidenceMetadata | undefined | Promise<SourceEvidenceMetadata | undefined>;
  };
}

/** Native preparation is not a tool call and grants no dispatch or artifact capability. */
export type SourceEvidencePreparationContext = Readonly<
  Pick<ToolExecutionContext, 'identity' | 'signal' | 'redact'>
>;
/** Historical metadata only; retained values and dataset navigation are deliberately absent. */
export type SourceEvidenceMetadata = Omit<SourceEvidenceCandidate, 'scalars' | 'datasets'>;
export interface SourceEvidenceRecentArgs {
  readonly cursor?: string;
  readonly limit?: number;
}
export type SourceEvidenceRecentResult =
  | { readonly historical: true; readonly unavailable: true }
  | {
      readonly historical: true;
      readonly candidates: readonly SourceEvidenceMetadata[];
      readonly shown: number;
      readonly complete: boolean;
      readonly nextCursor?: string;
    };
/** Live before proceed only. An unavailable or revoked reader never falls back to raw storage. */
export interface SourceEvidencePreparation {
  recent(args?: SourceEvidenceRecentArgs): Promise<SourceEvidenceRecentResult>;
}

/** @internal One detached native mount; dynamic authorization is still called per read. */
export interface ResolvedSourceEvidenceOptions {
  readonly admit: SourceEvidenceOptions['admit'];
  readonly limits: Readonly<Required<SourceEvidenceLimits>>;
  readonly preparation?: SourceEvidenceOptions['preparation'];
}

/** @internal Validate configuration before any run or artifact operation. */
export function resolveSourceEvidenceOptions(
  input: SourceEvidenceOptions,
): ResolvedSourceEvidenceOptions {
  const data = ownData(input, ['admit', 'limits', 'preparation']);
  if (typeof data.admit !== 'function')
    throw new TypeError('Source evidence requires fresh host admission.');
  const preparation =
    data.preparation === undefined ? undefined : ownData(data.preparation, ['admit']);
  if (preparation !== undefined && typeof preparation.admit !== 'function')
    throw new TypeError('Source metadata preparation requires fresh host admission.');
  return Object.freeze({
    admit: data.admit as SourceEvidenceOptions['admit'],
    limits: sourceEvidenceLimits(data.limits as SourceEvidenceLimits | undefined),
    ...(preparation !== undefined && {
      preparation: Object.freeze({
        admit: preparation.admit as NonNullable<SourceEvidenceOptions['preparation']>['admit'],
      }),
    }),
  });
}

const declaration = Symbol('agentfootprint.sourceEvidence');

/**
 * Declare an exact historical source association without wrapping tool execution.
 * Only an opted-in native Agent can retain a governed observation. Direct execute,
 * model-authored JSON and application artifacts cannot append its trusted index.
 */
export function withSourceEvidence<TArgs, TResult>(
  tool: Tool<TArgs, TResult>,
  descriptor: SourceEvidenceDescriptor<TResult>,
): Tool<TArgs, TResult> {
  const data = ownData(descriptor, ['describe', 'datasets']);
  if (typeof data.describe !== 'function')
    throw new TypeError('Source evidence requires a producer describe function.');
  const metadata = Object.freeze({
    describe: data.describe,
    ...(data.datasets !== undefined && { datasets: sourceDatasetDeclarations(data.datasets) }),
  });
  return { ...tool, [declaration]: metadata } as Tool<TArgs, TResult>;
}

/** @internal Native finalization reads declaration metadata; this is not a publication door. */
export function sourceEvidenceDescriptor(
  tool: Tool | undefined,
): SourceEvidenceDescriptor | undefined {
  if (!tool) return undefined;
  return (tool as Tool & { [declaration]?: SourceEvidenceDescriptor })[declaration];
}
