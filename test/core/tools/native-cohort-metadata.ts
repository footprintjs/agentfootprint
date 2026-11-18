/** Raw read-window checks run before the existing whole-record normalizer masks `beganAt`. */
import assert from 'node:assert/strict';

export type NativeWindowAddition = {
  pointer: string;
  value: '<volatile>' | number;
};

const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
const object = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/**
 * Foottrace 2's readWindow/admitStamps contract: beganAt precedes the bundle's
 * position; sawUntil is later than beganAt and may equal that position. These
 * are commit counts, not clocks. Only direct bundle metadata is inspected;
 * business payloads with either name are left alone. This changes no snapshot.
 */
export function assertNativeReadWindowMetadata(
  snapshot: { readonly commitLog: readonly unknown[] },
  additions: readonly NativeWindowAddition[],
): void {
  let after = -1;
  for (const bundle of snapshot.commitLog) {
    assert(object(bundle), 'native bundle must be an object');
    const own =
      count(bundle.idx) && bundle.idx <= 2 ** 52 && bundle.idx > after ? bundle.idx : undefined;
    const beganAt = bundle.beganAt;
    const sawUntil = bundle.sawUntil;
    if (beganAt !== undefined || sawUntil !== undefined) {
      const at = bundle.idx === undefined ? after + 1 : own;
      assert(at !== undefined, 'stamped bundle must have an admissible position');
      assert(count(beganAt) && beganAt < at, 'beganAt must be a count before its bundle');
      if (sawUntil !== undefined)
        assert(
          count(sawUntil) && sawUntil > beganAt && sawUntil <= at,
          'sawUntil must be after beganAt and at most its bundle position',
        );
    }
    after = own ?? after + 1;
  }

  // The hosted failure identifies precisely which newly present metadata must
  // remain present. In particular an undefined beganAt must not disappear into
  // JSON serialization before the volatile-key normalizer can check it.
  const seen = new Set<string>();
  for (const addition of additions) {
    const match = /^\/commitLog\/(0|[1-9][0-9]*)\/(beganAt|sawUntil)$/.exec(addition.pointer);
    assert(match && !seen.has(addition.pointer), 'unique direct metadata pointer required');
    seen.add(addition.pointer);
    const bundle = snapshot.commitLog[Number(match[1])];
    const field = match[2]!;
    assert(object(bundle) && Object.hasOwn(bundle, field), 'required raw metadata is missing');
    assert(count(bundle[field]), 'required raw metadata must be a count');
    if (field === 'beganAt')
      assert.equal(addition.value, '<volatile>', 'beganAt uses the unchanged normalizer');
    else assert.equal(bundle[field], addition.value, 'sawUntil must match its hosted addition');
  }
}
