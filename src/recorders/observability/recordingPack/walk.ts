import { wireReplacer } from '../../../lib/wireJson.js';

// ── The walk — JSON.stringify's own reading of a value ────────────────────

/** A member `JSON.stringify` leaves out of an object (and writes `null` for in an array). */
const SKIP: unique symbol = Symbol('skip');

/**
 * The value `JSON.stringify` would serialize for `holder[key]` once `raw` was
 * read: `toJSON`, then the wire rule (as `toWireJson`'s replacer), then boxed
 * primitives unwrapped and non-finite numbers made `null`. `SKIP` for what
 * JSON drops.
 */
function normalize(holder: object, key: string, raw: unknown): unknown {
  let value = raw;
  if (
    value !== null &&
    (typeof value === 'object' || typeof value === 'function' || typeof value === 'bigint')
  ) {
    // JSON asks a function for `toJSON` too — it is an object.
    const toJSON = (value as { toJSON?: unknown }).toJSON;
    if (typeof toJSON === 'function') value = (toJSON as (k: string) => unknown).call(value, key);
  }
  value = wireReplacer.call(holder, key, value);
  value = unboxed(value);
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'bigint') throw new TypeError('a BigInt value cannot be serialized to JSON');
  if (value === undefined || typeof value === 'function' || typeof value === 'symbol') return SKIP;
  return value;
}

/**
 * A boxed primitive as `JSON.stringify` reads it — by its INTERNAL SLOT, not
 * its prototype: `new Number(3)` is `3`, `Object(1n)` is a BigInt (refused),
 * and an object that merely inherits from `Number.prototype` is an object.
 * Only an object whose prototype is not `Object.prototype` can be one (a box
 * keeps its slot when its prototype is set to `null`), so plain data — every
 * recording — takes no probe at all.
 */
function unboxed(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return value;
  if (Object.getPrototypeOf(value) === Object.prototype) return value;
  if (hasSlot(Number.prototype.valueOf, value)) return Number(value);
  if (hasSlot(String.prototype.valueOf, value)) return String(value);
  if (hasSlot(Boolean.prototype.valueOf, value)) return Boolean.prototype.valueOf.call(value);
  if (hasSlot(BigInt.prototype.valueOf, value)) return BigInt.prototype.valueOf.call(value);
  return value;
}

/** Does `value` carry the internal slot `valueOf` reads? (It throws otherwise.) */
function hasSlot(valueOf: (this: unknown) => unknown, value: object): boolean {
  try {
    valueOf.call(value);
    return true;
  } catch {
    return false;
  }
}

/** How the packer reads a value's members — `JSON.stringify`'s own reading
 *  (`normalize` per member), counted when a work counter is given. */
interface MemberReader {
  array(array: readonly unknown[]): unknown[];
  object(object: object): [string, unknown][];
}

function reader(work: { members: number } | undefined): MemberReader {
  return {
    array(array) {
      const members: unknown[] = [];
      for (let i = 0; i < array.length; i++) members.push(normalize(array, String(i), array[i]));
      if (work !== undefined) work.members += members.length;
      return members;
    },
    object(object) {
      const members: [string, unknown][] = [];
      const keys = Object.keys(object);
      for (const key of keys) {
        const member = normalize(object, key, (object as Record<string, unknown>)[key]);
        if (member !== SKIP) members.push([key, member]);
      }
      if (work !== undefined) work.members += keys.length;
      return members;
    },
  };
}

export { SKIP, normalize, reader, type MemberReader };
