/**
 * policy — the shape check and the union of footprintjs `RedactionPolicy`
 * values. Nothing here decides what is secret: footprintjs's `RedactionRule`
 * is the one owner of that (`footprintjs/advanced` · `RedactionRule`). This
 * file only answers two questions about a policy as DATA:
 *
 *   1. Is it a policy footprintjs can apply, or a typo that would be dropped
 *      in silence? (`assertRedactionPolicy`)
 *   2. When one run is covered by several declared policies — an agent's own,
 *      the members of a composition, the caller that handed one down through a
 *      tool — what is the ONE policy that run applies? (`unionRedactionPolicies`)
 *
 * The union only ever ADDS names. A run that more than one declaration covers
 * masks everything any of them names; no declaration can take away a name
 * another one gave. Over-masking is the safe direction, and it is the only
 * direction a union can move.
 */

import type { RedactionPolicy } from 'footprintjs';

/** The fields footprintjs's `RedactionPolicy` declares (footprintjs 9.43). */
const POLICY_FIELDS = ['keys', 'patterns', 'fields', 'diagnostics', 'emitPatterns'] as const;

/** The fields a `diagnostics` sub-policy declares. */
const DIAGNOSTIC_FIELDS = ['keys', 'patterns', 'fields'] as const;

type Selectors = Pick<RedactionPolicy, 'keys' | 'patterns' | 'fields'>;

/**
 * Refuse a value that is not a policy footprintjs can apply — by name, at the
 * place it was declared, before any run.
 *
 * Refused: a non-object; an unknown field (`key:` for `keys:` would otherwise
 * be ignored and the run would mask nothing); a `keys` entry that is not a
 * non-empty string; a `patterns` / `emitPatterns` entry that is not a RegExp;
 * a FROZEN global or sticky RegExp (footprintjs resets `lastIndex` before each
 * test and cannot on a frozen one, so it would throw mid-run, at the first
 * event); a `fields` map whose values are not lists of non-empty strings; and a
 * policy that names nothing at all — a door set to "redact nothing" reads like
 * protection and is none.
 *
 * @param site where it was declared, for the message (`Agent.create`, …)
 */
export function assertRedactionPolicy(
  policy: unknown,
  site: string,
): asserts policy is RedactionPolicy {
  if (policy === null || typeof policy !== 'object' || Array.isArray(policy)) {
    throw new TypeError(
      `${site}: \`redact\` must be a footprintjs RedactionPolicy object ` +
        `({ keys?, patterns?, fields?, emitPatterns?, diagnostics? }) — got ${describe(policy)}.`,
    );
  }
  checkSelectors(policy as Record<string, unknown>, POLICY_FIELDS, site, 'redact');
  const record = policy as Record<string, unknown>;
  checkPatterns(record['emitPatterns'], site, 'redact.emitPatterns');
  if (record['diagnostics'] !== undefined) {
    const diagnostics = record['diagnostics'];
    if (diagnostics === null || typeof diagnostics !== 'object' || Array.isArray(diagnostics)) {
      throw new TypeError(
        `${site}: \`redact.diagnostics\` must be an object ({ keys?, patterns?, fields? }) — ` +
          `got ${describe(diagnostics)}.`,
      );
    }
    checkSelectors(
      diagnostics as Record<string, unknown>,
      DIAGNOSTIC_FIELDS,
      site,
      'redact.diagnostics',
    );
  }
  if (!namesAnything(policy as RedactionPolicy)) {
    throw new TypeError(
      `${site}: \`redact\` names nothing — no key, pattern, field, emit pattern or diagnostic ` +
        `selector — so it would keep nothing out of any record while reading like it does. Name ` +
        `what must stay out (\`{ keys: ['history'] }\`, \`{ patterns: [/ssn/i] }\`), or drop the option.`,
    );
  }
}

/**
 * The one policy for a run covered by several declarations: every name any of
 * them selects. `undefined` when none is present. A single distinct policy is
 * returned AS IT IS (the same object), so a run covered by one declaration
 * hands footprintjs exactly the object that was declared.
 */
export function unionRedactionPolicies(
  ...policies: readonly (RedactionPolicy | undefined)[]
): RedactionPolicy | undefined {
  const distinct = [...new Set(policies.filter((p): p is RedactionPolicy => p !== undefined))];
  if (distinct.length === 0) return undefined;
  if (distinct.length === 1) return distinct[0];
  const keys = uniqueStrings(distinct.flatMap((p) => p.keys ?? []));
  const patterns = uniqueValues(distinct.flatMap((p) => p.patterns ?? []));
  const emitPatterns = uniqueValues(distinct.flatMap((p) => p.emitPatterns ?? []));
  const fields = unionFields(distinct.map((p) => p.fields));
  const diagnostics = unionSelectors(
    distinct.map((p) => p.diagnostics).filter((d): d is Selectors => d !== undefined),
  );
  return Object.freeze({
    ...(keys.length > 0 && { keys }),
    ...(patterns.length > 0 && { patterns }),
    ...(fields !== undefined && { fields }),
    ...(emitPatterns.length > 0 && { emitPatterns }),
    ...(diagnostics !== undefined && { diagnostics }),
  }) as RedactionPolicy;
}

// ─── internals ────────────────────────────────────────────────────────

function checkSelectors(
  record: Record<string, unknown>,
  allowed: readonly string[],
  site: string,
  label: string,
): void {
  for (const field of Object.keys(record)) {
    if (!allowed.includes(field)) {
      throw new TypeError(
        `${site}: \`${label}.${field}\` is not a RedactionPolicy field — the fields are ` +
          `${allowed.map((f) => `\`${f}\``).join(', ')}. An unknown field would be ignored, ` +
          `and the run would keep in the record what you meant to keep out.`,
      );
    }
  }
  const keys = record['keys'];
  if (keys !== undefined) {
    if (!Array.isArray(keys) || keys.some((k) => typeof k !== 'string' || k.length === 0)) {
      throw new TypeError(`${site}: \`${label}.keys\` must be a list of non-empty strings.`);
    }
  }
  checkPatterns(record['patterns'], site, `${label}.patterns`);
  const fields = record['fields'];
  if (fields !== undefined) {
    if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
      throw new TypeError(
        `${site}: \`${label}.fields\` must be an object of key → list of dot-paths ` +
          `({ customer: ['email', 'address.zip'] }) — got ${describe(fields)}.`,
      );
    }
    for (const [key, paths] of Object.entries(fields as Record<string, unknown>)) {
      if (!Array.isArray(paths) || paths.some((p) => typeof p !== 'string' || p.length === 0)) {
        throw new TypeError(
          `${site}: \`${label}.fields.${key}\` must be a list of non-empty dot-paths.`,
        );
      }
    }
  }
}

function checkPatterns(patterns: unknown, site: string, label: string): void {
  if (patterns === undefined) return;
  if (!Array.isArray(patterns) || patterns.some((p) => !(p instanceof RegExp))) {
    throw new TypeError(`${site}: \`${label}\` must be a list of RegExp.`);
  }
  for (const pattern of patterns as RegExp[]) {
    if ((pattern.global || pattern.sticky) && Object.isFrozen(pattern)) {
      throw new TypeError(
        `${site}: \`${label}\` holds a frozen ${pattern.global ? 'global' : 'sticky'} RegExp ` +
          `(${String(
            pattern,
          )}). footprintjs resets a stateful pattern's \`lastIndex\` before each ` +
          `test and cannot on a frozen one, so it would throw at the first event. Pass a mutable ` +
          `RegExp, or drop the \`g\`/\`y\` flag.`,
      );
    }
  }
}

function namesAnything(policy: RedactionPolicy): boolean {
  const selects = (s: Selectors | undefined): boolean =>
    (s?.keys?.length ?? 0) > 0 ||
    (s?.patterns?.length ?? 0) > 0 ||
    Object.values(s?.fields ?? {}).some((paths) => paths.length > 0);
  return selects(policy) || (policy.emitPatterns?.length ?? 0) > 0 || selects(policy.diagnostics);
}

function unionSelectors(selectors: readonly Selectors[]): Selectors | undefined {
  if (selectors.length === 0) return undefined;
  const keys = uniqueStrings(selectors.flatMap((s) => s.keys ?? []));
  const patterns = uniqueValues(selectors.flatMap((s) => s.patterns ?? []));
  const fields = unionFields(selectors.map((s) => s.fields));
  if (keys.length === 0 && patterns.length === 0 && fields === undefined) return undefined;
  return Object.freeze({
    ...(keys.length > 0 && { keys }),
    ...(patterns.length > 0 && { patterns }),
    ...(fields !== undefined && { fields }),
  });
}

function unionFields(
  maps: readonly (Record<string, string[]> | undefined)[],
): Record<string, string[]> | undefined {
  const merged = new Map<string, string[]>();
  for (const map of maps) {
    for (const [key, paths] of Object.entries(map ?? {})) {
      merged.set(key, uniqueStrings([...(merged.get(key) ?? []), ...paths]));
    }
  }
  return merged.size === 0 ? undefined : Object.fromEntries(merged);
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function uniqueValues<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'an array';
  return typeof value;
}
