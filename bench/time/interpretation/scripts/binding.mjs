// The scope digest (a prototype of design § 8.4, R15): what the person confirms is bound to the
// call that runs. Not product code.
//
// EVERY ARGUMENT IS SCOPE-BEARING BY DEFAULT. The digest covers every argument the call sends,
// except those the tool's declaration explicitly marks `inert` (Tool.search · role: 'inert'). A tool
// with no Tool.search, or a partial one, binds all of its arguments: the default makes an incomplete
// declaration safe, and none is refused. The sampling step is in the digest whatever role its
// argument carries. The digest is a SHA-256 over canonical JSON (sorted keys, no whitespace), so it
// holds no text of the request, and equal scopes give equal digests.
//
// OWN KEYS ONLY, NO PROTOTYPE SETTER. Arguments are read from the call's OWN enumerable keys, each
// value from its own data descriptor (no getter runs), into a null-prototype record. An argument
// named "__proto__" (valid JSON) is an argument like any other: on an ordinary object,
// `bound['__proto__'] = value` would run the inherited setter and drop it from the digest.
import { createHash } from 'node:crypto';

export const BINDING_VERSION = '1.1.0';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');
const own = (o, k) => o !== null && typeof o === 'object' && Object.prototype.hasOwnProperty.call(o, k);

/** The value of an own data property, never a getter's result. An accessor is bound as a marker. */
function ownValue(o, k) {
  const d = Object.getOwnPropertyDescriptor(o, k);
  return d === undefined ? undefined : 'value' in d ? d.value : { '[accessor]': true };
}

/** Canonical JSON: own enumerable keys only, sorted at every depth, no whitespace, no getter run. */
export function canonical(value) {
  if (Array.isArray(value)) {
    return '[' + Array.from({ length: value.length }, (_, i) => canonical(ownValue(value, i))).join(',') + ']';
  }
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(ownValue(value, k))).join(',') + '}';
  }
  return JSON.stringify(value === undefined ? null : value);
}

/** The arguments a declaration marks `inert`: the only ones left out of the digest. */
export function inertArguments(declaration) {
  const args = declaration?.search?.arguments ?? [];
  return new Set(args.filter((a) => a.role === 'inert').map((a) => a.name));
}

/** A hash of the tool's `period` and `search` declarations: a changed declaration is a new scope. */
export function declarationVersion(declaration) {
  return sha256(canonical({ period: declaration?.period ?? null, search: declaration?.search ?? null }));
}

/** What the digest covers: everything the call will run with that the person could have meant. */
export function scopeOf(call, declaration) {
  const inert = inertArguments(declaration);
  const args = call.args ?? {};
  const bound = Object.create(null); // no inherited "__proto__" setter
  for (const name of Object.keys(args)) if (!inert.has(name)) bound[name] = ownValue(args, name);
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
 * again through the batch ask, or refused when nobody can be asked. Nothing proceeds silently.
 */
export function atDispatch(confirmed, call, declaration, { canAsk = true } = {}) {
  const digest = scopeDigest(call, declaration);
  if (confirmed.has(digest)) return { outcome: 'run', digest };
  return { outcome: canAsk ? 'ask-again' : 'refused', digest };
}
