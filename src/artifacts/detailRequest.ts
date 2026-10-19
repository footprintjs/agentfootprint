import { ownData } from '../lib/boundedJson.js';
import { isArtifactRef } from './naming.js';
import { invalidDetail } from './detailError.js';
import type { ArtifactDetailArgs } from './detailTypes.js';

export const DETAIL_LIMITS = Object.freeze({
  inputBytes: 1024 * 1024,
  contextBytes: 4096,
  path: 2048,
  depth: 16,
  page: 20,
  offset: 1_000_000,
  valueBytes: 8192,
  outputBytes: 12 * 1024,
  reserveBytes: 512,
});

const forbidden = new Set(['__proto__', 'prototype', 'constructor']);

/** Strict pointer tokens, shared by request admission and child actions. */
export function detailTokens(path: string): string[] {
  if (path === '') return [];
  if (!path.startsWith('/') || path.length > DETAIL_LIMITS.path) return invalidDetail();
  const parts = path.slice(1).split('/');
  if (parts.length > DETAIL_LIMITS.depth) return invalidDetail();
  return parts.map((part) => {
    // eslint-disable-next-line no-control-regex -- A pointer must not carry C0 or DEL controls.
    if (/~(?![01])/.test(part) || /[\u0000-\u001f\u007f]/.test(part)) return invalidDetail();
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    if (forbidden.has(key)) return invalidDetail();
    return key;
  });
}

export function readDetailArgs(value: unknown): Required<ArtifactDetailArgs> {
  try {
    const fields = ownData(value, ['ref', 'path', 'offset', 'limit']);
    if (
      typeof fields.ref !== 'string' ||
      !isArtifactRef(fields.ref) ||
      typeof fields.path !== 'string'
    )
      return invalidDetail();
    detailTokens(fields.path);
    const offset = fields.offset === undefined ? 0 : fields.offset;
    const limit = fields.limit === undefined ? DETAIL_LIMITS.page : fields.limit;
    if (
      !Number.isSafeInteger(offset) ||
      Number(offset) < 0 ||
      Number(offset) > DETAIL_LIMITS.offset ||
      !Number.isSafeInteger(limit) ||
      Number(limit) < 1 ||
      Number(limit) > DETAIL_LIMITS.page
    )
      return invalidDetail();
    return { ref: fields.ref, path: fields.path, offset: Number(offset), limit: Number(limit) };
  } catch {
    return invalidDetail();
  }
}
