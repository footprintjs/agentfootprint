/**
 * The bounded audit chain's runtime boundary, swept over EVERY position of
 * EVERY shape it applies — each registered event's, and each record's meta —
 * one damage at a time, through the real strategy.
 *
 * WHY. A shape is checked against the payload TYPES at compile time and by the
 * type walker (`test/type-regressions/AuditBoundingDepth.test.ts`). Neither can
 * see what ARRIVES: structural typing lets an object carry an undeclared child,
 * and an untyped emitter can put any value at any leaf. The boundary is real
 * only if every rule checks the value it is handed. This sweep hands each one
 * what its declared kind forbids — so no type can satisfy it.
 *
 * HOW. The positions and a valid value for each are read from the RULE TREE
 * (`ruleKind`), never from the types, so the sweep covers exactly what the
 * shapes declare. At each position, alone, with every other field valid:
 *
 *   - a WRONG KIND: a string, a list or an object holding the canary, wherever
 *     the position's rule does not accept that kind;
 *   - a NON-MEMBER: a string outside an enum's listed words;
 *   - an UNDECLARED CHILD, on every object a shape bounds: a canary string and a
 *     canary object under a name the shape does not declare, and under every
 *     name `Object.prototype` holds.
 *
 * WHAT A GREEN RUN PROVES:
 *
 *   1. No canary survives anywhere — not at the kept-by-contract exceptions
 *      either: each exception keeps a value of its declared kind (a summary, a
 *      reason word, a name) and checks it like every other leaf.
 *   2. Every key that arrives is an own key of the record, a name
 *      `Object.prototype` holds included — never dropped, never a prototype.
 *   3. Every damaged record is recorded, and the whole chain verifies.
 *   4. The kept-by-contract exceptions sit exactly where the pin says: one
 *      named list, reviewed when it grows.
 */
import { describe, expect, it } from 'vitest';

import {
  auditExport,
  verifyAuditBundle,
  type AuditBundle,
  type AuditRecord,
} from '../../src/adapters/observability/audit';
import { ruleKind, type BoundRule } from '../../src/adapters/observability/auditBounding';
import { boundMeta, eventShapes } from '../../src/adapters/observability/auditShapes';
import type { AgentfootprintEvent } from '../../src/events/registry';

const CANARY = 'SWEEP-CANARY';
const INHERITED = Object.getOwnPropertyNames(Object.prototype).sort();
/** Names no shape declares: one plain, and every name `Object.prototype` holds. */
const UNDECLARED = ['undeclaredChild', ...INHERITED];

type Seg = string | number;
type ValueKind = 'string' | 'number' | 'boolean' | 'null' | 'array' | 'object' | 'other';

const kindOf = (value: unknown): ValueKind =>
  value === null
    ? 'null'
    : Array.isArray(value)
    ? 'array'
    : typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      typeof value === 'object'
    ? (typeof value as ValueKind)
    : 'other';

/** The value kinds a rule accepts at its own position (a marker accepts none: it keeps nothing). */
function validKinds(rule: BoundRule): Set<ValueKind> {
  const k = ruleKind(rule);
  switch (k?.kind) {
    case 'leaf':
      return new Set([k.accepts]);
    case 'oneOf':
      return new Set([...k.values].map(kindOf));
    case 'shape':
    case 'record':
      return new Set(['object']);
    case 'list':
      return new Set(['array']);
    case 'orList':
      return new Set<ValueKind>(['array', ...validKinds(k.item)]);
    case 'nullOr':
      return new Set<ValueKind>(['null', ...validKinds(k.inner)]);
    case 'either':
      return new Set(k.alternatives.flatMap((alt) => [...validKinds(alt)]));
    case 'when':
      return new Set([...validKinds(k.then), ...validKinds(k.otherwise)]);
    case 'byContract':
      return validKinds(k.inner);
    default:
      return new Set(); // a marker, or a rule that does not say what it is: everything is damage
  }
}

/** Whether ANY string is kept at this position (a name, an id) — only members, for an enum. */
function keepsAnyString(rule: BoundRule): boolean {
  const k = ruleKind(rule);
  switch (k?.kind) {
    case 'leaf':
      return k.accepts === 'string';
    case 'orList':
      return keepsAnyString(k.item);
    case 'nullOr':
      return keepsAnyString(k.inner);
    case 'either':
      return k.alternatives.some(keepsAnyString);
    case 'when':
      return keepsAnyString(k.then) || keepsAnyString(k.otherwise);
    case 'byContract':
      return keepsAnyString(k.inner);
    default:
      return false;
  }
}

/** A value the rule accepts, built from the rule tree alone. */
function sampleOf(rule: BoundRule, depth = 0): unknown {
  if (depth > 24) throw new Error('rule tree deeper than 24');
  const k = ruleKind(rule);
  switch (k?.kind) {
    case 'leaf':
      return k.accepts === 'number' ? 7 : k.accepts === 'boolean' ? true : 'ok-id';
    case 'oneOf':
      return [...k.values][0];
    case 'shape':
      return Object.fromEntries([...k.fields].map(([name, r]) => [name, sampleOf(r, depth + 1)]));
    case 'list':
      return [sampleOf(k.item, depth + 1)];
    case 'record':
      return { k: sampleOf(k.value, depth + 1) };
    case 'orList':
      return sampleOf(k.item, depth + 1);
    case 'nullOr':
      return sampleOf(k.inner, depth + 1);
    case 'either':
      return sampleOf(k.alternatives[0]!, depth + 1);
    case 'when':
      return sampleOf(k.then, depth + 1);
    case 'byContract':
      return sampleOf(k.inner, depth + 1);
    default:
      return 'content';
  }
}

/** The containers reachable at this rule's own position (through choices and exceptions). */
function structuresAt(rule: BoundRule): BoundRule[] {
  const k = ruleKind(rule);
  switch (k?.kind) {
    case 'shape':
    case 'list':
    case 'record':
      return [rule];
    case 'orList':
      return [rule, ...structuresAt(k.item)];
    case 'nullOr':
      return structuresAt(k.inner);
    case 'either':
      return k.alternatives.flatMap(structuresAt);
    case 'when':
      return [...structuresAt(k.then), ...structuresAt(k.otherwise)];
    case 'byContract':
      return structuresAt(k.inner);
    default:
      return [];
  }
}

const withOwn = (base: unknown, key: string, value: unknown): Record<string, unknown> => ({
  ...(base as Record<string, unknown>),
  ...Object.fromEntries([[key, value]]),
});

interface Damage {
  /** Where the damage sits, from the rule's root. */
  readonly at: readonly Seg[];
  /** The whole value, with that one damage. */
  readonly value: unknown;
  /** Keys that must be own keys of the bounded object at `at` (a key sweep), or none. */
  readonly ownKeys?: readonly string[];
}

/** Every single damage of a value this rule bounds. */
function* damagesOf(rule: BoundRule, depth = 0): Generator<Damage> {
  if (depth > 24) throw new Error('rule tree deeper than 24');
  const valid = validKinds(rule);
  for (const wrong of [CANARY, [CANARY], { undeclaredChild: CANARY }]) {
    if (!valid.has(kindOf(wrong))) yield { at: [], value: wrong };
  }
  // A string where only an enum's members are valid.
  if (valid.has('string') && !keepsAnyString(rule)) yield { at: [], value: CANARY };

  for (const structure of structuresAt(rule)) {
    const k = ruleKind(structure)!;
    if (k.kind === 'shape') {
      const base = sampleOf(structure, depth + 1);
      for (const name of UNDECLARED) {
        yield { at: [], value: withOwn(base, name, CANARY) };
        yield { at: [], value: withOwn(base, name, { prompt: CANARY }) };
      }
      // Every name `Object.prototype` holds, at once, beside the valid fields.
      yield {
        at: [],
        value: { ...(base as object), ...Object.fromEntries(INHERITED.map((n) => [n, 'x'])) },
        ownKeys: INHERITED,
      };
      for (const [name, field] of k.fields) {
        for (const d of damagesOf(field, depth + 1)) {
          yield { ...d, at: [name, ...d.at], value: withOwn(base, name, d.value) };
        }
      }
    } else if (k.kind === 'list' || k.kind === 'orList') {
      const item = k.item;
      const ok = sampleOf(item, depth + 1);
      for (const d of damagesOf(item, depth + 1)) {
        yield { ...d, at: [1, ...d.at], value: [ok, d.value] };
      }
    } else if (k.kind === 'record') {
      const ok = sampleOf(k.value, depth + 1);
      for (const d of damagesOf(k.value, depth + 1)) {
        yield { ...d, at: ['k2', ...d.at], value: { k: ok, k2: d.value } };
      }
      yield { at: [], value: withOwn({ k: ok }, '__proto__', ok), ownKeys: ['k', '__proto__'] };
    }
  }
}

function envelope(type: string, payload: unknown, meta?: unknown): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: meta ?? {
      wallClockMs: 1,
      runOffsetMs: 0,
      runtimeStageId: 'stage#1',
      subflowPath: [],
      compositionPath: [],
      runId: 'run-sweep',
    },
  } as unknown as AgentfootprintEvent;
}

const at = (value: unknown, path: readonly Seg[]): unknown =>
  path.reduce<unknown>(
    (node, seg) =>
      node !== null && typeof node === 'object' && Object.hasOwn(node, seg)
        ? (node as Record<string | number, unknown>)[seg]
        : undefined,
    value,
  );

interface SweepResult {
  readonly damages: number;
  readonly survivors: string[];
  readonly lostKeys: string[];
  readonly missing: number;
  readonly segments: AuditBundle[];
}

/** Feed every damage of `rule` through a fresh strategy; `read` picks what the rule bounded. */
function sweep(
  rule: BoundRule,
  feed: (value: unknown) => AgentfootprintEvent,
  read: (record: AuditRecord) => unknown,
  label: string,
): SweepResult {
  const audit = auditExport({ includeTokenEvents: true });
  const segments: AuditBundle[] = [];
  const survivors: string[] = [];
  const lostKeys: string[] = [];
  let damages = 0;
  let missing = 0;
  for (const damage of damagesOf(rule)) {
    damages += 1;
    audit.exportEvent(feed(damage.value));
    const segment = audit.drain();
    segments.push(segment);
    const record = segment.records.at(-1);
    if (record === undefined || record.eventType === 'audit.genesis') {
      missing += 1;
      continue;
    }
    const where = `${label} @ ${damage.at.join('.') || '(root)'}`;
    if (damage.ownKeys === undefined) {
      if (JSON.stringify(record).includes(CANARY))
        survivors.push(`${where} ← ${JSON.stringify(damage.value).slice(0, 120)}`);
      continue;
    }
    const bounded = at(read(record), damage.at);
    const own = bounded !== null && typeof bounded === 'object' ? bounded : {};
    const lost = damage.ownKeys.filter((key) => !Object.hasOwn(own, key));
    if (lost.length > 0 || Object.getPrototypeOf(own) !== Object.prototype)
      lostKeys.push(`${where}: ${lost.join(', ') || 'prototype changed'}`);
  }
  return { damages, survivors, lostKeys, missing, segments };
}

const shapes = eventShapes(() => false) as Readonly<Record<string, BoundRule>>;

describe('the bounded audit chain checks every value it keeps (runtime sweep)', () => {
  it('every rule of every shape says what it is', () => {
    const silent: string[] = [];
    const walk = (rule: BoundRule, path: string, depth = 0): void => {
      if (depth > 24) return;
      const k = ruleKind(rule);
      if (k === undefined) {
        silent.push(path);
        return;
      }
      if (k.kind === 'shape')
        for (const [name, r] of k.fields) walk(r, `${path}.${name}`, depth + 1);
      else if (k.kind === 'list' || k.kind === 'orList') walk(k.item, `${path}[]`, depth + 1);
      else if (k.kind === 'record') walk(k.value, `${path}{*}`, depth + 1);
      else if (k.kind === 'nullOr' || k.kind === 'byContract') walk(k.inner, path, depth + 1);
      else if (k.kind === 'either') k.alternatives.forEach((alt) => walk(alt, path, depth + 1));
      else if (k.kind === 'when') {
        walk(k.then, path, depth + 1);
        walk(k.otherwise, path, depth + 1);
      }
    };
    for (const [type, rule] of Object.entries(shapes)) walk(rule, type);
    walk(boundMeta, 'meta');
    expect(silent).toEqual([]);
  });

  it('no canary survives a damage at any position of any event, and every key arrives as an own key', () => {
    let total = 0;
    const survivors: string[] = [];
    const lostKeys: string[] = [];
    let missing = 0;
    for (const [type, rule] of Object.entries(shapes).sort(([a], [b]) => a.localeCompare(b))) {
      const result = sweep(
        rule,
        (value) => envelope(type, value),
        (record) => record.payload,
        type.replace('agentfootprint.', ''),
      );
      total += result.damages;
      survivors.push(...result.survivors);
      lostKeys.push(...result.lostKeys);
      missing += result.missing;
      expect(verifyAuditBundle(result.segments).valid, `${type}: the chain verifies`).toBe(true);
    }
    expect(survivors).toEqual([]);
    expect(lostKeys).toEqual([]);
    expect(missing).toBe(0);
    // Not vacuous: thousands of single damages, across every registered event.
    expect(total).toBeGreaterThan(10_000);
  }, 120_000);

  it("no canary survives a damage at any position of a record's meta", () => {
    const valid = sampleOf(boundMeta) as Record<string, unknown>;
    const result = sweep(
      boundMeta,
      (meta) =>
        envelope(
          'agentfootprint.agent.iteration_start',
          { turnIndex: 0, iterIndex: 1 },
          {
            ...(meta !== null && typeof meta === 'object' && !Array.isArray(meta) ? {} : valid),
            ...(meta as object),
          },
        ),
      (record) => record.meta,
      'meta',
    );
    expect(result.survivors).toEqual([]);
    expect(result.lostKeys).toEqual([]);
    expect(result.missing).toBe(0);
    expect(verifyAuditBundle(result.segments).valid).toBe(true);
    expect(result.damages).toBeGreaterThan(100);
  });

  it('the kept-by-contract exceptions sit exactly where the pin says', () => {
    const found: string[] = [];
    const walk = (rule: BoundRule, path: string, depth = 0): void => {
      if (depth > 24) return;
      const k = ruleKind(rule);
      if (k === undefined) return;
      if (k.kind === 'byContract') {
        found.push(`${k.exception} · ${path}`);
        walk(k.inner, path, depth + 1);
      } else if (k.kind === 'shape')
        for (const [name, r] of k.fields) walk(r, `${path}.${name}`, depth + 1);
      else if (k.kind === 'list' || k.kind === 'orList') walk(k.item, `${path}[]`, depth + 1);
      else if (k.kind === 'record') walk(k.value, `${path}{*}`, depth + 1);
      else if (k.kind === 'nullOr') walk(k.inner, path, depth + 1);
      else if (k.kind === 'either') k.alternatives.forEach((alt) => walk(alt, path, depth + 1));
      else if (k.kind === 'when') {
        walk(k.then, path, depth + 1);
        walk(k.otherwise, path, depth + 1);
      }
    };
    for (const [type, rule] of Object.entries(shapes))
      walk(rule, type.replace('agentfootprint.', ''));
    walk(boundMeta, 'meta');
    expect(found.sort()).toEqual(
      [
        'app-reason-word · permission.gate_closed.reason',
        'app-reason-word · skill.deactivated.reason',
        'app-reason-word · tools.offered.reason',
        'decide-evidence · composition.route_decided.evidence',
        'decision-summary · composition.route_decided.evidence.rules[].conditions[].actualSummary',
        'decision-summary · composition.route_decided.evidence.rules[].inputs[].valueSummary',
        'decision-summary · context.evaluated.cursorMove.guard.conditions[].actualSummary',
        'decision-summary · context.evaluated.cursorMove.guardsClosed[].conditions[].actualSummary',
        'meta-identity · meta.principal',
        'meta-identity · meta.sessionId',
        'meta-identity · meta.tenant',
        'policy-reason-tag · permission.check.reason',
        'policy-reason-tag · permission.halt.reason',
        'seen-tool-name · tools.absent.tryInsteadTool.tool',
      ].sort(),
    );
  });
});
