/**
 * served — what an event of a run is SERVED as: its payload and the identity
 * on its meta, through the run's redaction rule.
 *
 * Pattern: one projection, decided once per event, by footprintjs's rule,
 *          over the event registry's own classification
 *          (`events/content.ts` · `EVENT_CONTENT`).
 * Role:    the Lens half of `src/redaction/`. It decides nothing about what is
 *          secret — `RedactionRule` (footprintjs/advanced) does, the ONE owner
 *          of every verdict — and it keeps nothing: no list of runs, listeners
 *          or values, and no cache outside the one run's serving. It says which
 *          of the rule's own decisions applies to a typed event:
 *
 *   - THE EVENT'S NAME — `retainEmit`: an event whose name `emitPatterns`
 *     selects is served with the placeholder for a payload, exactly as
 *     footprintjs serves a `$emit` payload it selects by name.
 *   - THE PAYLOAD — `retainBoundary`: a typed event's payload is a record
 *     handed out whole — a selected key at ANY depth, and a declared field
 *     under a key of its name.
 *   - THE WORDS IT QUOTES — the registry's `words` rows: content carried under
 *     a name of its own (a parser's message quotes the model's draft) is
 *     served as the placeholder whenever the rule keeps out any part of a
 *     value it came from — the rule's taint law, applied to the library's
 *     own copies.
 *   - DEFAULT-DENY — under a rule that keeps the conversation out
 *     (`conversationRedaction()` or more), every top-level field the registry
 *     does not declare STRUCTURE is served as the placeholder: a field nobody
 *     classified — on an event of the library's or the app's own — can never
 *     carry the conversation into a record.
 *   - THE META'S IDENTITY — `principal` and `tenant` are who asked, selected
 *     by their names like any other value; every other meta field is the
 *     record's ADDRESS and is never selected.
 *
 * A payload whose scrub cannot run (an uncloneable value under a selected
 * field, a getter that throws) is served as the placeholder whole, never raw.
 */

import type { RedactionRule } from 'footprintjs/advanced';

import {
  EVENT_CONTENT,
  type ClassifiedContent,
  type EventWords,
  type StructureKind,
} from '../events/content.js';
import type { EventMeta } from '../events/types.js';
import { ruleKeepsConversationOut } from './conversation.js';
import { NO_DECLARED_NAMES, type DeclaredNames } from './names.js';

/** The placeholder footprintjs serves a record handed out whole with. */
export const SERVED_PLACEHOLDER = '[REDACTED]';

/** What one run's events are served as. */
export interface EventServing {
  /** True when the run's rule can select anything — the no-policy fast path is `false`. */
  active(): boolean;
  /** The payload as served: the placeholder, a scrubbed copy, or the payload itself. */
  payload(type: string, payload: unknown): unknown;
  /** The meta as served: the same object unless its identity was selected. */
  meta<M extends EventMeta>(meta: M): M;
}

/**
 * Serving through `ruleOf()` — read on every event, because the rule a run
 * decides with is the executor's own and footprintjs builds a fresh one per
 * leg (a resume continues the paused run's marks on a new rule).
 *
 * @param ruleOf      the rule in force for the current event
 * @param hasEmitNames whether the policy selects any event by NAME
 *                    (`emitPatterns`) — a policy with only those keeps the
 *                    state rule inert, and inertness alone would skip them
 * @param names       the names the run's runner declared (`names.ts`) — what a
 *                    `declaredName` field may hold; none given, none declared
 */
export function eventServing(
  ruleOf: () => RedactionRule,
  hasEmitNames: boolean,
  names: DeclaredNames = NO_DECLARED_NAMES,
): EventServing {
  const active = (): boolean => hasEmitNames || !ruleOf().isInert();
  // Whether the run's rule keeps the whole conversation out — remembered for
  // the rule that said so (a rule only ever adds names), in THIS serving's own
  // closure: nothing about one run outlives it or reaches another.
  let coveringRule: RedactionRule | undefined;
  const conversationOut = (rule: RedactionRule): boolean => {
    if (coveringRule === rule) return true;
    if (!ruleKeepsConversationOut(rule)) return false;
    coveringRule = rule;
    return true;
  };
  return {
    active,
    payload(type, payload) {
      if (!active()) return payload;
      const rule = ruleOf();
      return servedPayload(rule, type, payload, () => conversationOut(rule), names);
    },
    meta(meta) {
      if (meta.principal === undefined && meta.tenant === undefined) return meta;
      if (!active()) return meta;
      return servedMeta(ruleOf(), meta);
    },
  };
}

/** An event type the registry does not know (an app's own): every field is content. */
const UNCLASSIFIED: ClassifiedContent = Object.freeze({ structure: Object.freeze({}) });

/** The registry's classification of `type` — never a prototype property a type string happens to name. */
function contentOf(type: string): ClassifiedContent {
  return Object.prototype.hasOwnProperty.call(EVENT_CONTENT, type)
    ? (EVENT_CONTENT as unknown as Readonly<Record<string, ClassifiedContent>>)[type] ??
        UNCLASSIFIED
    : UNCLASSIFIED;
}

/**
 * The registry's `words` rows as rows — for the test that pins them against
 * the event registry and the conversation vocabulary.
 *
 * @internal
 */
export function derivedRows(): readonly {
  readonly type: string;
  readonly paths: readonly string[];
  readonly from: readonly string[];
  readonly namedBy?: string;
}[] {
  return Object.entries(
    EVENT_CONTENT as unknown as Readonly<Record<string, ClassifiedContent>>,
  ).flatMap(([type, content]) => (content.words ?? []).map((entry) => ({ type, ...entry })));
}

/** The served form of one payload — see the file header for the decisions. */
function servedPayload(
  rule: RedactionRule,
  type: string,
  payload: unknown,
  conversationOut: () => boolean,
  names: DeclaredNames,
): unknown {
  try {
    const named = rule.retainEmit(type, payload);
    if (named !== payload) return named;
    return withContentKeptOut(
      rule,
      contentOf(type),
      rule.retainBoundary(payload),
      payload,
      conversationOut,
      names,
    );
  } catch {
    return SERVED_PLACEHOLDER;
  }
}

/**
 * `served` with the content it carries kept out: the words rows by the values
 * they come from, and — under a rule that keeps the conversation out — every
 * top-level field not declared structure. `original` is the payload before
 * the rule served it: what the rule changed inside a `namesAt` object is read
 * off the two.
 */
function withContentKeptOut(
  rule: RedactionRule,
  content: ClassifiedContent,
  served: unknown,
  original: unknown,
  conversationOut: () => boolean,
  names: DeclaredNames,
): unknown {
  const decided = (content.words ?? []).map((entry) => ({
    entry,
    whole:
      entry.from.some((name) => sourceKeptOut(rule, name)) ||
      (entry.namesAt !== undefined && renderedFromKeptOut(served, original, entry.namesAt)),
  }));
  const conversation = conversationOut();
  if (!isPlainRecord(served)) {
    // A payload whose fields cannot be read: whole, when anything in it is kept out.
    return (conversation || decided.some((d) => d.whole)) && served !== SERVED_PLACEHOLDER
      ? SERVED_PLACEHOLDER
      : served;
  }
  let out: unknown = served;
  for (const { entry, whole } of decided) {
    if (!whole && entry.namedBy === undefined) continue;
    out = maskWords(out, entry, whole, rule);
  }
  return conversation ? servedByKinds(out, content.structure, names) : out;
}

/** `node` with one words row's paths served as the placeholder where they are kept out. */
function maskWords(node: unknown, entry: EventWords, whole: boolean, rule: RedactionRule): unknown {
  const keptOut = (owner: Readonly<Record<string, unknown>>): boolean =>
    whole || (entry.namedBy !== undefined && argumentKeptOut(rule, owner[entry.namedBy]));
  let out = node;
  for (const path of entry.paths) out = maskAt(out, path.split('.'), keptOut);
  return out;
}

/**
 * DEFAULT-DENY, BY KIND: `node` with every field the classification does not
 * declare served as the placeholder, and every declared field checked against
 * its kind — at every depth — copied on write, the SAME object when nothing
 * changed. A value that does not fit its kind is served as the placeholder: a
 * string in a count, a name nothing declared, free text where an id belongs.
 */
function servedByKinds(
  node: unknown,
  structure: Readonly<Record<string, StructureKind>>,
  names: DeclaredNames,
): unknown {
  return fitRecord(node, structure, names);
}

/** `value` as kind `kind` serves it — itself when it fits, the placeholder (or a copy with parts masked) when not. */
function fitKind(value: unknown, kind: StructureKind, names: DeclaredNames): unknown {
  if (value === undefined || value === null || value === SERVED_PLACEHOLDER) return value;
  switch (kind.kind) {
    case 'count':
      return typeof value === 'number' && Number.isFinite(value) ? value : SERVED_PLACEHOLDER;
    case 'flag':
      return typeof value === 'boolean' ? value : SERVED_PLACEHOLDER;
    case 'enum':
      return typeof value === 'string' && Object.prototype.hasOwnProperty.call(kind.of, value)
        ? value
        : SERVED_PLACEHOLDER;
    case 'mintedId':
      return typeof value === 'string' && MINTED_ID.test(value) ? value : SERVED_PLACEHOLDER;
    case 'declaredName':
      return typeof value === 'string' && names.has(kind.of, value) ? value : SERVED_PLACEHOLDER;
    case 'list': {
      if (!Array.isArray(value)) return SERVED_PLACEHOLDER;
      const items = value.map((item) => fitKind(item, kind.of, names));
      return items.some((item, i) => item !== value[i]) ? items : value;
    }
    case 'record':
      return fitRecord(value, kind.fields as Readonly<Record<string, StructureKind>>, names);
    case 'map': {
      if (!isPlainRecord(value)) return SERVED_PLACEHOLDER;
      // A key is a name too: one that does not fit makes the whole map content.
      const keys = Object.keys(value);
      if (keys.some((key) => fitKind(key, kind.key, names) !== key)) return SERVED_PLACEHOLDER;
      let copy: Record<string, unknown> | undefined;
      for (const key of keys) {
        const fitted = fitKind(value[key], kind.value, names);
        if (fitted === value[key]) continue;
        copy ??= { ...value };
        copy[key] = fitted;
      }
      return copy ?? value;
    }
    case 'anyOf':
      return kind.of.some((alternative) => fitKind(value, alternative, names) === value)
        ? value
        : SERVED_PLACEHOLDER;
  }
}

/** A record checked field by field against `fields`: every other field is content. */
function fitRecord(
  value: unknown,
  fields: Readonly<Record<string, StructureKind>>,
  names: DeclaredNames,
): unknown {
  if (!isPlainRecord(value)) return SERVED_PLACEHOLDER;
  let copy: Record<string, unknown> | undefined;
  for (const key of Object.keys(value)) {
    const kind = Object.prototype.hasOwnProperty.call(fields, key) ? fields[key] : undefined;
    const fitted = kind === undefined ? undeclared(value[key]) : fitKind(value[key], kind, names);
    if (fitted === value[key]) continue;
    copy ??= { ...value };
    copy[key] = fitted;
  }
  return copy ?? value;
}

/** A field nobody declared: the placeholder, unless absent or already it. */
const undeclared = (value: unknown): unknown =>
  value === undefined || value === SERVED_PLACEHOLDER ? value : SERVED_PLACEHOLDER;

/**
 * The grammar of a minted id — a run, call, stage or artifact id, a hash, a
 * provider's ref or stop token, a library timestamp: one token of id
 * characters. Text with a space in it is never an id.
 */
const MINTED_ID = /^[A-Za-z0-9_.:#~/@+=-]{1,256}$/;

/**
 * Whether the rule keeps out ANY part of the value named `name` — the whole of
 * it (a key, a pattern on its name, a mark) or fields inside it (`fields`, or
 * fields a subflow mapper handed it): content the library derives from that
 * value may quote any part of it, so it is kept out whenever part of the source
 * is. Asked of the rule's own verdict, never decided here.
 */
function sourceKeptOut(rule: RedactionRule, name: string): boolean {
  return rule.verdict([name]).kind !== 'clear';
}

/**
 * Whether the rule kept out anything inside the object at `path` that a value
 * was rendered from — read off the two payloads (the rule hands an untouched
 * object back as itself). A path that cannot be walked in either is kept out:
 * what it rendered cannot be vouched for.
 */
function renderedFromKeptOut(served: unknown, original: unknown, path: string): boolean {
  const before = valueAt(original, path);
  const after = valueAt(served, path);
  if (before === UNWALKABLE || after === UNWALKABLE) return true;
  // An object the rule cannot see into (a Map, a class instance): unvouched.
  if (before !== null && typeof before === 'object' && !Array.isArray(before)) {
    if (!isPlainRecord(before)) return true;
  }
  return before !== after;
}

/** {@link valueAt}'s answer for a path that runs into something it cannot walk. */
const UNWALKABLE: unique symbol = Symbol('unwalkable');

/**
 * The value at the dotted `path` in `node` — `undefined` off the end of plain
 * data, {@link UNWALKABLE} where it runs into a value that is not a plain record
 * (a list, a Map, a class instance).
 */
function valueAt(node: unknown, path: string): unknown {
  let at: unknown = node;
  for (const segment of path.split('.')) {
    if (at === undefined || at === null) return undefined;
    if (!isPlainRecord(at)) return UNWALKABLE;
    at = at[segment];
  }
  return at;
}

/**
 * Whether the rule keeps out the value at the argument path `named` names
 * (`'customer.ssn'`, `'items[0].pin'`) — asked of the rule itself, over the
 * shape a call's arguments travel in (`{ args: … }`, as on `tool_start`), so a
 * key, a pattern, a dotted-path pattern and a `fields` selector all count. A
 * path the rule cannot be asked about is kept out (fail closed).
 */
function argumentKeptOut(rule: RedactionRule, named: unknown): boolean {
  // No path to ask about (absent, or not text): the value quotes an argument
  // nobody can name, so it is kept out — fail closed.
  if (typeof named !== 'string') return true;
  const segments = named.split(/[.[\]]/).filter((name) => name.length > 0);
  // The arguments' root: the value IS the arguments, kept out with them (`whole`).
  if (segments.length === 0) return false;
  const leaf: unknown = 'value';
  const nested = segments.reduceRight<unknown>((inner, name) => ({ [name]: inner }), leaf);
  const probe = { args: nested };
  try {
    return rule.retainBoundary(probe) !== probe;
  } catch {
    return true;
  }
}

/**
 * `node` with the value at `segments` served as the placeholder when
 * `keptOut(owner)` says so — copied on write along the path, the SAME object
 * when nothing changed. `name[]` walks each element of a list.
 */
function maskAt(
  node: unknown,
  segments: readonly string[],
  keptOut: (owner: Readonly<Record<string, unknown>>) => boolean,
): unknown {
  if (!isPlainRecord(node) || segments.length === 0) return node;
  const [head, ...rest] = segments as [string, ...string[]];
  const list = head.endsWith('[]');
  const key = list ? head.slice(0, -2) : head;
  const child = node[key];
  if (child === undefined || child === null || child === SERVED_PLACEHOLDER) return node;
  let next: unknown = child;
  if (rest.length === 0) {
    if (keptOut(node)) next = SERVED_PLACEHOLDER;
  } else if (list ? !Array.isArray(child) : !isPlainRecord(child)) {
    // A value the path cannot be walked into (a list where a record belongs,
    // a Map, a class instance): what it holds cannot be vouched for, so it is
    // served whole as the placeholder when the owner's content is kept out.
    if (keptOut(node)) next = SERVED_PLACEHOLDER;
  } else if (list) {
    const items = (child as readonly unknown[]).map((item) =>
      isPlainRecord(item) || item === undefined || item === null
        ? maskAt(item, rest, keptOut)
        : keptOut(node)
        ? SERVED_PLACEHOLDER
        : item,
    );
    if (items.some((item, i) => item !== (child as readonly unknown[])[i])) next = items;
  } else {
    next = maskAt(child, rest, keptOut);
  }
  return next === child ? node : { ...node, [key]: next };
}

/**
 * Plain data: an object whose prototype is `Object.prototype` or `null` — the
 * only shape the paths walk into. Anything else (a Map, a Set, a class
 * instance, an Error) holds what the paths cannot see.
 */
const isPlainRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
};

/** The meta with its identity served by name; the address untouched. */
function servedMeta<M extends EventMeta>(rule: RedactionRule, meta: M): M {
  const identity: { principal?: string; tenant?: string } = {
    ...(meta.principal !== undefined && { principal: meta.principal }),
    ...(meta.tenant !== undefined && { tenant: meta.tenant }),
  };
  let kept: { principal?: unknown; tenant?: unknown };
  try {
    kept = rule.retainBoundary(identity);
  } catch {
    kept = Object.fromEntries(Object.keys(identity).map((key) => [key, SERVED_PLACEHOLDER]));
  }
  if (kept === identity) return meta;
  return { ...meta, ...kept } as M;
}
