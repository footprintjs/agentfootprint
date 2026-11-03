/**
 * `BIGINT` comes back from `pg` as a STRING by default (it does not fit in a
 * JavaScript number in general), and every timestamp here is one. Coerced in
 * one place, so a `createdAt` never reaches a consumer as `'1754640000000'`.
 */
export function num(value: unknown): number {
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}
