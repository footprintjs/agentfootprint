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
import {
  CLARIFY_DECLARATION_KEYS,
  mintSemantics,
  type DeclarationDoor,
  type RespelledObject,
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
 * The eight top-level fields, tied to the type in both directions. One word
 * each, so they are the same eight `semantic()` reads.
 */
const DECLARATION_KEYS: readonly string[] = Object.keys({
  series: true,
  facts: true,
  edges: true,
  grain: true,
  provenance: true,
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
