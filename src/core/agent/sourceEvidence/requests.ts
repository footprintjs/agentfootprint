import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { isArtifactRef } from '../../../artifacts/naming.js';
import type {
  SourceEvidenceFindArgs,
  SourceEvidenceReadArgs,
} from '../../../artifacts/sourceEvidence/types.js';
import {
  sourceEvidenceScope,
  sourceEvidenceText,
} from '../../../artifacts/sourceEvidence/guards.js';

export function findArgs(value: unknown): SourceEvidenceFindArgs {
  const data = ownData(copyJson(value, 4096, true), [
    'subject',
    'operation',
    'scope',
    'cursor',
    'limit',
  ]);
  const subject = ownData(data.subject, ['kind', 'value']);
  if (
    !sourceEvidenceText(subject.kind, 128) ||
    !sourceEvidenceText(subject.value) ||
    (data.operation !== undefined && !sourceEvidenceText(data.operation, 128)) ||
    (data.cursor !== undefined &&
      (typeof data.cursor !== 'string' ||
        !/^se1:(0|[1-9]\d{0,15}):(0|[1-9]\d{0,15})$/.test(data.cursor))) ||
    (data.limit !== undefined &&
      (!Number.isSafeInteger(data.limit) ||
        (data.limit as number) < 1 ||
        (data.limit as number) > 20))
  )
    throw new TypeError('Invalid source evidence query.');
  if (data.scope !== undefined) sourceEvidenceScope(data.scope);
  return data as unknown as SourceEvidenceFindArgs;
}
export function readArgs(value: unknown): SourceEvidenceReadArgs {
  const data = ownData(copyJson(value, 4096, true), ['ref', 'dataset', 'path', 'offset', 'limit']);
  if (
    !isArtifactRef(data.ref) ||
    (data.dataset !== undefined && !sourceEvidenceText(data.dataset, 128)) ||
    (data.path !== undefined && typeof data.path !== 'string') ||
    (data.offset !== undefined &&
      (!Number.isSafeInteger(data.offset) || (data.offset as number) < 0)) ||
    (data.limit !== undefined &&
      (!Number.isSafeInteger(data.limit) ||
        (data.limit as number) < 1 ||
        (data.limit as number) > 20))
  )
    throw new TypeError('Invalid source evidence read.');
  if (
    data.dataset === undefined &&
    (data.path !== undefined || data.offset !== undefined || data.limit !== undefined)
  )
    throw new TypeError('Dataset navigation requires an associated dataset key.');
  return data as unknown as SourceEvidenceReadArgs;
}
