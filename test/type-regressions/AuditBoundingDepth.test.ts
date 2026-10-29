/**
 * The audit chain's bounded mode is CLOSED at every depth — walked beside the
 * payload TYPES with the TypeScript checker, for every registered event.
 *
 * WHY. Bounding used to be a list of the content fields someone remembered
 * (`BOUND_FIELDS`); every other field rode through as written, so each new
 * content field leaked until someone noticed. Now every event has a shape
 * that names every field (`auditShapes.ts`, exhaustive by type at compile
 * time) and marks whatever it does not name. What compile time cannot see is
 * a `kept` laid over a whole container: a field added INSIDE it would ride
 * through. This file closes that gap and pins the result.
 *
 * WHAT A GREEN RUN PROVES:
 *
 *   1. `kept` never covers a container that can hold text — a non-literal
 *      string, or an `unknown`, at any depth. Such a container is spelled out
 *      field by field (`shapeOf`, `listOf`, `recordOf`, `orList`), so every
 *      text leaf of every payload is classified by name. A `custom` rule
 *      decides by value and carries its reason.
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
  charsMarker,
  kept,
  ruleKind,
  type BoundRule,
} from '../../src/adapters/observability/auditBounding';
import { eventShapes } from '../../src/adapters/observability/auditShapes';
import type { AgentfootprintEvent } from '../../src/events/registry';

const ROOT = resolve(__dirname, '../..');

/** Every registered event's payload type, from the source. */
function payloadTypes(): { checker: ts.TypeChecker; payloads: Map<string, ts.Type> } {
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
  const program = ts.createProgram([registry], { ...config.options, noEmit: true });
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
  for (const event of checker.getPropertiesOfType(map)) {
    const envelope = typeOf(checker, event);
    const payload = checker.getPropertyOfType(envelope, 'payload');
    if (payload) payloads.set(event.name, typeOf(checker, payload));
  }
  return { checker, payloads };
}

function typeOf(checker: ts.TypeChecker, symbol: ts.Symbol): ts.Type {
  const decl = symbol.valueDeclaration ?? symbol.declarations?.[0];
  return decl ? checker.getTypeOfSymbolAtLocation(symbol, decl) : checker.getTypeOfSymbol(symbol);
}

const { checker, payloads } = payloadTypes();

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

/** Whether a value of `t` can hold text anywhere: a non-literal string, or an `unknown`. */
function holdsText(t: ts.Type, depth = 0, seen = new Set<ts.Type>()): boolean {
  if (depth > 10) return true;
  return parts(t).some((p) => {
    if (isOpen(p) || isText(p)) return true;
    if (isLeaf(p) || seen.has(p)) return false;
    seen.add(p);
    if (isList(p))
      return checker
        .getTypeArguments(p as ts.TypeReference)
        .some((e) => holdsText(e, depth + 1, seen));
    return (
      checker.getIndexInfosOfType(p).some((i) => holdsText(i.type, depth + 1, seen)) ||
      checker.getPropertiesOfType(p).some((s) => holdsText(typeOf(checker, s), depth + 1, seen))
    );
  });
}

/** Where `kept` covers a container (or an `unknown`) that can hold text. */
function keptOverText(t: ts.Type, rule: BoundRule, at: string, out: string[], depth = 0): void {
  if (depth > 12) return;
  if (rule === kept) {
    if (parts(t).some((p) => isOpen(p) || (!isLeaf(p) && holdsText(p)))) out.push(at);
    return;
  }
  const kind = ruleKind(rule);
  if (kind === undefined || kind.kind === 'custom') return; // a marker hides it all; custom says why
  for (const p of parts(t)) {
    if (kind.kind === 'nullOr') {
      if (!(p.flags & ts.TypeFlags.Null)) keptOverText(p, kind.inner, at, out, depth + 1);
    } else if (kind.kind === 'list' || kind.kind === 'orList') {
      if (isList(p))
        for (const e of checker.getTypeArguments(p as ts.TypeReference))
          keptOverText(e, kind.item, `${at}[]`, out, depth + 1);
      else if (kind.kind === 'orList') keptOverText(p, kind.item, at, out, depth + 1);
    } else if (kind.kind === 'record') {
      for (const i of checker.getIndexInfosOfType(p))
        keptOverText(i.type, kind.value, `${at}{*}`, out, depth + 1);
    } else if (kind.kind === 'shape' && !isLeaf(p) && !isList(p)) {
      for (const s of checker.getPropertiesOfType(p))
        keptOverText(
          typeOf(checker, s),
          kind.fields[s.name] ?? charsMarker,
          `${at}.${s.name}`,
          out,
          depth + 1,
        );
    }
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

  it('never keeps a container that can hold text: every text leaf is classified by name', () => {
    const out: string[] = [];
    for (const [type, payload] of payloads) keptOverText(payload, shapes[type]!, type, out);
    expect(out).toEqual([]);
  });

  it('bounds every field BOUND_FIELDS declares with the very rule it names', () => {
    const mismatched: string[] = [];
    for (const [type, fields] of Object.entries(boundedFieldRules())) {
      const kind = ruleKind(shapes[type]!);
      for (const [field, rule] of Object.entries(fields))
        if (kind?.kind !== 'shape' || kind.fields[field] !== rule)
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
