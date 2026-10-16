/**
 * Structural "plain prototype" test for values that may come from another
 * realm (jest's environment, `node:vm`, an iframe).
 *
 * An identity check (`proto === Object.prototype`) refuses a plain object built
 * in another realm, because each realm has its own intrinsics. This module
 * recognises a realm's `Object.prototype` / `Array.prototype` by what it IS:
 *
 *   - `Object.prototype`: its own prototype is null;
 *   - `Array.prototype`: an array whose own prototype is a realm's `Object.prototype`;
 *   - its own `constructor` is a data property holding the realm's native
 *     `Object` / `Array` (source text `function Object() { [native code] }`),
 *     whose own `prototype` data property points straight back at it — a link
 *     a user-made object or a Proxy cannot forge, because a native
 *     constructor's `prototype` is non-writable and non-configurable;
 *   - it carries the same own keys as this realm's intrinsic, each with the
 *     same descriptor kind (data or accessor), so an added getter is refused;
 *   - `Object.prototype.toString` names it `[object Object]` / `[object Array]`.
 *
 * Only descriptors are read: no getter, `toJSON` or `valueOf` on the value runs.
 * A class instance, a null-extended class, a forged prototype and a Proxy
 * standing in for a prototype all fail. A Proxy VALUE (whose own prototype
 * looks right) is not detectable here; the caller refuses it separately.
 */

type IntrinsicName = 'Object' | 'Array';

const LOCAL: Record<IntrinsicName, object> = {
  Object: Object.prototype,
  Array: Array.prototype,
};

/** True when `proto` is `Object.prototype` (or null) of any realm. */
export function isPlainObjectPrototype(proto: unknown, verified: WeakSet<object>): boolean {
  return proto === null || isIntrinsicPrototype(proto, 'Object', verified);
}

/** True when `proto` is `Array.prototype` of any realm. */
export function isPlainArrayPrototype(proto: unknown, verified: WeakSet<object>): boolean {
  return isIntrinsicPrototype(proto, 'Array', verified);
}

function isIntrinsicPrototype(
  proto: unknown,
  name: IntrinsicName,
  verified: WeakSet<object>,
): boolean {
  if (proto === LOCAL[name]) return true;
  if (typeof proto !== 'object' || proto === null) return false;
  if (verified.has(proto)) return true;
  const parent = Object.getPrototypeOf(proto);
  const parentOk =
    name === 'Object' ? parent === null : isIntrinsicPrototype(parent, 'Object', verified);
  if (!parentOk || Array.isArray(proto) !== (name === 'Array')) return false;
  if (!nativeConstructorLinksBack(proto, name) || !sameShape(proto, LOCAL[name])) return false;
  // Safe only now: the shape matches this realm's intrinsic, which has no own
  // Symbol.toStringTag, and the parent chain is verified, so no getter runs.
  if (Object.prototype.toString.call(proto) !== `[object ${name}]`) return false;
  verified.add(proto);
  return true;
}

function nativeConstructorLinksBack(proto: object, name: IntrinsicName): boolean {
  const ctor = Object.getOwnPropertyDescriptor(proto, 'constructor');
  if (ctor === undefined || !('value' in ctor) || typeof ctor.value !== 'function') return false;
  // Function.prototype.toString never runs user code; a Proxy or bound function
  // prints an anonymous native body, a class prints its source.
  if (Function.prototype.toString.call(ctor.value) !== `function ${name}() { [native code] }`)
    return false;
  const back = Object.getOwnPropertyDescriptor(ctor.value, 'prototype');
  return back !== undefined && 'value' in back && back.value === proto;
}

function sameShape(candidate: object, local: object): boolean {
  const keys = Reflect.ownKeys(local);
  if (Reflect.ownKeys(candidate).length !== keys.length) return false;
  for (const key of keys) {
    const theirs = Object.getOwnPropertyDescriptor(candidate, key);
    const ours = Object.getOwnPropertyDescriptor(local, key);
    if (theirs === undefined || ours === undefined || 'value' in theirs !== 'value' in ours)
      return false;
  }
  return true;
}
