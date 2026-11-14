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
}

/** @internal One detached native mount; dynamic authorization is still called per read. */
export interface ResolvedSourceEvidenceOptions {
  readonly admit: SourceEvidenceOptions['admit'];
  readonly limits: Readonly<Required<SourceEvidenceLimits>>;
}

/** @internal Validate configuration before any run or artifact operation. */
export function resolveSourceEvidenceOptions(
  input: SourceEvidenceOptions,
): ResolvedSourceEvidenceOptions {
  const data = ownData(input, ['admit', 'limits']);
  if (typeof data.admit !== 'function')
    throw new TypeError('Source evidence requires fresh host admission.');
  return Object.freeze({
    admit: data.admit as SourceEvidenceOptions['admit'],
    limits: sourceEvidenceLimits(data.limits as SourceEvidenceLimits | undefined),
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
