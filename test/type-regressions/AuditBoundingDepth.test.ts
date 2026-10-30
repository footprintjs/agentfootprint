/**
 * The audit chain's bounded mode is CLOSED at every depth — walked beside the
 * payload TYPES with the TypeScript checker, for every registered event.
 *
 * WHY. Bounding used to be a list of the content fields someone remembered
 * (`BOUND_FIELDS`); every other field rode through as written, so each new
 * content field leaked until someone noticed. Now every event has a shape
 * that names every field (`auditShapes.ts`, exhaustive by type at compile
 * time) and marks whatever it does not name. What compile time cannot see is
 * whether a rule fits the type beneath it: a rule kept a value whole, and a
 * whole container rode through with whatever it held. This file closes that
 * gap and pins the result.
 *
 * WHAT A GREEN RUN PROVES:
 *
 *   1. Every rule says what it is (`ruleKind`), and every rule AGREES with the
 *      type it bounds, at every depth: a leaf checks at runtime the kind its
 *      declared type promises — a number, a boolean, a string — and an enum
 *      (`oneOf`) lists exactly the words a closed union declares, so a value
 *      outside them is a marker; a string kept whole sits only where the type
 *      is an open string. A container is spelled out (`shapeOf`, `listOf`,
 *      `recordOf`), never kept whole. The same holds for each record's `meta`
 *      (`EventMeta`) and for `decide()` evidence (footprintjs's own types).
 *      The runtime half — every rule handed what its kind forbids — is
 *      `test/observability-providers/audit-bounded-sweep.test.ts`.
 *   2. The fields `audit.ts` · `BOUND_FIELDS` declares (the conversation names
 *      the redaction vocabulary is pinned against) are bounded by the very rule
 *      functions it names.
 *   3. For a sample that fills EVERY field of EVERY event (built from the type),
 *      each leaf's fate under bounded mode — kept, or which marker — equals the
 *      committed snapshot (`audit-bounding-fates.snapshot.json`). Reclassifying
 *      a field, or adding one anywhere, changes the snapshot: reviewed, never
 *      silent.
 *   4. An event type the registry does not declare is all markers.
 *
 * A DELIBERATE classification change updates the snapshot in the same change:
 * `npx vitest run test/type-regressions/AuditBoundingDepth.test.ts -u`.
 */
import { join, resolve } from 'node:path';
import ts from 'typescript';
import { describe, expect, it } from 'vitest';

import { auditExport, boundedFieldRules } from '../../src/adapters/observability/audit';
import {
  acceptedKinds,
  charsMarker,
  ruleKind,
  type BoundRule,
  type ValueKind,
} from '../../src/adapters/observability/auditBounding';
import { boundMeta, eventShapes } from '../../src/adapters/observability/auditShapes';
import type { AgentfootprintEvent } from '../../src/events/registry';

const ROOT = resolve(__dirname, '../..');
/** Names `DecideEvidence` — footprintjs's own decide()/select() evidence types. */
const BY_CONTRACT = join(ROOT, 'src/adapters/observability/auditKeptByContract.ts');

interface Types {
  readonly checker: ts.TypeChecker;
  /** Every registered event's payload type. */
  readonly payloads: Map<string, ts.Type>;
  /** The envelope's `meta` (`EventMeta`). */
  readonly meta: ts.Type | undefined;
  /** What `composition.route_decided.evidence` holds when it is decide() evidence. */
  readonly decideEvidence: ts.Type | undefined;
  /** What a decide() filter's threshold holds, as the record keeps it. */
  readonly decideThreshold: ts.Type | undefined;
}

/** Every registered event's payload type, the meta and decide() evidence — from the source. */
function payloadTypes(): Types {
  const config = ts.getParsedCommandLineOfConfigFile(
    join(ROOT, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      onUnRecoverableConfigFileDiagnostic: (d) => {
        throw new Error(ts.flattenDiagnosticMessageText(d.messageText, '\n'));
      },
    },
  );
  if (!config) throw new Error('tsconfig.json did not parse');
  const registry = join(ROOT, 'src/events/registry.ts');
  const program = ts.createProgram([registry, BY_CONTRACT], { ...config.options, noEmit: true });
  const checker = program.getTypeChecker();
  const file = program.getSourceFile(registry);
  let map: ts.Type | undefined;
  file?.forEachChild((node) => {
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      node.name.text === 'AgentfootprintEventMap'
    )
      map = checker.getTypeAtLocation(node.name);
  });
  if (map === undefined) throw new Error('AgentfootprintEventMap not found');
  const payloads = new Map<string, ts.Type>();
  let meta: ts.Type | undefined;
  for (const event of checker.getPropertiesOfType(map)) {
    const envelope = typeOf(checker, event);
    const payload = checker.getPropertyOfType(envelope, 'payload');
    if (payload) payloads.set(event.name, typeOf(checker, payload));
    const metaSymbol = checker.getPropertyOfType(envelope, 'meta');
    if (metaSymbol && meta === undefined) meta = typeOf(checker, metaSymbol);
  }
  let decideEvidence: ts.Type | undefined;
  let decideThreshold: ts.Type | undefined;
  program.getSourceFile(BY_CONTRACT)?.forEachChild((node) => {
    if (!ts.isTypeAliasDeclaration(node)) return;
    if (node.name.text === 'DecideEvidence') decideEvidence = checker.getTypeAtLocation(node.name);
    if (node.name.text === 'DecideThreshold')
      decideThreshold = checker.getTypeAtLocation(node.name);
  });
  return { checker, payloads, meta, decideEvidence, decideThreshold };
}

function typeOf(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type {
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return decl ? checker.getTypeOfSymbolAtLocation(symbol, decl) : checker.getTypeOfSymbol(symbol);
}

const { checker, payloads, meta, decideEvidence, decideThreshold } = payloadTypes();

const parts = (t: ts.Type): ts.Type[] =>
  (t.isUnion() ? t.types : [t]).filter(
    (p) => !(p.flags & (ts.TypeFlags.Undefined | ts.TypeFlags.Void)),
  );
const isOpen = (t: ts.Type) => (t.flags & (ts.TypeFlags.Unknown | ts.TypeFlags.Any)) !== 0;
const isText = (t: ts.Type) =>
  (t.flags & (ts.TypeFlags.String | ts.TypeFlags.TemplateLiteral)) !== 0 ||
  (t.isIntersection() && t.types.some(isText));
const isLeaf = (t: ts.Type) =>
  (t.flags &
    (ts.TypeFlags.StringLike |
      ts.TypeFlags.NumberLike |
      ts.TypeFlags.BooleanLike |
      ts.TypeFlags.Null |
      ts.TypeFlags.BigIntLike |
      ts.TypeFlags.EnumLike)) !==
    0 || isText(t);
const isList = (t: ts.Type) => checker.isArrayType(t) || checker.isTupleType(t);

const isNull = (t: ts.Type) => (t.flags & ts.TypeFlags.Null) !== 0;
const isNumberish = (t: ts.Type) => (t.flags & ts.TypeFlags.NumberLike) !== 0;
const isBoolish = (t: ts.Type) => (t.flags & ts.TypeFlags.BooleanLike) !== 0;
const isStringish = (t: ts.Type) => (t.flags & ts.TypeFlags.StringLike) !== 0 || isText(t);
const isObject = (t: ts.Type) => !isLeaf(t) && !isOpen(t) && !isList(t);
const literalOf = (t: ts.Type): string | number | boolean | undefined =>
  t.isStringLiteral() || t.isNumberLiteral()
    ? t.value
    : t.flags & ts.TypeFlags.BooleanLiteral
    ? (t as unknown as { intrinsicName: string }).intrinsicName === 'true'
    : undefined;
/** The value kind a declared type part holds — what `either` dispatches on at runtime. */
const kindOfType = (t: ts.Type): ValueKind | undefined =>
  isNull(t)
    ? 'null'
    : isStringish(t)
    ? 'string'
    : isNumberish(t)
    ? 'number'
    : isBoolish(t)
    ? 'boolean'
    : isList(t)
    ? 'array'
    : isOpen(t)
    ? undefined
    : 'object';
const show = (types: readonly ts.Type[]) => types.map((t) => checker.typeToString(t)).join(' | ');
const elementsOf = (t: ts.Type) => checker.getTypeArguments(t as ts.TypeReference);

/**
 * Positions whose declared type is `unknown`, and the type the value has when
 * the rule keeps any of it: `decide()` evidence as footprintjs declares it, and
 * its filters' thresholds (`unknown` there too) as the record keeps them.
 */
const OPEN_DECLARED = new Map<string, ts.Type | undefined>([
  ['agentfootprint.composition.route_decided.evidence', decideEvidence],
  [
    'agentfootprint.composition.route_decided.evidence.rules[].conditions[].threshold',
    decideThreshold,
  ],
]);

/**
 * Where a rule disagrees with the type it bounds. `declared` is the type's
 * union members, `undefined` aside. A leaf must check the very kind its type
 * promises; an enum must list a closed union's words exactly; a container must
 * be spelled out; an `unknown` may only be a marker (or a position whose kept
 * type is named in `OPEN_DECLARED`).
 */
function disagreements(
  declaredParts: readonly ts.Type[],
  rule: BoundRule,
  at: string,
  out: string[],
  depth = 0,
): void {
  if (depth > 16 || declaredParts.length === 0) return;
  const k = ruleKind(rule);
  if (k === undefined) {
    out.push(`${at}: a rule that does not say what it is`);
    return;
  }
  if (k.kind === 'marker') return; // a marker keeps nothing of any value
  let declared = declaredParts;
  if (declared.some(isOpen)) {
    const instead = OPEN_DECLARED.get(at);
    if (instead === undefined) {
      out.push(`${at}: only a marker may bound an unknown value, not ${k.kind}`);
      return;
    }
    declared = parts(instead);
  }
  switch (k.kind) {
    case 'byContract':
      disagreements(declared, k.inner, at, out, depth + 1);
      return;
    case 'leaf': {
      const fits =
        k.accepts === 'number' ? isNumberish : k.accepts === 'boolean' ? isBoolish : isStringish;
      const misfit = declared.filter((p) => !fits(p));
      if (misfit.length > 0) out.push(`${at}: a ${k.accepts} leaf over ${show(misfit)}`);
      else if (k.accepts === 'string' && declared.every((p) => p.isStringLiteral()))
        out.push(`${at}: a string leaf over the closed union ${show(declared)} — use oneOf`);
      return;
    }
    case 'oneOf': {
      const misfit = declared.filter((p) => literalOf(p) === undefined && !isStringish(p));
      if (misfit.length > 0) {
        out.push(`${at}: oneOf over ${show(misfit)}`);
        return;
      }
      const words = declared
        .map(literalOf)
        .filter((v): v is string | number | boolean => v !== undefined);
      const open = declared.some((p) => literalOf(p) === undefined);
      const listed = [...k.values];
      const strange = listed.filter((v) => !words.includes(v));
      const unlisted = open ? [] : words.filter((v) => !listed.includes(v));
      if (strange.length > 0 || unlisted.length > 0)
        out.push(
          `${at}: oneOf lists [${listed.join(', ')}]; the type declares [${words.join(', ')}]` +
            (open ? ' and any other string' : ''),
        );
      return;
    }
    case 'shape': {
      // One rule per field serves every union member that has it (`AnyKeyOf`):
      // a field is checked against the union of its types across members.
      const byField = new Map<string, ts.Type[]>();
      for (const p of declared) {
        if (!isObject(p)) {
          out.push(`${at}: a shape over ${show([p])}`);
          continue;
        }
        for (const s of checker.getPropertiesOfType(p))
          byField.set(s.name, [...(byField.get(s.name) ?? []), ...parts(typeOf(checker, s))]);
      }
      for (const [name, types] of byField)
        disagreements(
          [...new Set(types)],
          k.fields.get(name) ?? charsMarker,
          `${at}.${name}`,
          out,
          depth + 1,
        );
      return;
    }
    case 'list':
      for (const p of declared) {
        if (!isList(p)) out.push(`${at}: a list over ${show([p])}`);
        else
          for (const e of elementsOf(p)) disagreements(parts(e), k.item, `${at}[]`, out, depth + 1);
      }
      return;
    case 'orList':
      for (const p of declared.filter(isList))
        for (const e of elementsOf(p)) disagreements(parts(e), k.item, `${at}[]`, out, depth + 1);
      disagreements(
        declared.filter((p) => !isList(p)),
        k.item,
        at,
        out,
        depth + 1,
      );
      return;
    case 'record':
      for (const p of declared) {
        const index = isObject(p) ? checker.getIndexInfosOfType(p) : [];
        if (index.length === 0)
          out.push(`${at}: a record over ${show([p])}, which names its keys — use shapeOf`);
        for (const i of index) disagreements(parts(i.type), k.value, `${at}{*}`, out, depth + 1);
      }
      return;
    case 'nullOr':
      disagreements(
        declared.filter((p) => !isNull(p)),
        k.inner,
        at,
        out,
        depth + 1,
      );
      return;
    case 'either': {
      const byAlternative = new Map<BoundRule, ts.Type[]>();
      for (const p of declared) {
        const kind = kindOfType(p);
        const alt = k.alternatives.find((a) => kind !== undefined && acceptedKinds(a).has(kind));
        if (alt === undefined) out.push(`${at}: no alternative accepts ${show([p])}`);
        else byAlternative.set(alt, [...(byAlternative.get(alt) ?? []), p]);
      }
      for (const [alt, ps] of byAlternative) disagreements(ps, alt, at, out, depth + 1);
      return;
    }
    case 'when':
      disagreements(declared, k.then, at, out, depth + 1);
      disagreements(declared, k.otherwise, at, out, depth + 1);
      return;
  }
}

/** A value of `t` with EVERY field present, each text leaf a distinct token. */
function sampleOf(t: ts.Type, next: () => number, depth = 0): unknown {
  if (depth > 8) return `S${next()}`;
  const ps = parts(t);
  if (ps.length === 0) return null;
  // The richest member: a container shows the most fields.
  const pick =
    ps.find((p) => !isLeaf(p) && !isOpen(p) && !isList(p)) ??
    ps.find(isList) ??
    ps.find(isOpen) ??
    ps.find(isText) ??
    ps.find((p) => (p.flags & ts.TypeFlags.Number) !== 0) ??
    ps.find((p) => p.isLiteral()) ??
    ps.find((p) => (p.flags & ts.TypeFlags.BooleanLike) !== 0) ??
    ps[0];
  if (isOpen(pick)) return { u: `S${next()}` };
  if (isText(pick)) return `S${next()}`;
  if (pick.isStringLiteral() || pick.isNumberLiteral()) return pick.value;
  if (pick.flags & ts.TypeFlags.Number) return 10_000 + next();
  if (pick.flags & ts.TypeFlags.BooleanLiteral)
    return (pick as unknown as { intrinsicName: string }).intrinsicName === 'true';
  if (pick.flags & ts.TypeFlags.Boolean) return true;
  if (pick.flags & ts.TypeFlags.Null) return null;
  if (isList(pick))
    return checker
      .getTypeArguments(pick as ts.TypeReference)
      .slice(0, 1)
      .map((e) => sampleOf(e, next, depth + 1));
  // Every member of a union of objects contributes its fields: a field one
  // member alone carries gets a sample too.
  const out: Record<string, unknown> = {};
  for (const member of ps.filter((p) => !isLeaf(p) && !isOpen(p) && !isList(p))) {
    const index = checker.getIndexInfosOfType(member)[0];
    if (index && !('k1' in out)) out.k1 = sampleOf(index.type, next, depth + 1);
    for (const s of checker.getPropertiesOfType(member))
      if (!(s.name in out)) out[s.name] = sampleOf(typeOf(checker, s), next, depth + 1);
  }
  return out;
}

/** The fate of every leaf: kept, or the marker that took its place. */
function fatesOf(input: unknown, output: unknown, at: string, out: Record<string, string>): void {
  if (typeof output === 'string' && output !== input) {
    out[at] = /^\[\d+ chars\]$/.test(output)
      ? 'chars'
      : /^\[keys: /.test(output)
      ? 'keys'
      : /^\[type: /.test(output)
      ? 'type'
      : /^\[\d+ (messages|blocks|summaries)\]$/.test(output)
      ? 'count'
      : `changed: ${output}`;
    return;
  }
  if (Array.isArray(input) && Array.isArray(output)) {
    input.forEach((v, i) => fatesOf(v, output[i], `${at}[]`, out));
    return;
  }
  if (
    input !== null &&
    typeof input === 'object' &&
    output !== null &&
    typeof output === 'object'
  ) {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (!(k in (output as object))) out[`${at}.${k}`] = 'dropped';
      else fatesOf(v, (output as Record<string, unknown>)[k], `${at}.${k}`, out);
    }
    return;
  }
  out[at] = JSON.stringify(input) === JSON.stringify(output) ? 'kept' : 'changed';
}

function envelope(type: string, payload: unknown): AgentfootprintEvent {
  return {
    type,
    payload,
    meta: {
      wallClockMs: 1,
      runOffsetMs: 0,
      runtimeStageId: 'stage#1',
      subflowPath: [],
      compositionPath: [],
      runId: 'run-depth',
    },
  } as unknown as AgentfootprintEvent;
}

const shapes = eventShapes(() => false) as Readonly<Record<string, BoundRule>>;

describe('the bounded audit chain is closed at every depth', () => {
  it('sees every registered event', () => {
    expect(payloads.size).toBeGreaterThan(100);
    expect([...payloads.keys()].sort()).toEqual(Object.keys(shapes).sort());
  });

  it('every rule agrees with the type it bounds: each leaf checks its declared kind, each enum lists its words, no container is kept whole', () => {
    const out: string[] = [];
    for (const [type, payload] of payloads) disagreements(parts(payload), shapes[type]!, type, out);
    expect(out).toEqual([]);
  });

  it("each record's meta agrees with EventMeta, and decide() evidence with footprintjs's types", () => {
    expect(meta, 'EventMeta found').toBeDefined();
    expect(decideEvidence, 'DecideEvidence found').toBeDefined();
    const out: string[] = [];
    disagreements(parts(meta!), boundMeta, 'meta', out);
    expect(out).toEqual([]);
  });

  it('bounds every field BOUND_FIELDS declares with the very rule it names', () => {
    const mismatched: string[] = [];
    for (const [type, fields] of Object.entries(boundedFieldRules())) {
      const kind = ruleKind(shapes[type]!);
      for (const [field, rule] of Object.entries(fields))
        if (kind?.kind !== 'shape' || kind.fields.get(field) !== rule)
          mismatched.push(`${type}.${field}`);
    }
    expect(mismatched).toEqual([]);
  });

  it('gives every leaf of every event the fate the snapshot records', async () => {
    const fates: Record<string, Record<string, string>> = {};
    for (const [type, payload] of [...payloads].sort(([a], [b]) => a.localeCompare(b))) {
      let n = 0;
      const sample = sampleOf(payload, () => ++n);
      // Token events are excluded by default; the fate of their fields counts too.
      const audit = auditExport({ includeTokenEvents: true });
      audit.exportEvent(envelope(type, sample));
      const record = audit.bundle().records.find((r) => r.eventType === type);
      const out: Record<string, string> = {};
      fatesOf(sample, record?.payload, '', out);
      fates[type] = Object.fromEntries(
        Object.entries(out)
          .map(([path, fate]) => [path.replace(/^\./, ''), fate] as const)
          .sort(([a], [b]) => a.localeCompare(b)),
      );
    }
    // A leaf is kept as written or replaced by a marker — never altered, never lost.
    const altered = Object.entries(fates).flatMap(([type, leaves]) =>
      Object.entries(leaves)
        .filter(([, fate]) => fate === 'dropped' || fate.startsWith('changed'))
        .map(([path, fate]) => `${type} · ${path}: ${fate}`),
    );
    expect(altered).toEqual([]);
    await expect(`${JSON.stringify(fates, null, 2)}\n`).toMatchFileSnapshot(
      './audit-bounding-fates.snapshot.json',
    );
  }, 120_000);

  it('marks every field of an event type the registry does not declare', () => {
    const audit = auditExport();
    audit.exportEvent(
      envelope('consumer.order_placed', { email: 'EDGE@x.test', total: 12, ok: true }),
    );
    expect(audit.bundle().records[1]?.payload).toEqual({
      email: '[11 chars]',
      total: '[type: number]',
      ok: '[type: boolean]',
    });
  });
});
