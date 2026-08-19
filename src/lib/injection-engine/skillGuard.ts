/**
 * skillGuard — the DATA-guard domain for skill-graph route edges (9.51.0).
 *
 * This module completes the SkillWalker's third mover. The SkillMap is data
 * (`skillGraph()`/`defineSkillMap`), entry matchers are data (`match:` —
 * skillMatch.ts), tool-outcome route arms are data (`onToolStatus`) — the one
 * thing left opaque on a route edge was the general `when` predicate. A
 * `guard:` is its declarative twin: conditions over the hop's context and the
 * tool result's own fields, compiled ONCE into the predicate that routes AND
 * the serializable data that describes it, so the check-up can compare
 * guards, `toMermaid()` can caption them, `skill.graph_declared` can carry
 * them, and every evaluation leaves per-condition evidence on the record.
 *
 * One module owns everything a guard is and does (the skillMatch.ts law):
 *
 *   • what a guard IS        — {@link SkillGuard} (author form) and
 *                              {@link SkillGuardData} (serializable description);
 *   • how it RUNS            — {@link compileGuard}: ONE compilation returns the
 *                              predicate, the data, and the evidence evaluator;
 *   • what it PROVES WRONG   — {@link guardUnsatisfiable}: the contradictions
 *                              the check-up can honestly flag;
 *   • how it DRAWS           — {@link plainGuardCaption} / {@link mermaidGuardCaption}.
 *
 * ## The operator grammar deliberately MIRRORS footprintjs's WhereFilter
 *
 * `eq / ne / gt / gte / lt / lte / in / notIn`, every condition ANDed, with
 * per-condition evidence — the exact vocabulary and evidence shape of
 * footprintjs's `evaluateFilter` (footprintjs `src/lib/decide/evaluator.ts`).
 * It is a door-local TWIN, not an import: this module sits behind the
 * skill-graph door's no-footprintjs fence
 * (test/lib/injection-engine/skill-graph-fence.test.ts), so the tiny operator
 * set is mirrored here and a future shared extraction is mechanical. Two
 * deliberate divergences, both because guards are compiled at BUILD time
 * while footprintjs filters arrive at run time: a malformed guard is REFUSED
 * by name at the keystroke (footprintjs dev-warns and fails the condition),
 * and there is no redaction hook (this layer has no redaction registry — the
 * summarized `actualSummary` is the bounded record, never the raw bytes).
 *
 * ## What a guard can read (the key rule)
 *
 * A guard is judged per tool result of the previous iteration's batch — the
 * same evidence every route edge fires on. Six HOP KEYS read the hop context
 * directly:
 *
 *   `toolName`, `result`, `status`  — the judged tool result (`status` only
 *                                     when the tool's envelope declared one);
 *   `iteration`, `userMessage`, `currentSkillId` — the iteration context.
 *
 * Any OTHER key reads the top-level field of that name from the RESULT
 * parsed as JSON — the shape structured tool results already have. A result
 * that is not a JSON object yields `undefined` for such keys, so the
 * condition fails and the evidence says so. NOTE the same caveat that rides
 * `InjectionContext.lastToolResult`: `result` is the string the MODEL read,
 * which artifact placement can replace with a claim ticket — a guard over
 * result fields judges what the model was told. Guard on `toolName` /
 * `status` when you want a condition placement cannot move.
 *
 * Engine-type-free by design (the view is structural), imports only the
 * closed status vocabulary from its own door — `skillGraphCheckup.ts` can
 * import it and keep its "pure over strings" law intact.
 */

import { TOOL_RESULT_STATUSES } from './toolOutcome.js';

// ─── What a guard IS ────────────────────────────────────────────────────

/** A guard threshold value — plain data only, because a guard IS data: it
 *  rides `SkillEdge.guard`, `skill.graph_declared` and every recording, so it
 *  must survive `structuredClone` and read back as what was declared. */
export type GuardValue = string | number | boolean | null;

/** The guard operators — deliberately the footprintjs WhereFilter set. */
export type GuardOperator = 'eq' | 'ne' | 'gt' | 'gte' | 'lt' | 'lte' | 'in' | 'notIn';

/**
 * The operators one guarded key may declare. All declared operators must
 * pass (AND), exactly as in footprintjs's `FilterOps`.
 *
 *   • `eq` / `ne`   — strict equality / inequality;
 *   • `gt`/`gte`/`lt`/`lte` — ordered comparison (numbers, or strings
 *     lexicographically — `iteration: { gte: 3 }`, `riskLevel: { gte: 'high' }`);
 *   • `in` / `notIn` — membership in a non-empty list (≤ 1000 entries, the
 *     footprintjs bound).
 */
export interface SkillGuardOps {
  readonly eq?: GuardValue;
  readonly ne?: GuardValue;
  readonly gt?: string | number;
  readonly gte?: string | number;
  readonly lt?: string | number;
  readonly lte?: string | number;
  readonly in?: readonly GuardValue[];
  readonly notIn?: readonly GuardValue[];
}

/**
 * The AUTHOR form of a route-edge guard (`SkillRouteOptions.guard`): keys to
 * operator sets, every condition ANDed. Keys resolve per the module-header
 * rule — six hop keys read the hop directly, any other key reads the result's
 * top-level JSON field.
 *
 * @example
 *   .route(triage, escalation, { guard: { riskLevel: { gte: 'high' } } })
 *   .route(triage, billing, {
 *     onToolReturn: 'lookup_order',
 *     guard: { status: { ne: 'denied' }, iteration: { lte: 5 } },
 *   })
 */
export type SkillGuard = { readonly [key: string]: SkillGuardOps };

/** One compiled guard condition, as serializable data. */
export interface GuardConditionData {
  readonly key: string;
  readonly op: GuardOperator;
  readonly value: GuardValue | readonly GuardValue[];
}

/**
 * The serializable description of a route-edge guard — what the check-up
 * compares, what `toMermaid()` captions, what `SkillEdge.guard` and the
 * `skill.graph_declared` payload carry. Pure data (survives
 * `structuredClone`); conditions in declaration order, all ANDed.
 */
export interface SkillGuardData {
  readonly conditions: readonly GuardConditionData[];
}

// ─── How it RUNS ────────────────────────────────────────────────────────

/** The hop view a compiled guard reads. Structural on purpose — the cursor
 *  resolver builds it from `InjectionContext` + one tool result, and this
 *  module never has to import either. */
export interface GuardHopView {
  readonly toolName: string;
  readonly result: string;
  readonly status?: string;
  readonly iteration: number;
  readonly userMessage: string;
  readonly currentSkillId?: string;
}

/**
 * One condition's evaluation, for the record — the footprintjs
 * `FilterCondition` shape, door-local: which condition, what it was judged
 * against (bounded summary, never the raw bytes), and whether it passed.
 */
export interface GuardConditionEvidence {
  readonly key: string;
  readonly op: GuardOperator;
  readonly value: GuardValue | readonly GuardValue[];
  /** The judged value, summarized to ≤ 80 chars — evidence, not a transcript. */
  readonly actualSummary: string;
  readonly passed: boolean;
}

/** A full guard evaluation: the verdict plus every condition's evidence. */
export interface GuardVerdict {
  readonly verdict: boolean;
  readonly conditions: readonly GuardConditionEvidence[];
}

/**
 * ONE compilation's three faces (the `compileMatch` pattern): the predicate
 * that routes, the data that describes it, and the evidence evaluator the
 * record quotes — all from the same conditions, so they can never describe
 * different guards.
 */
export interface CompiledGuard {
  /** Cheap boolean — short-circuits on the first failing condition. */
  readonly predicate: (view: GuardHopView) => boolean;
  /** The serializable description. */
  readonly data: SkillGuardData;
  /** The full evaluation, with per-condition evidence. Same conditions, same
   *  order, same answers as `predicate` — one compiled list feeds both. */
  readonly evaluate: (view: GuardHopView) => GuardVerdict;
}

/** The six hop keys a guard reads directly (every other key reads the
 *  result's top-level JSON field). Exported for docs/tests. */
export const GUARD_HOP_KEYS = [
  'toolName',
  'result',
  'status',
  'iteration',
  'userMessage',
  'currentSkillId',
] as const;

const HOP_KEY_SET: ReadonlySet<string> = new Set(GUARD_HOP_KEYS);

/** Mirrors footprintjs's prototype-pollution denylist — refused at compile
 *  (build time) rather than failed at run time, because a guard is declared
 *  code-side and a refusal teaches where a silent no-match hides. */
const DENIED_KEYS = new Set([
  '__proto__',
  'constructor',
  'prototype',
  'toString',
  'valueOf',
  'hasOwnProperty',
  'isPrototypeOf',
  'propertyIsEnumerable',
  '__defineGetter__',
  '__defineSetter__',
  '__lookupGetter__',
  '__lookupSetter__',
]);

const GUARD_OPERATORS: readonly GuardOperator[] = [
  'eq',
  'ne',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'notIn',
];
const OPERATOR_SET: ReadonlySet<string> = new Set(GUARD_OPERATORS);

/** The footprintjs `MAX_IN_ARRAY_SIZE` bound, mirrored. */
const MAX_IN_ARRAY_SIZE = 1000;
const MAX_SUMMARY_LEN = 80;

function isGuardValue(v: unknown): v is GuardValue {
  return v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean';
}

/** Bound one judged value into evidence text. Strings verbatim (truncated),
 *  primitives via String, structures via JSON — never the raw bytes past the
 *  bound. */
function summarize(v: unknown): string {
  if (v === undefined) return 'undefined';
  if (typeof v === 'string') {
    return v.length > MAX_SUMMARY_LEN ? `${v.slice(0, MAX_SUMMARY_LEN - 1)}…` : v;
  }
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return String(v);
  try {
    const s = JSON.stringify(v);
    if (typeof s !== 'string') return Object.prototype.toString.call(v);
    return s.length > MAX_SUMMARY_LEN ? `${s.slice(0, MAX_SUMMARY_LEN - 1)}…` : s;
  } catch {
    return Object.prototype.toString.call(v);
  }
}

/** The operator dispatch table — footprintjs's `OPERATOR_HANDLERS`, verbatim
 *  in spirit: raw JS comparison, strict equality, array membership. The
 *  in/notIn size guard lives at COMPILE here (the lists are declared, not
 *  discovered at run time). */
const OPERATOR_TESTS: Record<GuardOperator, (actual: unknown, value: unknown) => boolean> = {
  eq: (a, t) => a === t,
  ne: (a, t) => a !== t,
  gt: (a, t) => (a as number) > (t as number),
  gte: (a, t) => (a as number) >= (t as number),
  lt: (a, t) => (a as number) < (t as number),
  lte: (a, t) => (a as number) <= (t as number),
  in: (a, t) => Array.isArray(t) && t.includes(a),
  notIn: (a, t) => !(Array.isArray(t) && t.includes(a)),
};

/** Parse a tool result as a JSON OBJECT, or undefined — arrays and scalars
 *  have no named top-level fields for a guard key to read. */
function parseResultObject(result: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(result);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return undefined;
    return parsed as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function refuse(where: string, what: string): never {
  throw new Error(
    `skillGraph: ${where} declares a \`guard\` this library cannot honor — ${what} A guard ` +
      `is { key: { op: value, … }, … } with operators ${GUARD_OPERATORS.join('/')}, values ` +
      `plain data (string/number/boolean/null; arrays of those for in/notIn), every ` +
      `condition ANDed. Keys ${GUARD_HOP_KEYS.join('/')} read the hop directly; any other ` +
      `key reads the tool result's top-level JSON field. For any other condition, use ` +
      `\`when: (result) => …\` instead.`,
  );
}

/**
 * Compile a guard into its predicate + its serializable data + its evidence
 * evaluator — ONE compilation, so the predicate that routes, the data the
 * check-up compares, and the evidence the record quotes can never describe
 * different guards (the `compileMatch` law). Refuses every shape it cannot
 * honor, by name, at the keystroke: an empty guard (asserts nothing — the
 * footprintjs anti-vacuous-truth law, refused at build instead of matched
 * never), an unknown operator (a typo like `gle` must not become an edge that
 * silently never fires), a non-data threshold (a guard that cannot ride a
 * recording is not a guard), an empty or oversized `in`/`notIn` list, and the
 * prototype-pollution key set.
 */
export function compileGuard(guard: SkillGuard, where: string): CompiledGuard {
  if (guard === null || typeof guard !== 'object' || Array.isArray(guard)) {
    refuse(where, `it is not an object of { key: { op: value } } conditions.`);
  }
  const keys = Object.keys(guard);
  if (keys.length === 0) {
    refuse(
      where,
      `it is empty. A guard with no conditions asserts nothing, so it could only match ` +
        `everything or nothing — both the silent kind of wrong. Name at least one ` +
        `condition, or drop the field.`,
    );
  }
  const conditions: Array<GuardConditionData & { readonly test: (a: unknown) => boolean }> = [];
  for (const key of keys) {
    if (DENIED_KEYS.has(key)) {
      refuse(where, `key "${key}" is reserved (prototype-pollution denylist).`);
    }
    const ops: unknown = (guard as Record<string, unknown>)[key];
    if (ops === null || typeof ops !== 'object' || Array.isArray(ops)) {
      refuse(where, `key "${key}" maps to ${JSON.stringify(ops)} instead of { op: value }.`);
    }
    const opEntries = Object.entries(ops as Record<string, unknown>);
    if (opEntries.length === 0) {
      refuse(where, `key "${key}" declares no operator ({}).`);
    }
    for (const [op, value] of opEntries) {
      if (!OPERATOR_SET.has(op)) {
        refuse(
          where,
          `key "${key}" uses unknown operator "${op}" (valid: ${GUARD_OPERATORS.join(', ')}).`,
        );
      }
      if (op === 'in' || op === 'notIn') {
        if (!Array.isArray(value) || value.length === 0) {
          refuse(
            where,
            `key "${key}" \`${op}\` needs a NON-EMPTY array — an empty \`in\` can never ` +
              `match and an empty \`notIn\` always does; both assert nothing.`,
          );
        }
        if (value.length > MAX_IN_ARRAY_SIZE) {
          refuse(
            where,
            `key "${key}" \`${op}\` lists ${value.length} entries (max ${MAX_IN_ARRAY_SIZE}).`,
          );
        }
        if (!value.every(isGuardValue)) {
          refuse(
            where,
            `key "${key}" \`${op}\` holds a non-data entry — every entry must be a ` +
              `string, number, boolean or null.`,
          );
        }
        const list = (value as GuardValue[]).slice();
        const test = OPERATOR_TESTS[op as GuardOperator];
        conditions.push({ key, op: op as GuardOperator, value: list, test: (a) => test(a, list) });
        continue;
      }
      if (op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte') {
        if (typeof value !== 'number' && typeof value !== 'string') {
          refuse(
            where,
            `key "${key}" \`${op}\` needs a number or a string to compare against ` +
              `(got ${JSON.stringify(value)}).`,
          );
        }
      } else if (!isGuardValue(value)) {
        refuse(
          where,
          `key "${key}" \`${op}\` holds a non-data value — a guard is data (it rides ` +
            `edges, events and recordings), so thresholds must be strings, numbers, ` +
            `booleans or null.`,
        );
      }
      const test = OPERATOR_TESTS[op as GuardOperator];
      conditions.push({
        key,
        op: op as GuardOperator,
        value: value as GuardValue,
        test: (a) => test(a, value),
      });
    }
  }
  const needsResultFields = conditions.some((c) => !HOP_KEY_SET.has(c.key));
  const valueOf = (
    view: GuardHopView,
    key: string,
    parsed: Record<string, unknown> | undefined,
  ): unknown => {
    if (HOP_KEY_SET.has(key)) return (view as unknown as Record<string, unknown>)[key];
    if (parsed === undefined) return undefined;
    return Object.prototype.hasOwnProperty.call(parsed, key) ? parsed[key] : undefined;
  };
  const data: SkillGuardData = {
    conditions: conditions.map(({ key, op, value }) => ({ key, op, value })),
  };
  return {
    data,
    predicate: (view) => {
      const parsed = needsResultFields ? parseResultObject(view.result) : undefined;
      for (const c of conditions) {
        if (!c.test(valueOf(view, c.key, parsed))) return false;
      }
      return true;
    },
    evaluate: (view) => {
      const parsed = needsResultFields ? parseResultObject(view.result) : undefined;
      let verdict = true;
      const evidence: GuardConditionEvidence[] = conditions.map((c) => {
        const actual = valueOf(view, c.key, parsed);
        const passed = c.test(actual);
        if (!passed) verdict = false;
        return { key: c.key, op: c.op, value: c.value, actualSummary: summarize(actual), passed };
      });
      return { verdict, conditions: evidence };
    },
  };
}

// ─── How it DRAWS ───────────────────────────────────────────────────────

const OP_WORDS: Record<GuardOperator, string> = {
  eq: '=',
  ne: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
  in: 'in',
  notIn: 'not in',
};

function captionValue(v: GuardValue | readonly GuardValue[]): string {
  if (Array.isArray(v)) return `[${(v as readonly GuardValue[]).map(captionValue).join(', ')}]`;
  return String(v);
}

/**
 * The UNESCAPED caption — one grammar for naming a guard, shared by the
 * mermaid label and by prose quoting a guard back to its author (the
 * `plainMatchCaption` twin): `riskLevel ≥ high AND iteration ≤ 5`.
 */
export function plainGuardCaption(g: SkillGuardData): string {
  return g.conditions
    .map((c) => `${c.key} ${OP_WORDS[c.op]} ${captionValue(c.value)}`)
    .join(' AND ');
}

/** Caption a guard-only edge for a mermaid `|…|` label — the plain caption
 *  under a leading "when", escaped once (the `mermaidMatchCaption` twin). */
export function mermaidGuardCaption(g: SkillGuardData): string {
  return `when ${plainGuardCaption(g)}`.replace(/\|/g, '#124;').replace(/"/g, '#quot;');
}

// ─── What it PROVES WRONG ───────────────────────────────────────────────

/** The route-edge preconditions a guard is judged AFTER — what the edge
 *  already requires of the same result. Only the provably-comparable forms
 *  arrive here: an exact-string `onToolReturn` (a RegExp is not decided) and
 *  the declared `onToolStatus` set. */
export interface GuardPreconditions {
  readonly onToolReturnExact?: string;
  readonly onToolStatuses?: readonly string[];
}

function conditionsFor(g: SkillGuardData, key: string): readonly GuardConditionData[] {
  return g.conditions.filter((c) => c.key === key);
}

/** Same-type ordered comparison; undefined when the types differ (a claim
 *  across types would be a guess — JS coercion is not a proof). */
function ordered(a: GuardValue, b: GuardValue): number | undefined {
  if (typeof a === 'number' && typeof b === 'number') return a === b ? 0 : a < b ? -1 : 1;
  if (typeof a === 'string' && typeof b === 'string') return a === b ? 0 : a < b ? -1 : 1;
  return undefined;
}

function boundsOf(conds: readonly GuardConditionData[]): {
  lower?: { value: string | number; strict: boolean };
  upper?: { value: string | number; strict: boolean };
} {
  let lower: { value: string | number; strict: boolean } | undefined;
  let upper: { value: string | number; strict: boolean } | undefined;
  for (const c of conds) {
    if (c.op === 'gt' || c.op === 'gte') {
      lower = { value: c.value as string | number, strict: c.op === 'gt' };
    } else if (c.op === 'lt' || c.op === 'lte') {
      upper = { value: c.value as string | number, strict: c.op === 'lt' };
    }
  }
  return { ...(lower && { lower }), ...(upper && { upper }) };
}

/** Does `v` satisfy every ordered bound among `conds`? `undefined` = not
 *  decidable (mixed types) — the caller must stay silent. */
function satisfiesBounds(v: GuardValue, conds: readonly GuardConditionData[]): boolean | undefined {
  for (const c of conds) {
    if (c.op !== 'gt' && c.op !== 'gte' && c.op !== 'lt' && c.op !== 'lte') continue;
    const cmp = ordered(v, c.value as string | number);
    if (cmp === undefined) return undefined;
    if (c.op === 'gt' && !(cmp > 0)) return false;
    if (c.op === 'gte' && !(cmp >= 0)) return false;
    if (c.op === 'lt' && !(cmp < 0)) return false;
    if (c.op === 'lte' && !(cmp <= 0)) return false;
  }
  return true;
}

/**
 * The check-up's honesty core: is this guard PROVABLY unsatisfiable — by its
 * own conditions, or against the edge's declared preconditions? Returns the
 * human why-clause, or `undefined` when nothing is provable (say nothing
 * rather than guess — the `compareMatchers` law).
 *
 * What is claimed, exactly (all same-key, all decidable from the data):
 *   • `eq` vs `ne`/`in`/`notIn`/ordered bounds on one key — a required value
 *     the same guard excludes;
 *   • crossed ordered bounds (`gt`/`gte` above `lt`/`lte`, same-type only);
 *   • `in` whose every member the same key's `notIn` excludes;
 *   • `status` values outside the CLOSED result-status vocabulary — a status
 *     a tool can never declare (`TOOL_RESULT_STATUSES` is the whole set);
 *   • the guard's `status`/`toolName` conditions vs the edge's own declared
 *     `onToolStatus` set / exact-string `onToolReturn` — two declarations on
 *     one edge, one of which must be wrong.
 * NOT claimed: anything across keys, anything involving result-JSON fields'
 * runtime values, RegExp `onToolReturn` intersection, mixed-type bounds.
 */
export function guardUnsatisfiable(
  g: SkillGuardData,
  pre?: GuardPreconditions,
): string | undefined {
  const keys = [...new Set(g.conditions.map((c) => c.key))];
  for (const key of keys) {
    const conds = conditionsFor(g, key);
    const eq = conds.find((c) => c.op === 'eq');
    const ne = conds.find((c) => c.op === 'ne');
    const inC = conds.find((c) => c.op === 'in');
    const notInC = conds.find((c) => c.op === 'notIn');
    if (eq !== undefined) {
      const e = eq.value as GuardValue;
      if (ne !== undefined && ne.value === e) {
        return `it requires ${key} = ${captionValue(e)} AND ${key} ≠ ${captionValue(
          e,
        )} — no value satisfies both`;
      }
      if (inC !== undefined && !(inC.value as readonly GuardValue[]).includes(e)) {
        return (
          `it requires ${key} = ${captionValue(e)} AND ${key} in ` +
          `${captionValue(inC.value)}, which does not contain it`
        );
      }
      if (notInC !== undefined && (notInC.value as readonly GuardValue[]).includes(e)) {
        return (
          `it requires ${key} = ${captionValue(e)} AND ${key} not in ` +
          `${captionValue(notInC.value)}, which excludes it`
        );
      }
      if (satisfiesBounds(e, conds) === false) {
        return `it requires ${key} = ${captionValue(
          e,
        )}, which violates the same key's ordered bounds`;
      }
    }
    const { lower, upper } = boundsOf(conds);
    if (lower !== undefined && upper !== undefined) {
      const cmp = ordered(lower.value, upper.value);
      if (cmp !== undefined && (cmp > 0 || (cmp === 0 && (lower.strict || upper.strict)))) {
        return (
          `its ${key} bounds are crossed (${lower.strict ? '>' : '≥'} ` +
          `${captionValue(lower.value)} AND ${upper.strict ? '<' : '≤'} ` +
          `${captionValue(upper.value)}) — no value satisfies both`
        );
      }
    }
    if (
      inC !== undefined &&
      notInC !== undefined &&
      (inC.value as readonly GuardValue[]).every((v) =>
        (notInC.value as readonly GuardValue[]).includes(v),
      )
    ) {
      return `its ${key} \`notIn\` excludes every member of the same key's \`in\` list`;
    }
    // The status vocabulary is CLOSED (toolOutcome.ts) — an eq/in value no
    // tool can ever declare is a typo the data makes provable.
    if (key === 'status') {
      const vocabulary: readonly string[] = TOOL_RESULT_STATUSES;
      if (eq !== undefined && typeof eq.value === 'string' && !vocabulary.includes(eq.value)) {
        return (
          `"${eq.value}" is not a result status any tool can declare ` +
          `(the closed set: ${vocabulary.join(', ')})`
        );
      }
      if (
        inC !== undefined &&
        (inC.value as readonly GuardValue[]).every(
          (v) => typeof v !== 'string' || !vocabulary.includes(v),
        )
      ) {
        return (
          `none of its status \`in\` entries ${captionValue(inC.value)} is a result ` +
          `status any tool can declare (the closed set: ${vocabulary.join(', ')})`
        );
      }
    }
  }
  // The edge's own preconditions AND with the guard over the SAME result —
  // two declarations that provably disagree are one edge that never fires.
  if (pre?.onToolStatuses !== undefined) {
    const s = pre.onToolStatuses;
    for (const c of conditionsFor(g, 'status')) {
      if (c.op === 'eq' && !s.includes(c.value as string)) {
        return (
          `the edge routes on onToolStatus [${s.join(', ')}] but its guard requires ` +
          `status = ${captionValue(c.value)} — the two can never both hold`
        );
      }
      if (
        c.op === 'in' &&
        !(c.value as readonly GuardValue[]).some((v) => s.includes(v as string))
      ) {
        return (
          `the edge routes on onToolStatus [${s.join(', ')}] but its guard requires ` +
          `status in ${captionValue(c.value)} — the sets are disjoint`
        );
      }
      if (c.op === 'ne' && s.length === 1 && s[0] === c.value) {
        return (
          `the edge routes only on onToolStatus [${s[0]}] but its guard requires ` +
          `status ≠ ${captionValue(c.value)}`
        );
      }
      if (c.op === 'notIn' && s.every((v) => (c.value as readonly GuardValue[]).includes(v))) {
        return (
          `the edge routes on onToolStatus [${s.join(', ')}] but its guard's \`notIn\` ` +
          `excludes every one of those statuses`
        );
      }
    }
  }
  if (pre?.onToolReturnExact !== undefined) {
    const t = pre.onToolReturnExact;
    for (const c of conditionsFor(g, 'toolName')) {
      if (c.op === 'eq' && c.value !== t) {
        return (
          `the edge routes on onToolReturn "${t}" but its guard requires ` +
          `toolName = ${captionValue(c.value)}`
        );
      }
      if (c.op === 'ne' && c.value === t) {
        return `the edge routes on onToolReturn "${t}" but its guard requires toolName ≠ "${t}"`;
      }
      if (c.op === 'in' && !(c.value as readonly GuardValue[]).includes(t)) {
        return (
          `the edge routes on onToolReturn "${t}" but its guard's toolName \`in\` list ` +
          `${captionValue(c.value)} does not contain it`
        );
      }
      if (c.op === 'notIn' && (c.value as readonly GuardValue[]).includes(t)) {
        return (
          `the edge routes on onToolReturn "${t}" but its guard's toolName \`notIn\` list ` +
          `excludes it`
        );
      }
    }
  }
  return undefined;
}
