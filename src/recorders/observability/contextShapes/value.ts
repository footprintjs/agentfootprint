import { isPlaceholder } from '../../../redaction/marker.js';

export interface ContextShapeOptions {
  /** Additional exact paths to observe inside initial or newly assigned values. */
  readonly paths?: readonly (readonly string[])[];
  /** Visit all JSON fields and array entries of initial and assigned values. */
  readonly scan?: 'full';
}
export type ShapeKind =
  | 'array'
  | 'object'
  | 'string'
  | 'number'
  | 'boolean'
  | 'null'
  | 'deleted'
  | 'unknown';
export type ShapeEntry = readonly [path: readonly string[], type: ShapeKind, length?: number];
export interface ContextShapeIndex {
  readonly version: 1;
  readonly initial: readonly ShapeEntry[];
  readonly changes: readonly (readonly [commitIdx: number, entries: readonly ShapeEntry[]])[];
}
export type Path = readonly string[];
export type Shape = readonly [ShapeKind, number?];
export const unknown: Shape = ['unknown'];
export const deleted: Shape = ['deleted'];
export const missing = Symbol('missing');
const opaque = Symbol('unavailable');

export function lookup(root: unknown, path: Path): unknown {
  let value = root;
  for (const part of path) {
    if (isPlaceholder(value)) return opaque;
    if (value === null || typeof value !== 'object') return missing;
    if (Array.isArray(value) && arrayIndex(part) === undefined) return missing;
    const descriptor = Object.getOwnPropertyDescriptor(value, part);
    if (!descriptor) return missing;
    if (!('value' in descriptor)) return opaque;
    value = descriptor.value;
  }
  return value;
}
export function classify(value: unknown): Shape {
  if (value === missing) return deleted;
  if (value === null) return ['null'];
  if (Array.isArray(value)) return ['array', value.length];
  if (isPlaceholder(value)) return unknown;
  switch (typeof value) {
    case 'number':
      return Number.isFinite(value) ? ['number'] : unknown;
    case 'boolean':
      return ['boolean'];
    case 'string':
      return ['string'];
    case 'object': {
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null ? ['object'] : unknown;
    }
    default:
      return unknown;
  }
}
export const prefix = (a: Path, b: Path) =>
  a.length <= b.length && a.every((key, i) => b[i] === key);

/** Enumerable named properties of arrays are outside the JSON element sequence. */
export function arrayIndex(key: string): number | undefined {
  const index = Number(key);
  return String(index) === key && Number.isInteger(index) && index >= 0 && index < 0xffffffff
    ? index
    : undefined;
}
