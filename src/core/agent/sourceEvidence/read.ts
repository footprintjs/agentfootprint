import { copyJson, ownData, jsonBytes } from '../../../lib/boundedJson.js';
import { throwIfAborted, untilAborted } from '../../../lib/abort.js';
import { isArtifactRef } from '../../../artifacts/naming.js';
import type { ToolArtifacts } from '../../../artifacts/capability.js';
import {
  SOURCE_EVIDENCE_KIND,
  sourceEvidenceDeclaration,
} from '../../../artifacts/sourceEvidence/guards.js';
import type {
  SourceEvidenceCandidate,
  SourceEvidenceIndex,
  SourceEvidenceDataset,
} from '../../../artifacts/sourceEvidence/types.js';
import {
  boundedSourceDataset,
  selectedSourceFields,
} from '../../../artifacts/sourceEvidence/datasets.js';
import { readDetailArgs } from '../../../artifacts/detailRequest.js';
import { projectArtifactDetail } from '../../../artifacts/detailView.js';
import { TOOL_RESULT_STATUSES } from '../../../semantics/toolOutcome.js';

export const unavailableSourceEvidence = () => ({
  historical: true as const,
  unavailable: true as const,
});

export async function readSourceCandidate(
  artifacts: ToolArtifacts,
  index: SourceEvidenceIndex | undefined,
  ref: string,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<SourceEvidenceCandidate | undefined> {
  if (!isArtifactRef(ref) || !index?.refs.includes(ref)) return undefined;
  const head = await untilAborted(artifacts.head(ref), signal);
  throwIfAborted(signal);
  if (!head || head.kind !== SOURCE_EVIDENCE_KIND || head.mediaType !== 'application/json')
    return undefined;
  const record = await boundedSourceDataset(artifacts, head, maxBytes, signal);
  if (!record) return undefined;
  const data = ownData(record.data, [
    'producer',
    'subject',
    'operation',
    'scope',
    'scalars',
    'datasets',
    'status',
    'coverage',
    'period',
  ]);
  const producer = ownData(data.producer, ['name', 'source']);
  if (
    typeof producer.name !== 'string' ||
    !producer.name ||
    producer.name.length > 256 ||
    (producer.source !== undefined &&
      (typeof producer.source !== 'string' || producer.source.length > 256))
  )
    return undefined;
  if (data.status !== undefined && !TOOL_RESULT_STATUSES.includes(data.status as never))
    return undefined;
  const declaration = sourceEvidenceDeclaration(
    {
      subject: data.subject,
      operation: data.operation,
      scope: data.scope,
      ...(data.scalars !== undefined && { scalars: data.scalars }),
      ...(data.datasets !== undefined && { datasets: data.datasets }),
    },
    maxBytes,
  );
  return copyJson(
    {
      ...declaration,
      producer,
      ref,
      recordedAt: head.createdAt,
      ...(head.origin !== undefined && { origin: head.origin }),
      ...(data.status !== undefined && { status: data.status }),
      ...(data.coverage !== undefined && { coverage: data.coverage }),
      ...(data.period !== undefined && { period: data.period }),
    },
    maxBytes + 2048,
    true,
  ) as SourceEvidenceCandidate;
}

/** Exact value pages avoid refetching a whole array once per child row. */
export function sourceArrayPage(
  rows: readonly unknown[],
  args: { ref: string; path: string; offset: number; limit: number },
  envelope: Record<string, unknown>,
  maxBytes: number,
): unknown {
  if (args.offset > rows.length) return unavailableSourceEvidence();
  const values: unknown[] = [];
  const result = () => ({
    ...envelope,
    detail: {
      ref: args.ref,
      path: args.path,
      kind: 'array',
      mode: 'value',
      value: values,
      offset: args.offset,
      shown: values.length,
      total: rows.length,
      complete: args.offset === 0 && values.length === rows.length,
      ...(args.offset + values.length < rows.length && { nextOffset: args.offset + values.length }),
    },
  });
  for (const row of rows.slice(args.offset, args.offset + args.limit)) {
    values.push(row);
    if (jsonBytes(result()) > maxBytes) {
      values.pop();
      break;
    }
  }
  if (args.offset < rows.length && values.length === 0) return unavailableSourceEvidence();
  return jsonBytes(result()) <= maxBytes ? result() : unavailableSourceEvidence();
}

export async function readSourceDataset(
  artifacts: ToolArtifacts,
  candidate: SourceEvidenceCandidate,
  dataset: SourceEvidenceDataset,
  request: { path?: string; offset?: number; limit?: number },
  maxBytes: number,
  signal?: AbortSignal,
): Promise<unknown> {
  const head = await untilAborted(artifacts.head(dataset.ref), signal);
  throwIfAborted(signal);
  if (!head || head.kind !== dataset.kind || head.digest !== dataset.digest)
    return unavailableSourceEvidence();
  const record = await boundedSourceDataset(artifacts, head, 1048576, signal);
  if (!record) return unavailableSourceEvidence();
  let data = record.data;
  if (dataset.fields !== undefined) {
    if (!Array.isArray(data)) return unavailableSourceEvidence();
    data = selectedSourceFields(data, dataset.fields);
  }
  const args = readDetailArgs({
    ref: dataset.ref,
    path: request.path ?? '',
    ...(request.offset !== undefined && { offset: request.offset }),
    ...(request.limit !== undefined && { limit: request.limit }),
  });
  const envelope = {
    historical: true,
    receipt: candidate,
    dataset: { key: dataset.key, ref: dataset.ref },
  };
  if (args.path === '' && Array.isArray(data))
    return sourceArrayPage(data, args, envelope, maxBytes);
  const detail = projectArtifactDetail(data, args, 'read_source_evidence');
  if (detail.mode === 'children')
    for (const child of detail.children) {
      const action = child.action as unknown as { args: Record<string, unknown> };
      action.args = { ...action.args, ref: candidate.ref, dataset: dataset.key };
    }
  const result = { ...envelope, detail };
  return jsonBytes(result) <= maxBytes ? result : unavailableSourceEvidence();
}
