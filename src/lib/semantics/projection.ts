/** Pure preservation check at the dataset adapter boundary. No fact validation or row scan. */
import { ABSENCE_MARKER } from '../../core/agent/coverage/absent.js';
import { COVERAGE_MARKER } from '../../core/agent/coverage/ledger.js';
import { readToolResultEnvelope } from '../../core/agent/toolEffects.js';
import { SEMANTICS_MARKER } from './types.js';

export interface ProjectionIssue {
  readonly code: 'projection-declaration-changed' | 'projection-declaration-unreadable';
  readonly field: string;
  readonly message: string;
}
export interface ProjectionSnapshot {
  readonly fields: ReadonlyMap<string, string>;
  readonly issues: readonly ProjectionIssue[];
}
const own = (value: object, key: PropertyKey): unknown => {
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  // Native readers also recognize inherited reserved fields. Refuse those at
  // this JSON boundary rather than silently treating their absence as success.
  if (!descriptor && key in value) throw new Error('Inherited metadata');
  if (descriptor && !('value' in descriptor)) throw new Error('Accessor');
  return descriptor?.value;
};
const object = (value: unknown): value is object =>
  typeof value === 'object' && value !== null && !Array.isArray(value);
const coverageKeys = ['checked', 'not_checked', 'cannot_cover', 'note'] as const;

/** Capture before calling an adapter: it might mutate the original result.
 * Only reserved declarations and the framework's documented wrapper spine are
 * inspected. Raw facts/series/rows and arbitrary nested objects are not read. */
export function snapshotProjectionSemantics(result: unknown): ProjectionSnapshot {
  const fields = new Map<string, string>();
  const issues: ProjectionIssue[] = [];
  const visited = new Set<object>();
  let count = 0,
    chars = 0;
  const limits = (size: number) => {
    if (++count > 10_000 || (chars += size) > 65_536) throw new Error('Limit');
  };
  function json(value: unknown, depth = 0, ancestors = new Set<object>()): unknown {
    limits(typeof value === 'string' ? value.length : 0);
    if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value !== 'object' || depth >= 16 || ancestors.has(value))
      throw new Error('Non-JSON');
    const array = Array.isArray(value);
    const prototype = Object.getPrototypeOf(value);
    if (
      array ? prototype !== Array.prototype : prototype !== Object.prototype && prototype !== null
    )
      throw new Error('Non-JSON');
    ancestors.add(value);
    try {
      const keys = Reflect.ownKeys(value);
      if (keys.length > 10_000) throw new Error('Limit');
      if (array) {
        const length = own(value, 'length') as number;
        if (keys.length !== length + 1) throw new Error('Sparse or extra array fields');
        return Array.from({ length }, (_, index) =>
          json(own(value, String(index)), depth + 1, ancestors),
        );
      }
      const copy = Object.create(null) as Record<string, unknown>;
      for (const key of keys.sort((a, b) =>
        typeof a === 'string' && typeof b === 'string' ? (a < b ? -1 : a > b ? 1 : 0) : 0,
      )) {
        if (typeof key !== 'string') throw new Error('Symbol');
        limits(key.length);
        const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
        if (!descriptor.enumerable) throw new Error('Non-JSON');
        copy[key] = json(own(value, key), depth + 1, ancestors);
      }
      return copy;
    } finally {
      ancestors.delete(value);
    }
  }
  const unreadable = (field: string) =>
    issues.push({
      code: 'projection-declaration-unreadable',
      field,
      message: `Dataset projection cannot preserve declaration '${field}': metadata is unreadable, non-JSON or exceeds the preservation limits.`,
    });
  function capture(value: object, key: string, path: string) {
    const field = `${path}.${key}`;
    try {
      const original = own(value, key);
      if (original !== undefined) fields.set(field, JSON.stringify(json(original)));
    } catch {
      unreadable(field);
    }
  }
  function walk(value: unknown, path: string, depth: number) {
    if (!object(value)) return;
    if (visited.has(value) || depth >= 16) {
      unreadable(path);
      return;
    }
    visited.add(value);
    try {
      // Match the existing effect-envelope recognizer using detached metadata;
      // never hand it the producer's getters or walk its content as JSON.
      if ('content' in value && Array.isArray(own(value, 'effects'))) {
        own(value, 'content');
        const keys = Reflect.ownKeys(value);
        if (keys.length > 10_000) throw new Error('Limit');
        // Native recognition uses enumerable string keys; bookkeeping symbols
        // and non-enumerable fields must not hide an otherwise valid envelope.
        const envelopeKeys = keys.every(
          (key) =>
            typeof key !== 'string' ||
            !Object.getOwnPropertyDescriptor(value, key)?.enumerable ||
            key === 'content' ||
            key === 'effects' ||
            key === 'status',
        );
        if (envelopeKeys) {
          const envelope = readToolResultEnvelope({
            content: undefined,
            effects: json(own(value, 'effects')),
            ...(own(value, 'status') !== undefined && { status: own(value, 'status') }),
          });
          if (envelope) {
            capture(value, 'status', `${path}.envelope`);
            capture(value, 'effects', `${path}.envelope`);
            walk(own(value, 'content'), `${path}.content`, depth + 1);
            return;
          }
        }
      }
      if (own(value, ABSENCE_MARKER) === true) {
        const checked = own(value, 'checked');
        if (Array.isArray(checked) && checked.length > 0) {
          for (const key of [
            ABSENCE_MARKER,
            'outcome',
            'looked_for',
            ...coverageKeys,
            'retry_returns_the_same',
            'try_instead',
          ])
            capture(value, key, path);
          return;
        }
      }
      if (own(value, SEMANTICS_MARKER) === true) {
        // This protects declarations, not semanticIssues' separate schema/data
        // checks. A declared marker never licenses silently dropping metadata.
        for (const key of [
          SEMANTICS_MARKER,
          'grain',
          'provenance',
          'coverage',
          'not_covered',
          'clarify',
          'note',
        ])
          capture(value, key, path);
        return;
      }
      const ledger = own(value, COVERAGE_MARKER);
      if (object(ledger) && 'result' in value) {
        fields.set(`${path}.${COVERAGE_MARKER}`, 'declared');
        for (const key of coverageKeys) capture(ledger, key, `${path}.${COVERAGE_MARKER}`);
        walk(own(value, 'result'), `${path}.result`, depth + 1);
      }
    } catch {
      unreadable(path);
    }
  }
  walk(result, 'result', 0);
  return { fields, issues };
}

/** Exact preservation of original fields; unrelated new declarations may be added. */
export function projectionSemanticsIssues(
  before: ProjectionSnapshot,
  after: unknown,
): readonly ProjectionIssue[] {
  if (before.issues.length) return before.issues;
  if (before.fields.size === 0) return [];
  const projected = snapshotProjectionSemantics(after);
  if (projected.issues.length) return projected.issues;
  const issues: ProjectionIssue[] = [];
  for (const [field, value] of before.fields)
    if (projected.fields.get(field) !== value)
      issues.push({
        code: 'projection-declaration-changed',
        field,
        message: `Dataset projection removed or changed declaration '${field}'. Preserve the original absence, coverage and semantic metadata while replacing its data with references.`,
      });
  return issues;
}
