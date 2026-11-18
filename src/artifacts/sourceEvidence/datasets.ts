import { copyJson, ownData } from '../../lib/boundedJson.js';
import { canonicalJson } from '../../lib/canonicalJson.js';
import { throwIfAborted, untilAborted } from '../../lib/abort.js';
import { measureArtifactBytes } from '../payload.js';
import type { ArtifactMeta, ArtifactRecord } from '../types.js';
import type { ToolArtifacts } from '../capability.js';
import type { SourceEvidenceDatasetDeclaration, SourceEvidenceSource } from './types.js';
import { sourceEvidenceFields, sourceEvidenceText } from './guards.js';

/** Fail static producer configuration before a source executes or any store is read. */
export function sourceDatasetDeclarations(
  input: unknown,
): readonly SourceEvidenceDatasetDeclaration[] {
  const declarations = copyJson(input, 8192, true);
  if (!Array.isArray(declarations) || declarations.length > 8)
    throw new TypeError('Invalid source dataset declarations.');
  const keys = new Set<string>();
  for (const raw of declarations) {
    const entry = ownData(raw, ['key', 'refPath', 'kind', 'fields', 'maxBytes', 'maxRows']);
    if (
      !sourceEvidenceText(entry.key, 128) ||
      keys.has(entry.key) ||
      !Array.isArray(entry.refPath) ||
      entry.refPath.length > 16 ||
      !entry.refPath.every((key) => sourceEvidenceText(key, 256)) ||
      !sourceEvidenceText(entry.kind, 256)
    )
      throw new TypeError('Invalid source dataset declaration.');
    keys.add(entry.key);
    const maxBytes = entry.maxBytes ?? 65536,
      maxRows = entry.maxRows ?? 20;
    if (
      !Number.isSafeInteger(maxBytes) ||
      (maxBytes as number) < 1 ||
      (maxBytes as number) > 1048576 ||
      !Number.isSafeInteger(maxRows) ||
      (maxRows as number) < 1 ||
      (maxRows as number) > 1000
    )
      throw new TypeError('Invalid source dataset bounds.');
    sourceEvidenceFields(entry.fields);
  }
  return declarations as unknown as readonly SourceEvidenceDatasetDeclaration[];
}

export function valueAtPath(value: unknown, path: readonly string[]): unknown {
  let current = value;
  for (const key of path) {
    if (current === null || typeof current !== 'object' || !Object.hasOwn(current, key))
      return undefined;
    current = Object.getOwnPropertyDescriptor(current, key)?.value;
  }
  return current;
}
export function sameArtifactMeta(left: ArtifactMeta, right: ArtifactMeta): boolean {
  return ['ref', 'kind', 'mediaType', 'bytes', 'digest', 'createdAt', 'expiresAt'].every(
    (key) =>
      Object.getOwnPropertyDescriptor(left, key)?.value ===
      Object.getOwnPropertyDescriptor(right, key)?.value,
  );
}

/** Native head/get remain the sole isolation, expiry and integrity boundary. */
export async function boundedSourceDataset(
  artifacts: ToolArtifacts,
  expected: ArtifactMeta,
  maxBytes: number,
  signal?: AbortSignal,
): Promise<ArtifactRecord | undefined> {
  throwIfAborted(signal);
  const head = await untilAborted(artifacts.head(expected.ref), signal);
  throwIfAborted(signal);
  if (
    !head ||
    !sameArtifactMeta(head, expected) ||
    !Number.isSafeInteger(head.bytes) ||
    head.bytes < 0 ||
    head.bytes > maxBytes
  )
    return undefined;
  const loaded = await untilAborted(artifacts.get(expected.ref), signal);
  throwIfAborted(signal);
  if (
    !loaded ||
    !sameArtifactMeta(loaded.meta, head) ||
    measureArtifactBytes(loaded.data) !== head.bytes
  )
    return undefined;
  return { meta: structuredClone(loaded.meta), data: copyJson(loaded.data, maxBytes, true) };
}

/** Explicitly authorized paths only; unrelated cells never reach a producer mapper. */
export function selectedSourceFields(
  rows: readonly unknown[],
  fields: Readonly<Record<string, readonly string[]>>,
): readonly Readonly<Record<string, unknown>>[] {
  return copyJson(
    rows.map((row) => {
      const selected: Record<string, unknown> = Object.create(null);
      for (const [key, path] of Object.entries(fields)) {
        const value = valueAtPath(row, path);
        if (value !== undefined) Object.defineProperty(selected, key, { value, enumerable: true });
      }
      return selected;
    }),
    1048576,
    true,
  ) as readonly Readonly<Record<string, unknown>>[];
}

export async function declaredSourceDatasets(
  declarations: readonly SourceEvidenceDatasetDeclaration[] | undefined,
  served: unknown,
  artifacts: ToolArtifacts,
  publications: Pick<ReadonlyMap<string, ArtifactMeta>, 'get'>,
  signal?: AbortSignal,
): Promise<Readonly<Record<string, SourceEvidenceSource>>> {
  if (declarations === undefined) return {};
  const sources: Record<string, SourceEvidenceSource> = Object.create(null);
  for (const entry of declarations) {
    const maxBytes = entry.maxBytes ?? 65536,
      maxRows = entry.maxRows ?? 20;
    const ref = valueAtPath(served, entry.refPath);
    const meta = typeof ref === 'string' ? publications.get(ref) : undefined;
    if (!meta || meta.kind !== entry.kind) continue;
    const record = await boundedSourceDataset(artifacts, meta, maxBytes, signal);
    if (!record || !Array.isArray(record.data) || record.data.length > maxRows) continue;
    const source = {
      ref: meta.ref,
      rows: selectedSourceFields(record.data, entry.fields),
      complete: true,
    };
    Object.defineProperty(sources, entry.key, { value: source, enumerable: true });
  }
  return copyJson(sources, 1048576, true) as Readonly<Record<string, SourceEvidenceSource>>;
}

/** Exact value presence establishes association, not truth of a producer's relationships. */
export function containsSourceRef(value: unknown, ref: string): boolean {
  if (value === ref) return true;
  if (Array.isArray(value)) return value.some((item) => containsSourceRef(item, ref));
  return (
    value !== null &&
    typeof value === 'object' &&
    Object.values(value).some((item) => containsSourceRef(item, ref))
  );
}

/** Exact structural occurrence, not semantic attribution or identifier extraction. */
export function containsSourceScalar(value: unknown, expected: unknown): boolean {
  if (value === expected) return true;
  if (Array.isArray(value)) return value.some((item) => containsSourceScalar(item, expected));
  if (value !== null && typeof value === 'object')
    return Object.entries(value).some(
      ([key, item]) =>
        (typeof expected === 'string' && key === expected) || containsSourceScalar(item, expected),
    );
  return false;
}

export function sameSourceValue(left: unknown, right: unknown): boolean {
  return left === undefined || right === undefined
    ? left === right
    : canonicalJson(left) === canonicalJson(right);
}
