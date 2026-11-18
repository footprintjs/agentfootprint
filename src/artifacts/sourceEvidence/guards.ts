import { copyJson, ownData } from '../../lib/boundedJson.js';
import { canonicalJson } from '../../lib/canonicalJson.js';
import { isArtifactRef } from '../naming.js';
import type {
  SourceEvidenceCandidate,
  SourceEvidenceDeclaration,
  SourceEvidenceIndex,
  SourceEvidenceLimits,
  SourceEvidenceProjection,
  SourceEvidenceScope,
} from './types.js';

export const SOURCE_EVIDENCE_KIND = 'evidence/source';
export const SOURCE_EVIDENCE_LIMITS: Readonly<Required<SourceEvidenceLimits>> = Object.freeze({
  maxReceipts: 32,
  maxReceiptBytes: 8192,
  maxScanned: 32,
  maxResponseBytes: 12288,
  timeoutMs: 5000,
});
export type ResolvedSourceEvidenceLimits = Readonly<Required<SourceEvidenceLimits>>;
const maximum = {
  maxReceipts: 128,
  maxReceiptBytes: 32768,
  maxScanned: 128,
  maxResponseBytes: 32768,
  timeoutMs: 30000,
};

export function sourceEvidenceLimits(input?: SourceEvidenceLimits): ResolvedSourceEvidenceLimits {
  if (input === undefined) return SOURCE_EVIDENCE_LIMITS;
  const data = ownData(input, Object.keys(maximum));
  const result = { ...SOURCE_EVIDENCE_LIMITS };
  for (const key of Object.keys(maximum) as (keyof SourceEvidenceLimits)[]) {
    const value = data[key];
    if (value === undefined) continue;
    if (
      typeof value !== 'number' ||
      !Number.isSafeInteger(value) ||
      value < 1 ||
      value > maximum[key]
    )
      throw new TypeError('Invalid source evidence limits.');
    result[key] = value;
  }
  return Object.freeze(result);
}

export function sourceEvidenceText(value: unknown, max = 512): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max;
}
export function sourceEvidenceScope(value: unknown): SourceEvidenceScope {
  const data = ownData(value);
  if (Object.keys(data).length > 16)
    throw new TypeError('Source evidence scope exceeds its bound.');
  for (const [key, item] of Object.entries(data)) {
    if (
      !sourceEvidenceText(key, 128) ||
      !(
        item === null ||
        typeof item === 'boolean' ||
        (typeof item === 'number' && Number.isFinite(item)) ||
        (typeof item === 'string' && item.length <= 1024)
      )
    )
      throw new TypeError('Invalid source evidence scalar.');
  }
  return data as SourceEvidenceScope;
}

export function sourceEvidenceDeclaration(
  value: unknown,
  maxBytes: number,
): SourceEvidenceDeclaration {
  const data = ownData(copyJson(value, maxBytes, true), [
    'subject',
    'operation',
    'scope',
    'scalars',
    'datasets',
  ]);
  const subject = ownData(data.subject, ['kind', 'value']);
  if (
    !sourceEvidenceText(subject.kind, 128) ||
    !sourceEvidenceText(subject.value) ||
    !sourceEvidenceText(data.operation, 128)
  )
    throw new TypeError('Invalid source evidence identity.');
  sourceEvidenceScope(data.scope);
  if (data.scalars !== undefined) sourceEvidenceScope(data.scalars);
  if (data.datasets !== undefined) {
    if (!Array.isArray(data.datasets) || data.datasets.length > 8)
      throw new TypeError('Invalid source evidence datasets.');
    const keys = new Set<string>();
    for (const item of data.datasets) {
      const dataset = ownData(item, ['key', 'ref', 'kind', 'digest', 'fields']);
      if (
        !sourceEvidenceText(dataset.key, 128) ||
        keys.has(dataset.key) ||
        !isArtifactRef(dataset.ref) ||
        !sourceEvidenceText(dataset.kind, 256) ||
        (dataset.digest !== undefined && !sourceEvidenceText(dataset.digest, 128))
      )
        throw new TypeError('Invalid source evidence dataset.');
      keys.add(dataset.key);
      if (dataset.fields !== undefined) sourceEvidenceFields(dataset.fields);
    }
  }
  return data as unknown as SourceEvidenceDeclaration;
}

export function sourceEvidenceFields(input: unknown): Readonly<Record<string, readonly string[]>> {
  const fields = ownData(input);
  if (Object.keys(fields).length > 24)
    throw new TypeError('Source evidence fields exceed their bound.');
  for (const [key, path] of Object.entries(fields)) {
    if (
      !sourceEvidenceText(key, 128) ||
      !Array.isArray(path) ||
      path.length > 16 ||
      !path.every((part) => sourceEvidenceText(part, 256))
    )
      throw new TypeError('Invalid source evidence field path.');
  }
  return fields as Readonly<Record<string, readonly string[]>>;
}

/** Structural validation does not authenticate a caller-supplied checkpoint. Hosts own that boundary. */
export function sourceEvidenceIndex(input: unknown): SourceEvidenceIndex {
  const data = ownData(copyJson(input, 8192, true), ['version', 'refs', 'omitted']);
  if (
    data.version !== 1 ||
    !Array.isArray(data.refs) ||
    data.refs.length > 128 ||
    !data.refs.every(isArtifactRef) ||
    new Set(data.refs).size !== data.refs.length ||
    !Number.isSafeInteger(data.omitted) ||
    (data.omitted as number) < 0
  )
    throw new TypeError('Invalid native source evidence index.');
  return data as unknown as SourceEvidenceIndex;
}

/** A host can withhold fields, never substitute values or erase native limitations. */
export function sourceEvidenceProjection(
  candidate: SourceEvidenceCandidate,
  input: unknown,
): SourceEvidenceProjection {
  const projected = ownData(copyJson(input, 32768, true), [
    'ref',
    'producer',
    'recordedAt',
    'origin',
    'subject',
    'operation',
    'scope',
    'status',
    'period',
    'coverage',
    'scalars',
    'datasets',
  ]);
  for (const key of ['subject', 'operation', 'scope', 'status', 'period', 'coverage'] as const) {
    if (!same(projected[key], candidate[key]))
      throw new TypeError('Source evidence admission cannot rewrite source facts or limitations.');
  }
  if (projected.scalars !== undefined) {
    const scalars = sourceEvidenceScope(projected.scalars);
    for (const [key, value] of Object.entries(scalars)) {
      if (!Object.hasOwn(candidate.scalars ?? {}, key) || !same(candidate.scalars?.[key], value))
        throw new TypeError('Source evidence admission cannot invent a scalar.');
    }
  }
  if (projected.datasets !== undefined) {
    if (!Array.isArray(projected.datasets) || projected.datasets.length > 8)
      throw new TypeError('Invalid source evidence projection.');
    const seen = new Set<string>();
    for (const item of projected.datasets) {
      const dataset = ownData(item, ['key', 'ref', 'kind', 'digest', 'fields']);
      if (!sourceEvidenceText(dataset.key, 128) || seen.has(dataset.key))
        throw new TypeError('Invalid source evidence dataset projection.');
      seen.add(dataset.key);
      const original = candidate.datasets?.find((entry) => entry.key === dataset.key);
      if (!original) throw new TypeError('Source evidence admission cannot invent a dataset.');
      for (const key of ['key', 'ref', 'kind', 'digest'] as const)
        if (!same(dataset[key], original[key])) throw new TypeError('Changed source dataset.');
      if (dataset.fields !== undefined)
        for (const [key, path] of Object.entries(sourceEvidenceFields(dataset.fields))) {
          if (
            original.fields !== undefined &&
            (!Object.hasOwn(original.fields, key) || !same(original.fields[key], path))
          )
            throw new TypeError('Source evidence admission cannot widen dataset fields.');
        }
      else if (original.fields !== undefined)
        throw new TypeError('Source evidence admission cannot remove dataset restrictions.');
    }
  }
  const body = Object.fromEntries(
    Object.entries(projected).filter(
      ([key]) => !['ref', 'producer', 'recordedAt', 'origin'].includes(key),
    ),
  );
  return body as unknown as SourceEvidenceProjection;
}

function same(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined
    ? left === right
    : canonicalJson(left) === canonicalJson(right);
}
