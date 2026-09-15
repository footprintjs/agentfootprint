/** Declared datasets -> scope-bound artifacts. No transport, row discovery or domain vocabulary. */
import type { Tool, ToolExecutionContext } from '../core/tools.js';
import type { ToolArtifactPutInput, ToolArtifacts } from './capability.js';
import type { ArtifactMeta } from './types.js';
import {
  projectionSemanticsIssues,
  snapshotProjectionSemantics,
} from '../lib/semantics/projection.js';

/** Producer-owned payloads. A source is an optional artifact, not an inferred fact. */
export interface DatasetArtifactInput {
  readonly key: string;
  readonly artifact: ToolArtifactPutInput;
  readonly source?: ToolArtifactPutInput;
}

/** A failed write or a ticket no longer held is never advertised as a stored payload. */
export type DatasetArtifactReceipt =
  | { readonly status: 'stored'; readonly meta: ArtifactMeta }
  | { readonly status: 'unavailable'; readonly reason: 'store-unavailable' | 'missing-or-expired' };

export interface DatasetPublication {
  readonly key: string;
  readonly artifact: DatasetArtifactReceipt;
  readonly source?: DatasetArtifactReceipt;
}

/** Projection owns field meanings, coverage envelopes and inline policy; receipts contain no rows. */
export interface DatasetResultPlan<TProjected = unknown> {
  readonly datasets: readonly DatasetArtifactInput[];
  project(publications: readonly DatasetPublication[]): TProjected | Promise<TProjected>;
}

export interface DatasetResultAdapter<
  TArgs = Record<string, unknown>,
  TResult = unknown,
  TProjected = unknown,
> {
  /** Undefined is an intentional pass-through (for example a declared absence). */
  describe(
    result: TResult,
    args: TArgs,
  ): DatasetResultPlan<TProjected> | undefined | Promise<DatasetResultPlan<TProjected> | undefined>;
}

/**
 * Adapt any local, HTTP-backed or MCP Tool using the SAME already-bound execution capability.
 * Claim-check: the host configures storage; the model carries tickets between tools. No UI required.
 * No store: pass through without calling the adapter; the host's normal result policy still applies.
 * Writes are independent, not a transaction. A failed source does not hide otherwise readable data;
 * its unavailable receipt must remain explicit in the producer's projection. Recheck tickets after
 * the batch because a later put can evict an earlier one. Expiry after publication remains possible.
 * This stages materialized payloads; it does not add remote handles, streaming or query pushdown.
 */
export function withDatasetArtifacts<TArgs, TResult, TProjected>(
  tool: Tool<TArgs, TResult>,
  adapter: DatasetResultAdapter<TArgs, TResult, TProjected>,
): Tool<TArgs, TResult | TProjected> {
  return {
    ...tool,
    async execute(args: TArgs, ctx: ToolExecutionContext) {
      const result = await tool.execute(args, ctx);
      if (!ctx.hasArtifacts) return result;
      const semantics = snapshotProjectionSemantics(result);
      const plan = await adapter.describe(result, args);
      if (plan === undefined) {
        const issues = projectionSemanticsIssues(semantics, result);
        if (issues.length) throw new Error(issues[0]!.message);
        return result;
      }
      if (!plan || typeof plan.project !== 'function') {
        throw new TypeError('A dataset result plan requires a project function.');
      }
      const projected = await plan.project(
        await stageDatasetArtifacts(plan.datasets, ctx.artifacts),
      );
      const issues = projectionSemanticsIssues(semantics, projected);
      if (issues.length) throw new Error(issues[0]!.message);
      return projected;
    },
  };
}

/** The same staging step for an existing tool pipeline that already owns execution and projection. */
export async function stageDatasetArtifacts(
  datasets: readonly DatasetArtifactInput[],
  artifacts: ToolArtifacts,
): Promise<readonly DatasetPublication[]> {
  assertInputs(datasets);
  const publications: DatasetPublication[] = [];
  for (const entry of datasets) {
    const source = entry.source ? await put(artifacts, entry.source) : undefined;
    const parentRefs =
      source?.status === 'stored'
        ? [...(entry.artifact.parentRefs ?? []), source.meta.ref]
        : entry.artifact.parentRefs;
    const artifact = await put(artifacts, { ...entry.artifact, ...(parentRefs && { parentRefs }) });
    publications.push({ key: entry.key, artifact, ...(source && { source }) });
  }
  const held: DatasetPublication[] = [];
  for (const publication of publications) {
    const artifact = await current(artifacts, publication.artifact);
    const source = publication.source ? await current(artifacts, publication.source) : undefined;
    held.push({ key: publication.key, artifact, ...(source && { source }) });
  }
  return held;
}

async function put(
  artifacts: ToolArtifacts,
  input: ToolArtifactPutInput,
): Promise<DatasetArtifactReceipt> {
  try {
    return { status: 'stored', meta: await artifacts.put(input) };
  } catch {
    // Store exceptions may contain connection strings. The existing artifact event records the refusal.
    return { status: 'unavailable', reason: 'store-unavailable' };
  }
}

async function current(
  artifacts: ToolArtifacts,
  receipt: DatasetArtifactReceipt,
): Promise<DatasetArtifactReceipt> {
  if (receipt.status !== 'stored') return receipt;
  try {
    const meta = await artifacts.head(receipt.meta.ref);
    return meta
      ? { status: 'stored', meta }
      : { status: 'unavailable', reason: 'missing-or-expired' };
  } catch {
    return { status: 'unavailable', reason: 'store-unavailable' };
  }
}

/** Validate declaration shape before any writes. Payload serialization and parent proofs belong to the store. */
function assertInputs(datasets: readonly DatasetArtifactInput[]): void {
  if (!Array.isArray(datasets)) {
    throw new TypeError('Dataset declarations must be an array.');
  }
  const keys = new Set<string>();
  for (const entry of datasets) {
    if (!entry || typeof entry.key !== 'string' || entry.key.trim() === '' || keys.has(entry.key)) {
      throw new TypeError('Dataset keys must be nonempty and unique within one result.');
    }
    keys.add(entry.key);
    for (const input of [entry.artifact, ...(entry.source === undefined ? [] : [entry.source])]) {
      if (
        !input ||
        typeof input !== 'object' ||
        Array.isArray(input) ||
        typeof input.kind !== 'string' ||
        !input.kind.trim() ||
        typeof input.mediaType !== 'string' ||
        !input.mediaType.trim() ||
        !Object.prototype.hasOwnProperty.call(input, 'data')
      ) {
        throw new TypeError('Each dataset/source artifact requires kind, mediaType and data.');
      }
      if (input.parentRefs !== undefined) {
        if (!Array.isArray(input.parentRefs)) {
          throw new TypeError('Dataset/source parentRefs must be an array of strings.');
        }
        for (const ref of input.parentRefs) {
          if (typeof ref !== 'string') {
            throw new TypeError('Dataset/source parentRefs must be an array of strings.');
          }
        }
      }
    }
  }
}
