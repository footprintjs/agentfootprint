/** Authored scope projection over the arguments actually delivered to execute. */
import { copyJson, ownData } from '../../lib/boundedJson.js';
import { canonicalJson } from '../../lib/canonicalJson.js';
import { compareInstants, instantOf } from '../../time/instant.js';
import { periodProblem } from '../../core/agent/coverage/period.js';
import type { DeclaredPeriod } from '../../core/agent/coverage/period.js';
import type { ScopeDeclaration, ScopeDimension } from './types.js';

export const BINDING_LIMITS = Object.freeze({
  text: 512,
  resultIdText: 3104,
  dimensions: 16,
  path: 16,
  scopeBytes: 8192,
  resultBytes: 256 * 1024,
  snapshotBytes: 1024 * 1024,
  results: 256,
});

export function boundedText(value: unknown): value is string {
  return typeof value === 'string' && value.trim() !== '' && value.length <= BINDING_LIMITS.text;
}

export function boundedResultId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.startsWith('claim-result/') &&
    value.length <= BINDING_LIMITS.resultIdText
  );
}

/** Shallow descriptor-only admission for authored arrays containing callbacks. */
export function ownConfigArray(value: unknown, maximum: number): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    throw new Error('Expected a plain configuration array.');
  const length = Object.getOwnPropertyDescriptor(value, 'length')?.value as unknown;
  if (
    typeof length !== 'number' ||
    !Number.isSafeInteger(length) ||
    length > maximum ||
    Reflect.ownKeys(value).length !== length + 1
  )
    throw new Error('Invalid configuration array.');
  const items: unknown[] = [];
  for (let index = 0; index < length; index++) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor?.enumerable || !('value' in descriptor))
      throw new Error('Expected dense configuration data.');
    items.push(descriptor.value);
  }
  return Object.freeze(items);
}

/** Inspect authored configuration without evaluating getters or inherited fields. */
export function scopeDeclarationOf(raw: unknown): ScopeDeclaration {
  const source = ownData(raw, ['id', 'version', 'dimensions', 'periodDimension']);
  const sourceDimensions = ownConfigArray(source.dimensions, BINDING_LIMITS.dimensions);
  if (!boundedText(source.id) || !boundedText(source.version) || sourceDimensions.length === 0)
    throw new Error('Invalid scope declaration.');
  const names = new Set<string>();
  const dimensions = sourceDimensions.map((rawDimension): ScopeDimension => {
    const dimension = ownData(rawDimension, ['name', 'argumentPath', 'default', 'normalize']);
    const path = copyJson(dimension.argumentPath, BINDING_LIMITS.scopeBytes, true);
    if (
      !boundedText(dimension.name) ||
      names.has(dimension.name) ||
      !Array.isArray(path) ||
      path.length === 0 ||
      path.length > BINDING_LIMITS.path ||
      !path.every(boundedText) ||
      (Object.hasOwn(dimension, 'normalize') && typeof dimension.normalize !== 'function')
    )
      throw new Error('Invalid scope dimension.');
    names.add(dimension.name);
    return Object.freeze({
      name: dimension.name,
      argumentPath: path as readonly string[],
      ...(Object.hasOwn(dimension, 'default') && {
        default: copyJson(dimension.default, BINDING_LIMITS.scopeBytes, true),
      }),
      ...(typeof dimension.normalize === 'function' && {
        normalize: dimension.normalize as NonNullable<ScopeDimension['normalize']>,
      }),
    });
  });
  if (
    Object.hasOwn(source, 'periodDimension') &&
    (!boundedText(source.periodDimension) || !names.has(source.periodDimension))
  )
    throw new Error('Invalid period dimension.');
  return Object.freeze({
    id: source.id,
    version: source.version,
    dimensions: Object.freeze(dimensions),
    ...(typeof source.periodDimension === 'string' && { periodDimension: source.periodDimension }),
  });
}

/** Own data properties only: inherited names and accessors supply no scope. */
function argumentAt(args: unknown, path: readonly string[]): unknown {
  if (path.length === 0 || path.length > BINDING_LIMITS.path || !path.every(boundedText))
    throw new Error('Invalid scope path.');
  let cursor = args;
  for (const key of path) {
    if (cursor === null || typeof cursor !== 'object') return undefined;
    const descriptor = Object.getOwnPropertyDescriptor(cursor, key);
    if (descriptor === undefined) {
      if (key in cursor) throw new Error('Inherited scope is not executed own-data.');
      return undefined;
    }
    if (!descriptor.enumerable || !('value' in descriptor))
      throw new Error('Scope requires own data.');
    cursor = descriptor.value;
  }
  return cursor;
}

export function executedScope(
  args: unknown,
  declaration: ScopeDeclaration,
): Readonly<Record<string, unknown>> {
  declaration = scopeDeclarationOf(declaration);
  const scope: Record<string, unknown> = {};
  for (const dimension of declaration.dimensions) {
    if (!boundedText(dimension.name) || Object.hasOwn(scope, dimension.name))
      throw new Error('Invalid scope dimension.');
    let value = argumentAt(args, dimension.argumentPath);
    if (value === undefined && Object.hasOwn(dimension, 'default')) value = dimension.default;
    if (value === undefined) throw new Error('Required scope is missing.');
    // Detach BEFORE invoking an authored normalizer: it cannot mutate dispatch.
    value = copyJson(value, BINDING_LIMITS.scopeBytes, true);
    if (dimension.normalize !== undefined) value = dimension.normalize(value);
    Object.defineProperty(scope, dimension.name, {
      value: copyJson(value, BINDING_LIMITS.scopeBytes, true),
      enumerable: true,
    });
  }
  if (
    declaration.periodDimension !== undefined &&
    !Object.hasOwn(scope, declaration.periodDimension)
  )
    throw new Error('The period dimension is missing.');
  return copyJson(scope, BINDING_LIMITS.scopeBytes, true) as Readonly<Record<string, unknown>>;
}

/** Exact declared dimensions; no inferred subset, defaults or currency conversion. */
export function scopesMatch(
  evidence: Readonly<Record<string, unknown>>,
  intended: unknown,
): boolean {
  const expected = ownData(copyJson(intended, BINDING_LIMITS.scopeBytes, true));
  return canonicalJson(evidence) === canonicalJson(expected);
}

/** The existing period/instant owners decide validity and temporal equivalence. */
export function queriedPeriodMatches(scopeValue: unknown, period: DeclaredPeriod): boolean {
  const query = ownData(scopeValue, ['from', 'to']);
  if (periodProblem({ queried: query, held: 'unknown' }, 'camel') !== undefined) return false;
  const from = instantOf(query.from as string, 'lenient');
  const to = instantOf(query.to as string, 'lenient');
  const actualFrom = instantOf(period.queried.from, 'lenient');
  const actualTo = instantOf(period.queried.to, 'lenient');
  return (
    from !== undefined &&
    to !== undefined &&
    actualFrom !== undefined &&
    actualTo !== undefined &&
    compareInstants(from, actualFrom) === 0 &&
    compareInstants(to, actualTo) === 0
  );
}
