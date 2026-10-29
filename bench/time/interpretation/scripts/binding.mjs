// The scope digest (a prototype of design § 8.4, R15): what the person confirms is bound to the
// call that runs. Not product code.
//
// EVERY ARGUMENT IS SCOPE-BEARING BY DEFAULT. The digest covers every argument the call sends,
// except those the app's LOCAL declaration marks `inert` (it changes the bytes, not the ground) or
// `continuation` (a page number, cursor or offset: a slice of the same confirmed scope). A
// declaration is local only when it says so (`origin: 'local'`). A remote one (over MCP, or from a
// ToolProvider) exempts nothing: its marks are ignored, not refused, so its arguments stay bound.
// A tool with no Tool.search binds all of its arguments, and an argument a declaration leaves out
// stays bound (defence in depth: the library refuses a partial declaration today). The sampling step
// is in the digest whatever role its argument carries. The digest is a SHA-256 over canonical JSON
// (sorted keys, no whitespace), so it holds no text of the request, and equal scopes give equal
// digests. A continuation left out means page 2 of a confirmed call keeps its digest, while any
// other change still makes a new one.
//
// VALIDATE FIRST; DISPATCH THE SNAPSHOT. Every argument is checked as JSON data BEFORE any role
// leaves one out of the digest: a role waives membership in the digest, never the data contract.
// The check reads own data descriptors only, so no getter and no toJSON runs. It refuses anything
// that is not JSON data (an accessor, a function, a Date or a Map, a non-finite number, undefined,
// a hole, arguments with an inherited prototype), a cycle, and data deeper or larger than its
// bounds, always as a refusal, never a thrown RangeError. The check copies as it goes: atDispatch
// hands back that plain-data copy, and the copy is what runs. Nothing reads the caller's object
// after the check, so nothing it does later can change what was bound.
//
// OWN KEYS ONLY, NO PROTOTYPE SETTER. Keys are the object's own enumerable keys, copied with
// Object.defineProperty, and the digest's record has a null prototype. An argument named
// "__proto__" (valid JSON) is an argument like any other: on an ordinary object,
// `bound['__proto__'] = value` would run the inherited setter and drop it from the digest.
import { createHash } from 'node:crypto';

export const BINDING_VERSION = '1.4.0';

/** The check's bounds: deeper or larger data is refused, so the check never exhausts the stack. */
export const MAX_DEPTH = 64;
export const MAX_VALUES = 100_000;

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** A value the digest cannot bind: it is not JSON data, so the digest could not say what is sent. */
export class NotBindable extends Error {}

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && [Object.prototype, null].includes(Object.getPrototypeOf(v));

/** The value of an own data property. An accessor is refused without being called. */
function ownValue(o, k, path) {
  const d = Object.getOwnPropertyDescriptor(o, k);
  if (d !== undefined && !('value' in d)) throw new NotBindable(`${path} is an accessor, not data`);
  return d?.value;
}

/**
 * A plain-data copy of JSON data, or a refusal. Reads own data descriptors only; a cycle (a value
 * that contains itself) is refused, while a value shared by two branches is copied twice, as JSON
 * would. Bounded by MAX_DEPTH and MAX_VALUES.
 */
export function plainData(value, path = 'value') {
  return copy(value, path, new Set(), 0, { left: MAX_VALUES });
}

function copy(value, path, ancestors, depth, budget) {
  if (--budget.left < 0) throw new NotBindable(`more than ${MAX_VALUES} values`);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (Number.isFinite(value)) return value;
    throw new NotBindable(`${path} is not a finite number`);
  }
  if (typeof value !== 'object') throw new NotBindable(`${path} is ${value === undefined ? 'undefined' : `a ${typeof value}`}, not JSON data`);
  if (ancestors.has(value)) throw new NotBindable(`${path} contains itself (a cycle)`);
  if (depth >= MAX_DEPTH) throw new NotBindable(`${path} is nested deeper than ${MAX_DEPTH} levels`);
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) throw new NotBindable(`${path} is not a plain array`);
      const out = [];
      for (let i = 0; i < value.length; i++) out.push(copy(ownValue(value, String(i), `${path}[${i}]`), `${path}[${i}]`, ancestors, depth + 1, budget));
      return out;
    }
    if (!isPlainObject(value)) throw new NotBindable(`${path} is an object that is not plain data`);
    const out = {};
    for (const key of Object.keys(value)) {
      const at = `${path}.${key}`;
      Object.defineProperty(out, key, { value: copy(ownValue(value, key, at), at, ancestors, depth + 1, budget), enumerable: true, writable: true, configurable: true });
    }
    return out;
  } finally {
    ancestors.delete(value);
  }
}

/** Canonical JSON: the data is checked and copied first, then written with sorted keys, no whitespace. */
export function canonical(value) {
  return written(plainData(value));
}

function written(data) {
  if (Array.isArray(data)) return '[' + data.map(written).join(',') + ']';
  if (data !== null && typeof data === 'object') {
    return '{' + Object.keys(data).sort().map((k) => JSON.stringify(k) + ':' + written(data[k])).join(',') + '}';
  }
  return JSON.stringify(data);
}

/** The roles a LOCAL declaration may use to leave an argument out of the digest. */
const UNBOUND_ROLES = new Set(['inert', 'continuation']);

/**
 * The arguments left out of the digest: those the app's local declaration marks `inert` or
 * `continuation`. A remote declaration's marks are ignored, not refused: every argument stays bound.
 */
export function unboundArguments(declaration) {
  if (declaration?.origin !== 'local') return new Set();
  const args = declaration?.search?.arguments ?? [];
  return new Set(args.filter((a) => UNBOUND_ROLES.has(a.role)).map((a) => a.name));
}

/** A hash of the tool's `period` and `search` declarations: a changed declaration is a new scope. */
export function declarationVersion(declaration) {
  return sha256(canonical({ period: declaration?.period ?? null, search: declaration?.search ?? null }));
}

/** Every argument of the call, checked and copied as plain data, whatever its role. This copy runs. */
function argumentsOf(call) {
  const args = call.args ?? {};
  if (!isPlainObject(args)) throw new NotBindable('the arguments are not a plain object');
  return plainData(args, 'args');
}

/** What the digest covers: everything the call will run with that the person could have meant. */
export function scopeOf(call, declaration, checked = argumentsOf(call)) {
  const unbound = unboundArguments(declaration);
  const bound = Object.create(null); // no inherited "__proto__" setter
  for (const name of Object.keys(checked)) if (!unbound.has(name)) bound[name] = checked[name];
  return {
    tool: call.tool,
    declaration: declarationVersion(declaration),
    args: bound,
    executed: call.executed ?? null, // { from, to, zone }: the bounds the call will send
    sampling: call.sampling ?? null, // the step, whatever role its argument carries
    mention: call.mention ?? null, // the requested mention the person's answer settles
  };
}

export function scopeDigest(call, declaration) {
  return sha256(canonical(scopeOf(call, declaration)));
}

/** A batch's digest covers its calls' digests, in order: a member added or removed is a new batch. */
export function batchDigest(calls, declarations) {
  return sha256(canonical(calls.map((c) => scopeDigest(c, own(declarations, c.tool) ? declarations[c.tool] : undefined))));
}

/**
 * At dispatch: the call runs only when its digest equals a confirmed one. Otherwise it is asked
 * again through the batch ask, or refused when nobody can be asked, or when its arguments are not
 * JSON data at all. Nothing proceeds silently. `args` is the checked plain-data copy: the call that
 * runs (or is asked about) sends that copy, never the caller's object.
 */
export function atDispatch(confirmed, call, declaration, { canAsk = true } = {}) {
  let checked;
  let digest;
  try {
    checked = argumentsOf(call);
    digest = sha256(canonical(scopeOf(call, declaration, checked)));
  } catch (error) {
    if (error instanceof NotBindable) return { outcome: 'refused', digest: null, why: error.message };
    throw error;
  }
  if (confirmed.has(digest)) return { outcome: 'run', digest, args: checked };
  return canAsk ? { outcome: 'ask-again', digest, args: checked } : { outcome: 'refused', digest };
}
