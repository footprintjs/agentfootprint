import type { AgentCoreMemoryRecord } from './contract.js';
/**
 * ── Namespace variables: AgentCore's domain, checked here ──
 *
 * From the AgentCore API reference, `ExtractionConfig.namespaceVariables`: at
 * most 5 entries; keys 1–32 characters matching
 * `(?!memoryStrategyId$|actorId$|sessionId$)[a-z][a-z0-9]*`; values 1–64
 * characters matching `[a-z0-9][a-z0-9-_]*`.
 *
 * Checked BEFORE the write rather than left to AgentCore, for one reason: its
 * `ValidationException` may quote the rejected value, and the value names a
 * tenant — a refusal here names the variable and the rule, never the value.
 */
export const MAX_NAMESPACE_VARIABLES = 5;

/** The refusal of a scope-less write or search on a store that requires one. */
export const MISSING_SCOPE = (what: 'write' | 'search'): string =>
  `AgentCoreStore: this ${what} carries no \`namespaceScope\`, and the store requires one — it ` +
  'was built with `requireNamespaceScope: true`, or it has already served scoped calls. It is ' +
  'refused rather than run under a namespace no tenant owns. Scope the memory that made it ' +
  '(`defineMemory({ namespaceScope })`).';

/**
 * Refuse a search namespace that names no place: not a string, empty, or no
 * path segment at all (`''`, `'/'`) — AgentCore matches a prefix, and an empty
 * prefix is every record of the memory.
 */
export function assertNamespace(namespace: unknown): asserts namespace is string {
  if (typeof namespace !== 'string' || pathOf(namespace).replace(/^\//, '') === '') {
    throw new TypeError(
      'AgentCoreStore.search(): `searchNamespace` returned no namespace — an empty prefix ' +
        'matches every record of the memory, so it is refused. Return a namespace with at ' +
        'least one path segment.',
    );
  }
}

export const NAMESPACE_KEY = /^(?!memoryStrategyId$|actorId$|sessionId$)[a-z][a-z0-9]{0,31}$/;

export const NAMESPACE_VALUE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export const NAMESPACE_VALUE_MAX = 64;

/** Refuse, by variable name and rule, a scope AgentCore would reject. */
export function checkNamespaceVariables(scope: Readonly<Record<string, string>>): void {
  const keys = Object.keys(scope);
  if (keys.length > MAX_NAMESPACE_VARIABLES) {
    throw new TypeError(
      `AgentCoreStore: a namespaceScope may carry at most ${MAX_NAMESPACE_VARIABLES} variables ` +
        `(AgentCore's limit); this one has ${keys.length}.`,
    );
  }
  for (const key of keys) {
    if (!NAMESPACE_KEY.test(key)) {
      throw new TypeError(
        `AgentCoreStore: the namespace variable name ${JSON.stringify(key)} is not one ` +
          'AgentCore admits — 1–32 characters, a lowercase letter then lowercase letters or ' +
          'digits (and not memoryStrategyId / actorId / sessionId).',
      );
    }
    const value = scope[key];
    if (typeof value !== 'string' || !NAMESPACE_VALUE.test(value)) {
      throw new TypeError(
        `AgentCoreStore: the value of namespace variable ${JSON.stringify(key)} is not one ` +
          'AgentCore admits — 1–64 characters of [a-z0-9-_], starting with a letter or digit. ' +
          'It is not quoted here: it names a tenant. Map your id with ' +
          '`agentCoreNamespaceValue(...)`, which is one-to-one and fits this alphabet.',
      );
    }
  }
}

/**
 * A scope as the store uses it: read ONCE into a frozen plain copy, so the value
 * that is checked is the value that is sent — a getter, or an object the
 * caller's resolver reuses and edits, cannot change it between the two.
 */
export function frozenScope(
  scope: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  return Object.freeze(Object.fromEntries(Object.entries(scope)));
}

/**
 * A search under a namespace scope must stay inside it — checked by RENDERING,
 * not by looking: `searchNamespace` is asked again with every value replaced
 * by a canary, and the two namespaces must agree segment for segment — each
 * canary's segment holding exactly that variable's real value, every other
 * segment the same literal. So a namespace that ignores the scope, puts a
 * variable inside a segment, or merely happens to contain a value elsewhere
 * (a tenant named like a literal segment) is refused, naming the variable and
 * never quoting its value.
 */
export function assertSearchWithinScope(
  render: (namespaceScope: Readonly<Record<string, string>>) => string,
  namespace: string,
  namespaceScope: Readonly<Record<string, string>>,
): void {
  const variables = Object.keys(namespaceScope);
  const nonce = globalThis.crypto.randomUUID();
  const canaries = variables.map((_, i) => `canary${i}-${nonce}`);
  const canaryScope = Object.fromEntries(variables.map((v, i) => [v, canaries[i] as string]));
  const real = namespace.split('/');
  const probe = render(canaryScope).split('/');
  const refuse = (variable: string): never => {
    throw new TypeError(
      `AgentCoreStore.search(): the namespace searched does not hold namespace variable ` +
        `${JSON.stringify(variable)} as a path segment of its own, so it could read records ` +
        'filed under another tenant’s scope. Build `searchNamespace` from the ' +
        '`namespaceScope` it is handed, one variable per segment (e.g. ' +
        '"/tenants/{tenantid}/actors/{actorId}/facts").',
    );
  };
  const seen = new Set<string>();
  if (real.length !== probe.length) refuse(variables[0] ?? 'namespaceScope');
  probe.forEach((segment, i) => {
    const at = canaries.indexOf(segment);
    if (at === -1) {
      if (real[i] !== segment) refuse(variables[0] ?? 'namespaceScope');
      return;
    }
    const variable = variables[at] as string;
    if (real[i] !== namespaceScope[variable]) refuse(variable);
    seen.add(variable);
  });
  for (const variable of variables) if (!seen.has(variable)) refuse(variable);
}

/**
 * Does `namespace` hold `actorId` as whole path segments? (An actor id can
 * itself contain `/`, its escape.)
 */
export function holdsActor(namespace: string, actorId: string): boolean {
  return `/${pathOf(namespace).replace(/^\//, '')}/`.includes(`/${actorId}/`);
}

/**
 * A caller's value — a tenant id — in the alphabet AgentCore admits for a
 * namespace variable, ONE-TO-ONE.
 *
 * The alphabet is narrow (`[a-z0-9][a-z0-9-_]*`, at most 64 characters), so the
 * easy mappings fold: lowercasing merges `Acme` with `acme`, stripping merges
 * `a.b` with `ab`, truncating merges any two long ids that share a prefix — and
 * a fold here files two tenants' derived records under one namespace. This is
 * the same law as the actor and session ids above, in this alphabet:
 *
 *   - `[a-z0-9-]` passes through; every other UTF-16 code unit becomes `_`
 *     plus its four lowercase hex digits (fixed width, so it decodes);
 *   - every value starts with `v`, so one whose first character had to be
 *     escaped still starts with a letter — and no two inputs share an output;
 *   - every value ENDS with `_z`, which cannot occur inside an encoding (an
 *     `_` there is always followed by four hex digits) — so no tenant's value
 *     is the beginning of another's (`1` and `12` would otherwise be `v1` and
 *     `v12`), and a prefix match over namespaces cannot reach a neighbour;
 *   - too long is REFUSED, never truncated.
 *
 * `agentCoreNamespaceValue('acme')` is `'vacme_z'`; `'Acme'` is `'v_0041cme_z'`.
 * Use the same mapping wherever the namespace is read back (`searchNamespace`).
 *
 * @throws {TypeError} for an empty value — an absent tenant is not a tenant
 * @throws {RangeError} when the encoding exceeds 64 characters (the value is
 *   not quoted: it names a tenant)
 */
export function agentCoreNamespaceValue(raw: string): string {
  if (typeof raw !== 'string' || raw === '') {
    throw new TypeError(
      'agentCoreNamespaceValue: needs a non-empty string — an absent tenant is not a tenant, ' +
        'and giving it a stand-in value would share that namespace with whoever is named it.',
    );
  }
  let out = 'v';
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i] as string;
    out += /[a-z0-9-]/.test(ch) ? ch : `_${raw.charCodeAt(i).toString(16).padStart(4, '0')}`;
  }
  out += '_z';
  if (out.length > NAMESPACE_VALUE_MAX) {
    throw new RangeError(
      `agentCoreNamespaceValue: this value encodes to ${out.length} characters, over AgentCore's ` +
        `${NAMESPACE_VALUE_MAX}. It is not truncated to fit — two ids truncated to one value ` +
        'share a namespace. The value is not quoted here: it names a tenant.',
    );
  }
  return out;
}

/** A namespace compared as a path: repeated `/` collapsed, a trailing one dropped. */
export function pathOf(namespace: string): string {
  return namespace.replace(/\/{2,}/g, '/').replace(/\/$/, '');
}

/** What the start of another actor's id extending this one looks like. */
export const ACTOR_ESCAPE_AHEAD = /^[0-9A-F]{4}/;

/**
 * Is `record` filed AT `asked` or under it? Compared on whole path segments —
 * repeated and trailing `/` ignored on both sides — because AgentCore's
 * `namespace` filter is a string prefix, and `/tenants/v1` must not admit
 * `/tenants/v12`.
 *
 * One more case, because an actor id can hold a `/`: its escape is `/` + four
 * hex digits (`bob@x.com` → `bob/0040x/002Ecom`), so another actor's id can
 * EXTEND this one by whole segments (`bob@x.com.au` adds `/002Eau`). When the
 * namespace asked for ends with this identity's `actorId`, a record filed under
 * a continuation that starts with four uppercase hex digits may be that other
 * actor's — and is dropped. A sub-namespace of your own that starts that way
 * is dropped too (put a literal segment after `{actorId}`), never served across
 * actors. That literal must not itself start with four uppercase hex digits,
 * or the guard cannot tell it from another actor's id.
 */
export function filedUnder(record: AgentCoreMemoryRecord, asked: string, actorId: string): boolean {
  const base = pathOf(asked);
  const guardActor = base.endsWith(actorId);
  const filed = record.namespaces ?? (record.namespace !== undefined ? [record.namespace] : []);
  return filed.some((ns) => {
    const n = pathOf(ns);
    if (n === base) return true;
    if (!n.startsWith(`${base}/`)) return false;
    return !(guardActor && ACTOR_ESCAPE_AHEAD.test(n.slice(base.length + 1)));
  });
}
