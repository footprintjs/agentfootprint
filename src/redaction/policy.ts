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

import type { RedactionMarks, RedactionPolicy } from 'footprintjs';

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

/**
 * The policy a paused run's MARKS stand for: the names its rule kept out of
 * every record — a key a policy selected when it was written, a per-call mark,
 * a mapper's taint — carried by the pause's checkpoint
 * (`FlowchartCheckpoint.redactionMarks`, names only). A resumed leg is covered
 * by them (`RunnerBase · emitPauseResume`), so a value its first leg kept out
 * stays out of the second leg's records even when the per-run `redact` that
 * selected it is not passed again. `undefined` when the checkpoint carries none.
 */
export function policyOfMarks(marks: RedactionMarks | undefined): RedactionPolicy | undefined {
  if (marks === undefined) return undefined;
  const keys = uniqueStrings(marks.keys.filter((key) => typeof key === 'string'));
  const fields =
    marks.fields === undefined
      ? undefined
      : Object.fromEntries(
          Object.entries(marks.fields)
            .filter(([, paths]) => Array.isArray(paths) && paths.length > 0)
            .map(([key, paths]) => [key, uniqueStrings([...paths])]),
        );
  const hasFields = fields !== undefined && Object.keys(fields).length > 0;
  if (keys.length === 0 && !hasFields) return undefined;
  return Object.freeze({
    ...(keys.length > 0 && { keys }),
    ...(hasFields && { fields }),
  }) as RedactionPolicy;
}

/** A RegExp as plain data. */
interface CarriedPattern {
  readonly source: string;
  readonly flags: string;
}

/** A policy's selectors as plain data (`keys`, `patterns`, `fields`). */
interface CarriedSelectors {
  readonly keys?: readonly string[];
  readonly patterns?: readonly CarriedPattern[];
  readonly fields?: Readonly<Record<string, readonly string[]>>;
}

/**
 * A redaction policy as plain data — names, and each pattern as a REFERENCE
 * (its source and flags) to a RegExp the reading side must already hold — so
 * the policy a caller handed ONE run
 * (`agent.run(input, { redact })`) can ride that run's state into its pause
 * checkpoint and cover the resumed leg (`Agent · resume`), wherever and
 * whenever it resumes. Written by the seed stage (`AgentState.runRedaction`).
 */
export interface CarriedRedactionPolicy extends CarriedSelectors {
  readonly emitPatterns?: readonly CarriedPattern[];
  readonly diagnostics?: CarriedSelectors;
  /**
   * The conversation vocabulary's version the policy was built under, when it
   * keeps the conversation out (`conversation.ts` · `carriedRunPolicy`) — a
   * resumed leg under another version is covered by the current list too.
   */
  readonly vocabulary?: string;
}

/**
 * The vocabulary version a carried policy recorded ({@link CarriedRedactionPolicy}),
 * or `undefined` when it recorded none. Read only after
 * {@link policyFromCarried} accepted the same value — which refuses one whose
 * version is not text.
 */
export function carriedVocabularyOf(value: unknown): string | undefined {
  if (value === null || typeof value !== 'object') return undefined;
  const version = (value as { vocabulary?: unknown }).vocabulary;
  return typeof version === 'string' ? version : undefined;
}

/** `policy` as plain data ({@link CarriedRedactionPolicy}). */
export function carriedRedactionPolicy(policy: RedactionPolicy): CarriedRedactionPolicy {
  const selectors = (from: Pick<RedactionPolicy, 'keys' | 'patterns' | 'fields'>) => ({
    ...(from.keys !== undefined && { keys: [...from.keys] }),
    ...(from.patterns !== undefined && { patterns: from.patterns.map(carriedPattern) }),
    ...(from.fields !== undefined && {
      fields: Object.fromEntries(Object.entries(from.fields).map(([k, v]) => [k, [...v]])),
    }),
  });
  return {
    ...selectors(policy),
    ...(policy.emitPatterns !== undefined && {
      emitPatterns: policy.emitPatterns.map(carriedPattern),
    }),
    ...(policy.diagnostics !== undefined && { diagnostics: selectors(policy.diagnostics) }),
  };
}

/** Why a carried policy cannot cover a resumed leg ({@link CarriedPolicyError}). */
export type CarriedPolicyRefusal = 'unreadable' | 'unknown-pattern';

/**
 * Thrown by {@link policyFromCarried}: the checkpoint's policy is not one this
 * library wrote (`'unreadable'`), or it names a pattern the resuming side does
 * not hold (`'unknown-pattern'`). The message names no policy, pattern or value.
 */
export class CarriedPolicyError extends Error {
  readonly refusal: CarriedPolicyRefusal;
  constructor(refusal: CarriedPolicyRefusal, site: string) {
    super(
      refusal === 'unreadable'
        ? `${site}: the checkpoint's \`runRedaction\` is not a redaction policy this library wrote ` +
            `— refusing to resume a run whose records the policy it was given could not keep covered.`
        : `${site}: the checkpoint's \`runRedaction\` names a pattern the resuming side does not ` +
            `hold — a pattern is never compiled from a checkpoint. Declare it on the agent, or pass ` +
            `the run's \`redact\` to the resume.`,
    );
    this.name = 'CarriedPolicyError';
    this.refusal = refusal;
  }
}

/**
 * The policy a checkpoint carried ({@link carriedRedactionPolicy}), rebuilt and
 * checked like any declared one. `undefined` when it carries none. A value
 * that is not one this library wrote is REFUSED: a resumed leg whose records
 * its policy could not keep covered must not start.
 *
 * A PATTERN IS NEVER COMPILED FROM A CHECKPOINT. A checkpoint is data that can
 * come back from storage someone else controls, and a pattern compiled from it
 * could be one built to hang the matcher. A carried pattern is a REFERENCE —
 * its source and flags — to a RegExp the resuming side already holds: one of
 * `trusted` (the agent's declared policy, the policy the resume names, the
 * library's own vocabulary), matched exactly and handed back as THAT object. A
 * reference to one it does not hold is refused (`'unknown-pattern'`). Keys and
 * fields are names, matched exactly, and carried as they are.
 *
 * @param site    where it is read, for the message (`Agent.resume`)
 * @param trusted the policies whose patterns a carried reference may name
 * @throws CarriedPolicyError
 */
export function policyFromCarried(
  value: unknown,
  site: string,
  trusted: readonly (RedactionPolicy | undefined)[],
): RedactionPolicy | undefined {
  if (value === undefined || value === null) return undefined;
  const refuse = (refusal: CarriedPolicyRefusal = 'unreadable'): never => {
    throw new CarriedPolicyError(refusal, site);
  };
  if (typeof value !== 'object' || Array.isArray(value)) refuse();
  const record = value as Record<string, unknown>;
  const held = heldPatterns(trusted);
  const patterns = (list: unknown): RegExp[] | undefined => {
    if (list === undefined) return undefined;
    if (!Array.isArray(list)) return refuse();
    return list.map((item) => {
      const p = item as { source?: unknown; flags?: unknown } | null;
      if (
        p === null ||
        typeof p !== 'object' ||
        typeof p.source !== 'string' ||
        typeof p.flags !== 'string'
      ) {
        return refuse();
      }
      return held.get(patternKey(p.source, p.flags)) ?? refuse('unknown-pattern');
    });
  };
  const selectors = (from: Record<string, unknown>) => {
    const keys = from['keys'];
    const fields = from['fields'];
    const rebuilt = patterns(from['patterns']);
    return {
      ...(keys !== undefined && { keys: keys as string[] }),
      ...(rebuilt !== undefined && { patterns: rebuilt }),
      ...(fields !== undefined && { fields: fields as Record<string, string[]> }),
    };
  };
  const diagnostics = record['diagnostics'];
  if (diagnostics !== undefined && (diagnostics === null || typeof diagnostics !== 'object'))
    refuse();
  const vocabulary = record['vocabulary'];
  if (vocabulary !== undefined && typeof vocabulary !== 'string') refuse();
  const emit = patterns(record['emitPatterns']);
  const policy = {
    ...selectors(record),
    ...(emit !== undefined && { emitPatterns: emit }),
    ...(diagnostics !== undefined && {
      diagnostics: selectors(diagnostics as Record<string, unknown>),
    }),
  };
  try {
    assertRedactionPolicy(policy, site);
  } catch {
    return refuse();
  }
  return Object.freeze(policy) as RedactionPolicy;
}

// ─── internals ────────────────────────────────────────────────────────

function carriedPattern(pattern: RegExp): CarriedPattern {
  return { source: pattern.source, flags: pattern.flags };
}

/** A pattern's identity as a carried reference names it: its flags and its source. */
function patternKey(source: string, flags: string): string {
  return `${flags}\u0000${source}`;
}

/** Every RegExp `policies` hold — state, emit and diagnostic selectors — by {@link patternKey}. */
function heldPatterns(policies: readonly (RedactionPolicy | undefined)[]): Map<string, RegExp> {
  const held = new Map<string, RegExp>();
  const add = (list: readonly RegExp[] | undefined): void => {
    for (const re of list ?? []) {
      if (re instanceof RegExp && !held.has(patternKey(re.source, re.flags))) {
        held.set(patternKey(re.source, re.flags), re);
      }
    }
  };
  for (const policy of policies) {
    if (policy === undefined) continue;
    add(policy.patterns);
    add(policy.emitPatterns);
    add(policy.diagnostics?.patterns);
  }
  return held;
}

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

/**
 * Whether `policy` names anything at all — a key, a pattern, a field, an
 * event name or a diagnostic selector. Every policy the library accepts does
 * (`assertRedactionPolicy`); a run covered by one serves EVERY event by the
 * value-kind rule (`served.ts`), even when footprintjs's rule has no name to
 * select in it (a policy of event names or diagnostic selectors only).
 *
 * @internal
 */
export function namesAnything(policy: RedactionPolicy | undefined): boolean {
  if (policy === undefined) return false;
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
