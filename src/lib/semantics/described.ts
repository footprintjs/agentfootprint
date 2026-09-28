/**
 * semantics/described — `describedResult()`, the declaration door spelled the
 * way code is written.
 *
 * Pattern: one core, two doors (`envelope.ts` · `mintSemantics`). This file
 *          is the camelCase door: it says how its author spells the
 *          declaration and respells each object to the wire. It judges
 *          nothing itself — every rule lives in the core, once.
 * Role:    lib/ layer, pure.
 * Emits:   N/A (the caller emits `agentfootprint.tools.semantics_declared`).
 *
 * ## Why a second door, and why one spelling per door
 *
 * `semantic()` copied the wire's snake_case names into its declaration
 * (`measured_at`, `is_counter`, `filter_note`) beside camelCase ones
 * (`notChecked`, `cannotCover`), so an author wrote two spellings in one
 * object — and "semantic" already means vector retrieval everywhere else in
 * this library. `describedResult()` takes the same fields in camelCase and
 * mints the same wire, byte for byte. The wire does not change: the model and
 * any foreign process keep reading snake_case.
 *
 * Each door takes ONE spelling and refuses the other, quoting the key its
 * author wrote and naming the one meant (`provenance.measured_at` → "did you
 * mean `measuredAt`?"). A migration that swaps only the function name then
 * fails loudly at the line that needs the new spelling, instead of silently
 * minting without it. Neither door accepts both spellings in one object.
 */

import { COVERAGE_DECLARATION_KEYS } from '../../core/agent/coverage/items.js';
import { refusal, refuseUnknownKeys } from '../../core/agent/coverage/refusal.js';
import {
  CLARIFY_DECLARATION_KEYS,
  mintSemantics,
  provenanceIssues,
  WIRE_SPELLING,
  type DeclarationDoor,
  type RespelledObject,
  type SemanticIssue,
  type SpelledField,
} from './envelope.js';
import type {
  DescribedResultDeclaration,
  SemanticGrain,
  SemanticProvenance,
  SemanticRender,
  ToolSemantics,
} from './types.js';

/** One declared object's keys, as the author writes them. */
type DeclaredKeysOf<F extends RespelledObject> = keyof NonNullable<DescribedResultDeclaration[F]>;

/**
 * Each declared key → its wire key, per object, tied to the types in BOTH
 * directions: a declared key with no wire name, or a wire name the wire type
 * does not have, fails to compile. The order is the order a refusal lists the
 * fields in.
 */
const GRAIN_NAMES = {
  interval: 'interval',
  aggregation: 'aggregation',
  isCounter: 'is_counter',
  collapsed: 'collapsed',
} as const satisfies Record<DeclaredKeysOf<'grain'>, keyof SemanticGrain>;

const PROVENANCE_NAMES = {
  measuredAt: 'measured_at',
  ageSeconds: 'age_seconds',
  source: 'source',
  sourceExportDate: 'source_export_date',
} as const satisfies Record<DeclaredKeysOf<'provenance'>, keyof SemanticProvenance>;

const RENDER_NAMES = {
  default: 'default',
  columns: 'columns',
  sort: 'sort',
  filterNote: 'filter_note',
  chartHint: 'chart_hint',
} as const satisfies Record<DeclaredKeysOf<'render'>, keyof SemanticRender>;

const WIRE_NAMES: Readonly<Record<RespelledObject, Readonly<Record<string, string>>>> = {
  grain: GRAIN_NAMES,
  provenance: PROVENANCE_NAMES,
  render: RENDER_NAMES,
};

/** Every declared key → its wire key, across the three respelled objects. */
type WireNames = typeof GRAIN_NAMES & typeof PROVENANCE_NAMES & typeof RENDER_NAMES;

/** The declared key whose wire name is `W` — read off the tables above. */
type DeclaredNameOf<W extends string> = {
  [K in keyof WireNames]: WireNames[K] extends W ? K : never;
}[keyof WireNames];

/**
 * How this door's author spells the six snake_case wire fields — each value
 * checked against the tables above, so a renamed declared key that is not
 * renamed here fails to compile instead of naming a field nobody wrote.
 */
const CAMEL_SPELLING = {
  is_counter: 'isCounter',
  measured_at: 'measuredAt',
  age_seconds: 'ageSeconds',
  source_export_date: 'sourceExportDate',
  filter_note: 'filterNote',
  chart_hint: 'chartHint',
} as const satisfies { readonly [W in SpelledField]: DeclaredNameOf<W> };

/**
 * The nine top-level fields, tied to the type in both directions. One word
 * each — the eight `semantic()` reads, plus `period` (honesty step 7b), which
 * only this door takes: the deprecated door gains no field.
 */
const DECLARATION_KEYS: readonly string[] = Object.keys({
  series: true,
  facts: true,
  edges: true,
  grain: true,
  provenance: true,
  period: true,
  coverage: true,
  clarify: true,
  render: true,
} satisfies Record<keyof DescribedResultDeclaration, true>);

/**
 * `value` with each key renamed to its wire name, in the author's key order.
 * A value that is not a plain object is handed through untouched, so the rule
 * set names it for what it is — "`provenance` must be an object ({ measuredAt,
 * source, … })" — where a spread would have turned `null` into `{}` and a
 * string into indexed characters. (`semantic()`'s door still spreads, and
 * keeps the refusal it always gave.) A plain object carries only known keys
 * here: the door refused every other key first.
 */
function toWire(field: RespelledObject, value: unknown): unknown {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return value;
  const names = WIRE_NAMES[field];
  const declared = value as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  // `Object.hasOwn`, never `names[key]` alone: a key such as `toString` would
  // otherwise read a function off Object.prototype and rename to it.
  for (const key of Object.keys(declared)) {
    out[Object.hasOwn(names, key) ? names[key] : key] = declared[key];
  }
  return out;
}

const DESCRIBED_DOOR: DeclarationDoor = {
  name: 'describedResult',
  declarationKeys: DECLARATION_KEYS,
  derivedKeys: ['notCovered', 'not_covered'],
  objectKeys: [
    ['grain', Object.keys(GRAIN_NAMES)],
    ['provenance', Object.keys(PROVENANCE_NAMES)],
    ['coverage', COVERAGE_DECLARATION_KEYS],
    ['clarify', CLARIFY_DECLARATION_KEYS],
    ['render', Object.keys(RENDER_NAMES)],
  ],
  toWire,
  spelling: CAMEL_SPELLING,
};

// ─── The one provenance shape, for absent() too (honesty step 7b) ───────────

/** A provenance declaration as an author writes it (camelCase) — and as the record keeps it. */
export type DeclaredProvenance = NonNullable<DescribedResultDeclaration['provenance']>;

/**
 * Mint an author's (camelCase) `provenance` into the wire's spelling by THIS
 * door's rules — `absent()` asks it (honesty step 7b), so an absence says its
 * source and time in the shape, the spelling and the rule set a described
 * result does: `measuredAt` and `source` required, `ageSeconds` a finite
 * number ≥ 0, `sourceExportDate` a non-empty string, a snake_case key refused
 * naming the camelCase one. THROWS the refusal (`refused: …`) at the line the
 * author wrote. A fresh object, keys in the author's order.
 */
export function mintProvenance(declared: unknown): SemanticProvenance {
  if (typeof declared === 'object' && declared !== null && !Array.isArray(declared)) {
    refuseUnknownKeys(declared, Object.keys(PROVENANCE_NAMES), 'provenance');
  }
  const wire = toWire('provenance', declared);
  const [first] = provenanceIssues(wire, CAMEL_SPELLING);
  if (first !== undefined) throw refusal(`${first.message} (field: ${first.field})`);
  return wire as SemanticProvenance;
}

/** What a recognizer read off an envelope's `provenance`. */
export interface ProvenanceReading {
  /** The record's camelCase form — present when the envelope declared a well-formed one. */
  readonly provenance?: DeclaredProvenance;
  /** The first fault, when it declared one the record cannot carry. */
  readonly problem?: SemanticIssue;
}

/**
 * Read a WIRE provenance (an absence minted anywhere — a Python helper, an
 * older process) into the record's camelCase form, by the same rule set —
 * never repaired. `{}` when none is declared (`undefined` or `null`).
 */
export function readProvenance(wire: unknown): ProvenanceReading {
  if (wire === undefined || wire === null) return {};
  const [problem] = provenanceIssues(wire, WIRE_SPELLING);
  if (problem !== undefined) return { problem };
  const p = wire as SemanticProvenance;
  return {
    provenance: {
      measuredAt: p.measured_at,
      source: p.source,
      ...(p.age_seconds !== undefined && { ageSeconds: p.age_seconds }),
      ...(p.source_export_date !== undefined && { sourceExportDate: p.source_export_date }),
    },
  };
}

/**
 * Return rows, a series or relationships from a system of record — WITH the
 * caveats that make them honest — in a shape the framework recognizes, the
 * record keeps whole, and a build gate can refuse.
 *
 * **Where it lives.** It is the tool's RESPONSE: `execute` returns it, and
 * nothing is added to the system prompt or the tool's schema. The model reads
 * a compact projection ({@link semanticsForModel}: the data, `grain`,
 * `provenance`, the `not_covered` lines composed from `coverage`, a non-null
 * `clarify` and a static note) — never the `checked` list, the `render` hints
 * or the marker. The run record keeps the FULL envelope
 * (`agentfootprint.tools.semantics_declared`), even when the result is over
 * the tool's `resultCeiling` and refused. A declared `coverage` also flows
 * through the channel `coverage()` uses, which is the only part that can reach
 * the final answer (`.limitsTravelWithTheAnswer()`).
 *
 * **Values from the data.** `provenance.measuredAt` is when the WORLD was
 * measured, taken from the data — the export's time, the moment of a live
 * read, the newest sample of a series, the end of a window — never typed in.
 * It is never parsed: the library passes your words through.
 *
 * **The period** (honesty step 7b). `period: { queried, held, readAt? }` says
 * what time the READ covered — the instants it asked for, and what the store
 * holds (or `'unknown'`) — as ISO 8601 instants with a zone. The model reads it
 * as declared; the results layer compares the instants and files its verdict
 * (covered · partly held · not held · unknown). A malformed period is refused
 * here.
 *
 * Refuses (throws, at the call site — the `absent()` law) any declaration
 * this vocabulary cannot honor: series without `grain`, series or facts
 * without `provenance.measuredAt` and `provenance.source`, a counter-looking
 * aggregation with `isCounter` unstated, and every malformed shape. Each
 * refusal starts `refused: `, names the field as you spelled it, and — inside
 * `execute` — is the call's error result, which the model reads in place of
 * the data; the run continues. A snake_case key (`measured_at`,
 * `not_checked`) is refused, naming the camelCase one.
 *
 * Replaces `semantic()`, which mints the same envelope from snake_case names
 * and is deprecated. Use `absent()` when nothing matched and `coverage()` for
 * any other value that has limits; never wrap one helper's result in another.
 *
 * @example rows from a nightly export — the time comes from the export
 * ```ts
 * const exportTime = snapshot.exportedAt; // when the WORLD was measured
 * return describedResult({
 *   facts: rows.map((r) => ({ entity: r.vm, datastore: r.datastore, size_tb: r.sizeTb })),
 *   provenance: { measuredAt: exportTime, source: 'RVTools export' },
 *   coverage: {
 *     checked: [`every VM in the RVTools export of ${exportTime}`],
 *     cannotCover: [{ what: 'hosts that are not VMware', why: 'RVTools sees VMware only' }],
 *   },
 * });
 * ```
 *
 * @example a series — `measuredAt` is the newest sample
 * ```ts
 * const newest = rows.reduce((a, b) => (a.time > b.time ? a : b)).time;
 * return describedResult({
 *   series: rows.map((r) => ({ t: r.time, entity: r.port, metric: 'avg_iops', value: r.iops })),
 *   grain: { interval: '30m', aggregation: 'avg', isCounter: false },
 *   provenance: { measuredAt: newest, source: 'InfluxDB SwitchPortStats' },
 * });
 * ```
 */
export function describedResult(decl: DescribedResultDeclaration): ToolSemantics {
  return mintSemantics(decl, DESCRIBED_DOOR);
}
