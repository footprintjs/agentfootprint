/**
 * plainData — copy the JSON data domain out of an untrusted value.
 *
 * MCP `structuredContent` arrives from a transport the library does not own,
 * so the value may be anything: a class instance, a Proxy, an object with
 * getters, or a plain object built in another realm (jest's environment,
 * `node:vm`, an iframe). This module answers one question — is this plain JSON
 * data? — and, when it is, hands back a COPY made of this realm's own objects
 * and arrays, built from property descriptors read once each.
 *
 * Why a copy rather than the value itself: whatever the source does after it
 * was checked (a Proxy trap that redefines a property it already reported, a
 * foreign prototype whose methods were replaced) cannot reach the copy. The
 * copy keeps every own key as a data property (`__proto__` included), keeps a
 * null prototype null, keeps a sub-object shared where the source shared it,
 * and holds nothing else: no getter, no foreign prototype, no Proxy.
 *
 * Plain objects and arrays are recognised by STRUCTURE, not by identity with
 * this realm's `Object.prototype`, because each realm has its own intrinsics:
 *
 *   - `Object.prototype` of a realm: its own prototype is null;
 *   - `Array.prototype` of a realm: an array whose own prototype is a realm's
 *     `Object.prototype`;
 *   - its own `constructor` is a data property holding that realm's native
 *     `Object` / `Array` (source text `function Object() { [native code] }`),
 *     whose own `prototype` data property points straight back at it — a link
 *     a user-made object or a Proxy cannot forge, because a native
 *     constructor's `prototype` is non-writable and non-configurable;
 *   - it carries the same own keys as this realm's intrinsic, each with the
 *     same descriptor kind (data or accessor), so an added getter is refused;
 *   - `Object.prototype.toString` names it `[object Object]` / `[object Array]`.
 *
 * Only descriptors are read: no getter, `toJSON` or `valueOf` runs. A Proxy is
 * refused before any trap runs wherever the runtime can say what a Proxy is
 * (Node's `util.types.isProxy`, reached through `process.getBuiltinModule` at
 * call time, so nothing is imported and the module stays browser-clean).
 * Elsewhere a Proxy's traps answer the walk like any object's descriptors do,
 * and only what they answered reaches the copy.
 */

type IntrinsicName = 'Object' | 'Array';

const LOCAL: Record<IntrinsicName, object> = {
  Object: Object.prototype,
  Array: Array.prototype,
};

/** The documented decoding bounds. */
const MAX_VALUES = 1_000_000;
const MAX_DEPTH = 64;

/**
 * A copy of `value` when it is a JSON object (not an array, not a scalar)
 * within the bounds, made of this realm's objects; `undefined` otherwise.
 * Never throws for a hostile value: any trap or check that throws refuses.
 */
export function copyJsonObject(value: unknown): Record<string, unknown> | undefined {
  try {
    if (value === null || typeof value !== 'object' || isProxyValue(value)) return undefined;
    if (Array.isArray(value)) return undefined;
    const copied = new JsonCopier().copy(value, 0);
    return copied === undefined ? undefined : (copied as Record<string, unknown>);
  } catch {
    return undefined;
  }
}

/** One walk: its counters, its cycle guard and its shared-node memo. */
class JsonCopier {
  private visited = 0;
  private readonly ancestors = new Set<object>();
  private readonly copies = new Map<object, object>();
  private readonly verified = new WeakSet<object>();

  /** The copy of `item`, or `undefined` when it is not JSON data. */
  copy(item: unknown, depth: number): unknown {
    if (++this.visited > MAX_VALUES) return undefined;
    if (item === null || typeof item === 'string' || typeof item === 'boolean') return item;
    if (typeof item === 'number') return Number.isFinite(item) ? item : undefined;
    if (typeof item !== 'object' || depth >= MAX_DEPTH || this.ancestors.has(item))
      return undefined;
    const done = this.copies.get(item);
    if (done !== undefined) return done;
    if (isProxyValue(item)) return undefined;
    const copied = this.copyContainer(item, depth);
    if (copied !== undefined) this.copies.set(item, copied);
    return copied;
  }

  private copyContainer(item: object, depth: number): object | undefined {
    const array = Array.isArray(item);
    const prototype: unknown = Object.getPrototypeOf(item);
    const plain = array
      ? isIntrinsicPrototype(prototype, 'Array', this.verified)
      : prototype === null || isIntrinsicPrototype(prototype, 'Object', this.verified);
    if (!plain) return undefined;
    const keys = Reflect.ownKeys(item);
    // The length descriptor, not `item.length`: a Get could run code.
    const length: unknown = array ? Object.getOwnPropertyDescriptor(item, 'length')?.value : 0;
    if (typeof length !== 'number' || (array && keys.length !== length + 1)) return undefined;
    const out: object = array ? [] : prototype === null ? Object.create(null) : {};
    this.ancestors.add(item);
    try {
      for (const key of keys) {
        if (array && key === 'length') continue;
        if (typeof key !== 'string') return undefined;
        if (array && (!/^(0|[1-9]\d*)$/.test(key) || Number(key) >= length)) return undefined;
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (descriptor === undefined || !descriptor.enumerable || !('value' in descriptor))
          return undefined;
        const value = this.copy(descriptor.value, depth + 1);
        if (value === undefined) return undefined;
        // A data property of its own, whatever the key: `__proto__` stays a key.
        Object.defineProperty(out, key, {
          value,
          writable: true,
          enumerable: true,
          configurable: true,
        });
      }
      return out;
    } finally {
      this.ancestors.delete(item);
    }
  }
}

function isIntrinsicPrototype(
  proto: unknown,
  name: IntrinsicName,
  verified: WeakSet<object>,
): boolean {
  if (proto === LOCAL[name]) return true;
  if (typeof proto !== 'object' || proto === null || isProxyValue(proto)) return false;
  if (verified.has(proto)) return true;
  const parent: unknown = Object.getPrototypeOf(proto);
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

let proxyCheck: ((candidate: unknown) => boolean) | null | undefined;

/** Node's `util.types.isProxy`, looked up once; runs no trap. False where absent. */
function isProxyValue(value: object): boolean {
  if (proxyCheck === undefined) {
    proxyCheck = null;
    try {
      const host = (globalThis as { process?: { getBuiltinModule?: (id: string) => unknown } })
        .process;
      const util = host?.getBuiltinModule?.('node:util') as
        | { types?: { isProxy?: (candidate: unknown) => boolean } }
        | undefined;
      const check = util?.types?.isProxy;
      if (typeof check === 'function') proxyCheck = check;
    } catch {
      proxyCheck = null;
    }
  }
  return proxyCheck !== null && proxyCheck(value);
}
