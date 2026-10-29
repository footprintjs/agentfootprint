// The scope digest (a prototype of design § 8.4, R15): what the person confirms is bound to the
// call that runs. Not product code.
//
// EVERY ARGUMENT IS SCOPE-BEARING BY DEFAULT. The digest covers every argument the call sends,
// except those the tool's declaration explicitly marks `inert` (Tool.search · role: 'inert'). A tool
// with no Tool.search, or a partial one, binds all of its arguments: the default makes an incomplete
// declaration safe, and none is refused. The sampling step is in the digest whatever role its
// argument carries. The digest is a SHA-256 over canonical JSON (sorted keys, no whitespace), so it
// holds no text of the request, and equal scopes give equal digests.
import { createHash } from 'node:crypto';

export const BINDING_VERSION = '1.0.0';

const sha256 = (s) => createHash('sha256').update(s).digest('hex');

/** Canonical JSON: sorted keys at every depth, no whitespace. */
export function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value !== null && typeof value === 'object') {
    return '{' + Object.keys(value).sort().map((k) => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
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
  const bound = {};
  for (const [name, value] of Object.entries(call.args ?? {})) if (!inert.has(name)) bound[name] = value;
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
  return sha256(canonical(calls.map((c) => scopeDigest(c, declarations[c.tool]))));
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
