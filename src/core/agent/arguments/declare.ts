/**
 * arguments/declare — what a tool author declares about its arguments, and the
 * ONE rule set that judges the declaration.
 *
 * Pattern: Map. A declaration is plain data on the `Tool` (`askOrAssume`,
 *          `period`), judged by one assert at three doors: definition
 *          (`core/tools.ts` · `defineTool`), dispatch (`rulesOf`, because a
 *          Tool built by hand or served by a ToolProvider never passes through
 *          `defineTool`) and MCP ingest (`lib/mcp/toolExtras.ts` ·
 *          `readToolExtras`). A malformed declaration is refused and never
 *          repaired.
 * Role:    core/ layer leaf of the inputs layer (honesty layer 2). Imports
 *          nothing from `findings/` — the folder's one-way law.
 * Emits:   N/A.
 *
 * ## The two forms of a rule
 *
 *   - `{ assume: value }` — a value the call leaves out is FILLED BY THE
 *     LIBRARY (never by the tool) and recorded as `default`; the answer's
 *     standing then says the value was assumed.
 *   - `{ ask: question, choices? }` — a value the call leaves out is asked of
 *     the person, ONCE per batch, before anything in the batch runs, through
 *     the typed ask (`core/inputRequest.ts`); the answer is filled and
 *     recorded as `answered` (`arguments/ask.ts`). A PRESENT value runs,
 *     recorded as the model's own — unless declared sources are armed
 *     (`.inputsLayer({ argumentSources: true })`, or `.findings({ argumentSources:
 *     true })` beside the ledger): then the model says where it
 *     came from, the library checks it (`checks.ts` · `checkSource`), and a
 *     value the check does not trace is asked about too. A choice may carry
 *     phrases the author vouches for (`{ value, said }`), matched only inside
 *     a quote the model declared.
 *
 * ## The period — `ToolPeriod`
 *
 * Which argument bounds the period the answer covers, and how its values are
 * SPELLED: `lookback` (`30m`, `24h`, `7d`, `2w`), `signed-lookback` (`-24h`),
 * `iso-range` (two ISO 8601 instants joined by `..`) or `wall-range` (two wall
 * times joined by `..`, with the zone in `zoneArgument`). Declared formats,
 * never phrases. A period on an argument with no rule is refused (adopted
 * Q13): a period argument is exactly what a rule is for.
 *
 * Since the time layer's step T5a the single-argument form is SUGAR over
 * `forms` (`core/time/convert.ts` · `sugarForms`): a tool declares every shape
 * its period takes — two arguments (`bounds`), one joined string, an object, a
 * `day`, a look-back with its `units` — and the facts about its source
 * (`direction`, `retention`, `maxRange`, `granularity`, `filtersToAsked`).
 * Under `.time()` the library fills a period the model left out from the
 * turn's one window, binds a sent one to the person's window, and hands the
 * tool `ctx.time` (`core/time/bind.ts`). Without `.time()` a period is judged
 * and read exactly as before.
 */

import { isDevMode } from 'footprintjs';

import { isInputFieldValue, type InputValue } from '../../inputRequest.js';
import {
  FACT_UNITS,
  formArguments,
  formIssue,
  needsZone,
  parsesUnderForm,
  PERIOD_SPELLINGS,
  primaryArgument,
  sugarForms,
  type PeriodDirection,
  type PeriodFacts,
  type PeriodForm,
  type PeriodSpelling,
} from '../../time/periodForm.js';
import { isDuration, LOOKBACK_UNITS, type DurationText } from '../../time/duration.js';
import { splitRange } from '../../time/range.js';
import { canonicalForm, tokenize } from '../evidence/normalize.js';
import { validatePropertyValue } from '../toolArgsValidation.js';

// ─── The declaration ────────────────────────────────────────────────────

/**
 * One allowed answer to an `ask` rule: a bare value, or a value with phrases
 * the author vouches for as meaning it (`{ value: '7d', said: ['last week'] }`).
 * The phrases are matched as whole tokens, only inside a quote the model
 * declared — never scanned for in the person's words.
 */
export type AskChoice =
  | InputValue
  | { readonly value: InputValue; readonly said?: readonly string[] };

/**
 * One argument's rule — either ask the person, or assume a declared default.
 *
 * `assume`: a value the call leaves out is filled by the library and recorded
 * as `default`. `ask`: a value the call leaves out is asked of the person once
 * per batch, before anything in the batch runs, and recorded as `answered`.
 */
export type ArgumentRule =
  | { readonly ask: string; readonly choices?: readonly AskChoice[] }
  | { readonly assume: InputValue };

/** Per argument name, its rule. Arguments with no rule run free. */
export type AskOrAssume = Readonly<Record<string, ArgumentRule>>;

export type { PeriodSpelling, PeriodForm, PeriodFacts } from '../../time/periodForm.js';
export { PERIOD_SPELLINGS };

/**
 * Which arguments set the period a tool's answer covers, how their values are
 * spelled, and the facts about the source. The one period shape's TOOL half;
 * the result half (`DeclaredPeriod`: what a read queried and what the store
 * holds) belongs to the result doors.
 *
 * Two ways to name the shape, never both: today's single argument
 * (`argument` + `spelling`, or `accepts` for several spellings, and
 * `zoneArgument` beside a `wall-range`), which is sugar over the general
 * `forms` — every shape the tool accepts, in preference order.
 *
 * @example
 * ```ts
 * period: { argument: 'window', spelling: 'lookback' }  // '2h', '24h', '7d'
 * period: {
 *   forms: [{ kind: 'bounds',
 *             from: { argument: 'start_time', as: 'epoch-ms' },
 *             to:   { argument: 'end_time',   as: 'epoch-ms', edge: 'exclusive' } }],
 *   direction: 'past', retention: '30d',
 * }
 * ```
 */
export interface ToolPeriod {
  // ── the single-argument form, sugar over `forms` ──
  readonly argument?: string;
  readonly spelling?: PeriodSpelling;
  /** Every single-argument spelling the argument takes, in preference order. */
  readonly accepts?: readonly PeriodSpelling[];
  /** The argument that carries the zone of a `wall-range`. */
  readonly zoneArgument?: string;
  // ── the general form ──
  readonly forms?: readonly PeriodForm[];
  /** A `wall` / `date` / `day` form with no zone argument reads in the app's `.time({ zone })` — explicit, never implied. */
  readonly wallZone?: 'app';
  // ── facts about the source — never policy ──
  /** Which side of now the source can hold; absent: not checked. */
  readonly direction?: PeriodDirection;
  /** The oldest data the source keeps (`30d`). */
  readonly retention?: DurationText;
  /** The widest window the tool accepts at once (`24h`). */
  readonly maxRange?: DurationText;
  /** The source's smallest step (`1m`). */
  readonly granularity?: DurationText;
  /** The tool reads `ctx.time.asked` and drops rows outside it. */
  readonly filtersToAsked?: boolean;
}

// ─── The bounds ─────────────────────────────────────────────────────────

/** The JSON Schema types a ruled argument may have — flat primitives only (v1). */
export const RULED_TYPES: readonly string[] = Object.freeze([
  'string',
  'number',
  'integer',
  'boolean',
]);
/** An `ask` question's bound — the typed ask's own (`core/inputRequest.ts`). */
export const ASK_QUESTION_CHARS = 4096;
/** Choices per `ask` rule. */
export const MAX_CHOICES = 100;
/** One `said` phrase's length. */
export const SAID_PHRASE_CHARS = 120;
/** `said` phrases per choice. */
export const MAX_SAID_PHRASES = 16;
/** Arguments that may carry `ask` on one tool — the typed ask's field limit. */
export const MAX_ASK_ARGUMENTS = 32;

// ─── Missing ────────────────────────────────────────────────────────────

/**
 * The ONE owner of "this argument is missing from this call": no own key, or
 * a value that is `undefined`, `null`, or a string that is empty after
 * trimming. Deterministic; never a reading of what the value means.
 *
 * @example
 * ```ts
 * isMissing({ service: 'checkout' }, 'window');      // true — no key
 * isMissing({ window: '  ' }, 'window');             // true — blank string
 * isMissing({ window: '2h' }, 'window');             // false
 * ```
 */
export function isMissing(args: Readonly<Record<string, unknown>>, argument: string): boolean {
  if (!Object.prototype.hasOwnProperty.call(args, argument)) return true;
  const value = args[argument];
  if (value === undefined || value === null) return true;
  return typeof value === 'string' && value.trim() === '';
}

// ─── Values ─────────────────────────────────────────────────────────────

function isInputValue(value: unknown): value is InputValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value))
  );
}

/** The canonical token sequence of a value — the evidence module's "same value". */
function canonicalTokens(value: InputValue): readonly string[] {
  return tokenize(String(value)).map(canonicalForm);
}

/**
 * Whether two argument values are the same value: same JavaScript type, and
 * the same token sequence under the evidence module's normaliser
 * (`evidence/normalize.ts` · `tokenize`, `canonicalForm` — one owner of "the
 * same value", so `41,200` ≡ `41200` here exactly as at the evidence gate). A
 * value with no token after normalisation equals nothing, not even itself: it
 * cannot be checked, and "cannot be checked" is never "equal".
 */
export function sameArgumentValue(a: unknown, b: unknown): boolean {
  if (!isInputValue(a) || !isInputValue(b) || typeof a !== typeof b) return false;
  const left = canonicalTokens(a);
  const right = canonicalTokens(b);
  if (left.length === 0 || left.length !== right.length) return false;
  return left.every((token, i) => token === right[i]);
}

// ─── Spellings ──────────────────────────────────────────────────────────

// The grammars live in the time layer (`src/core/time/`): a look-back is
// `duration.ts` under today's units (`LOOKBACK_UNITS`, `mhdw` — no `s`, no
// digit cap), and an `iso-range` is `range.ts` · `splitRange` under `..` in
// the STRICT instant profile (upper-case `T`/`Z`, no leap second, the day
// checked against its month, no hour 24).

/**
 * Whether `value` is spelled the way `spelling` declares. `lookback` is a
 * positive integer and a unit (`m`, `h`, `d`, `w`); `signed-lookback` the
 * same with a leading minus; `iso-range` two ISO 8601 instants WITH a zone,
 * joined by `..`, each a day that exists (`2026-02-30` and hour `24` are
 * refused — `Date.parse` used to roll them forward). A format check, never a
 * conversion: nothing is ever turned into a duration, and no instant is
 * compared with "now".
 */
export function parsesUnderSpelling(value: unknown, spelling: PeriodSpelling): boolean {
  if (typeof value !== 'string') return false;
  switch (spelling) {
    case 'lookback':
      return isDuration(value, LOOKBACK_UNITS);
    case 'signed-lookback':
      return value.startsWith('-') && isDuration(value.slice(1), LOOKBACK_UNITS);
    case 'iso-range':
      return splitRange(value, '..', 'strict') !== undefined;
    case 'wall-range':
      return parsesUnderForm(
        value,
        { kind: 'joined', argument: '_', as: 'wall', joiner: '..' },
        '_',
      );
  }
}

/**
 * Convert a period value between the two spellings the library converts —
 * `lookback` ↔ `signed-lookback`, by adding or removing the leading minus.
 * Nothing is ever turned into a duration; an `iso-range` is never converted.
 * `undefined` when the value does not parse under `from`. The one owner: the
 * batch ask's shared period field (`ask.ts` · `periodsShareField`) and the
 * declared-sources check's earlier answer in another spelling (`checks.ts` ·
 * `checkSource`, `matched: 'spelling'`) both convert through it.
 */
export function convertSpelling(
  value: InputValue,
  from: PeriodSpelling,
  to: PeriodSpelling,
): InputValue | undefined {
  if (!parsesUnderSpelling(value, from)) return undefined;
  if (from === to) return value;
  const text = value as string;
  if (from === 'lookback' && to === 'signed-lookback') return `-${text}`;
  if (from === 'signed-lookback' && to === 'lookback') return text.slice(1);
  return undefined;
}

// ─── The refusal ────────────────────────────────────────────────────────

type PlainObject = Record<string, unknown>;

const isPlainObject = (value: unknown): value is PlainObject =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

class DeclarationRefused extends Error {}

function refuse(toolName: string, where: string, problem: string): never {
  throw new DeclarationRefused(`defineTool('${toolName}'): ${where} — ${problem}`);
}

const describeValue = (value: unknown): string => {
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
};

/** The property schema a rule names, or a refusal naming why it cannot be ruled. */
function ruledProperty(
  toolName: string,
  argument: string,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
  wants: Readonly<Record<string, string>> | undefined,
): PlainObject {
  const where = `askOrAssume.${argument}`;
  const properties = isPlainObject(inputSchema?.properties)
    ? (inputSchema?.properties as PlainObject)
    : undefined;
  const property =
    properties !== undefined && Object.prototype.hasOwnProperty.call(properties, argument)
      ? properties[argument]
      : undefined;
  if (!isPlainObject(property)) {
    refuse(
      toolName,
      where,
      `the tool's inputSchema declares no property '${argument}'. A rule governs an ` +
        `argument the schema offers; declare the property first, or drop the rule.`,
    );
  }
  const type = property.type;
  if (typeof type !== 'string' || !RULED_TYPES.includes(type) || property.nullable === true) {
    refuse(
      toolName,
      where,
      `the property's type is ${describeValue(type)}${
        property.nullable === true ? ' (nullable)' : ''
      }. A ruled argument is exactly one of ${RULED_TYPES.join(', ')} in this version — a type ` +
        `union, a nullable type, an object or an array is not ruled.`,
    );
  }
  if (wants !== undefined && Object.prototype.hasOwnProperty.call(wants, argument)) {
    refuse(
      toolName,
      where,
      `'${argument}' is a \`wants\` argument — an artifact ref, which is never the person's to ` +
        `type and never a default. It cannot carry a rule.`,
    );
  }
  return property;
}

/** A value the property's own schema accepts, or a refusal. */
function assertFitsProperty(
  toolName: string,
  where: string,
  value: unknown,
  property: PlainObject,
): void {
  if (!isInputValue(value)) {
    refuse(
      toolName,
      where,
      `${describeValue(value)} is not a string, a finite number or a boolean.`,
    );
  }
  const verdict = validatePropertyValue(value, property);
  if (!verdict.ok) {
    const issue = verdict.issues[0];
    refuse(
      toolName,
      where,
      `${describeValue(value)} fails the property's own schema (expected ${
        issue?.expected ?? 'a valid value'
      }).`,
    );
  }
}

/** One `said` list, judged. Phrases seen on earlier choices are passed in. */
function assertSaid(
  toolName: string,
  where: string,
  said: unknown,
  seen: Map<string, string>,
  choiceLabel: string,
): void {
  if (!Array.isArray(said)) {
    refuse(toolName, `${where}.said`, 'must be an array of phrases.');
  }
  if (said.length > MAX_SAID_PHRASES) {
    refuse(
      toolName,
      `${where}.said`,
      `declares ${said.length} phrases; at most ${MAX_SAID_PHRASES} per choice.`,
    );
  }
  for (const phrase of said) {
    if (typeof phrase !== 'string' || tokenize(phrase).length === 0) {
      refuse(
        toolName,
        `${where}.said`,
        `${describeValue(phrase)} has no word left after normalisation — a phrase must be ` +
          `matchable as whole tokens.`,
      );
    }
    if (phrase.length > SAID_PHRASE_CHARS) {
      refuse(
        toolName,
        `${where}.said`,
        `a phrase is ${phrase.length} characters; at most ${SAID_PHRASE_CHARS}.`,
      );
    }
    const key = tokenize(phrase).map(canonicalForm).join(' ');
    const earlier = seen.get(key);
    if (earlier !== undefined && earlier !== choiceLabel) {
      refuse(
        toolName,
        `${where}.said`,
        `the phrase ${describeValue(phrase)} is declared for two choices (${earlier} and ` +
          `${choiceLabel}) — a phrase may mean one choice.`,
      );
    }
    seen.set(key, choiceLabel);
  }
}

/** The value of one choice entry, after its own shape is judged. */
function choiceValue(toolName: string, where: string, entry: unknown): unknown {
  if (!isPlainObject(entry)) return entry;
  for (const key of Object.keys(entry)) {
    if (key !== 'value' && key !== 'said') {
      refuse(
        toolName,
        where,
        `unknown key '${key}' on a choice — a choice is a value, or { value, said? }.`,
      );
    }
  }
  return entry.value;
}

/** An `ask` rule, judged in full. */
function assertAskRule(
  toolName: string,
  argument: string,
  rule: PlainObject,
  property: PlainObject,
): void {
  const where = `askOrAssume.${argument}`;
  const ask = rule.ask;
  if (typeof ask !== 'string' || ask.trim() === '' || ask.length > ASK_QUESTION_CHARS) {
    refuse(
      toolName,
      `${where}.ask`,
      `must be a non-blank question of at most ${ASK_QUESTION_CHARS} characters.`,
    );
  }
  if (rule.choices === undefined) return;
  const choices = rule.choices;
  if (!Array.isArray(choices) || choices.length === 0 || choices.length > MAX_CHOICES) {
    refuse(
      toolName,
      `${where}.choices`,
      `must be a non-empty array of at most ${MAX_CHOICES} entries.`,
    );
  }
  const values: unknown[] = [];
  const seenPhrases = new Map<string, string>();
  choices.forEach((entry: unknown, i: number) => {
    const at = `${where}.choices[${i}]`;
    const value = choiceValue(toolName, at, entry);
    assertFitsProperty(toolName, at, value, property);
    // The typed ask's own field rule (`core/inputRequest.ts` · `isInputFieldValue`):
    // a choice it cannot offer is refused HERE, by name, never at the ask.
    if (!isInputFieldValue(value)) {
      refuse(
        toolName,
        at,
        `${describeValue(value)} cannot be offered by the typed ask — a choice is a ` +
          'non-blank string of at most 4096 characters, a finite number or a boolean.',
      );
    }
    if (values.some((v) => v === value)) {
      refuse(toolName, at, `repeats the value ${describeValue(value)}.`);
    }
    values.push(value);
    if (isPlainObject(entry) && entry.said !== undefined) {
      assertSaid(toolName, at, entry.said, seenPhrases, describeValue(value));
    }
  });
}

/** One argument's rule, judged; answers which form it is. */
function assertRule(
  toolName: string,
  argument: string,
  rule: unknown,
  property: PlainObject,
): 'ask' | 'assume' {
  const where = `askOrAssume.${argument}`;
  if (!isPlainObject(rule)) {
    refuse(toolName, where, 'must be { assume: value } or { ask: question, choices? }.');
  }
  const hasAsk = Object.prototype.hasOwnProperty.call(rule, 'ask');
  const hasAssume = Object.prototype.hasOwnProperty.call(rule, 'assume');
  if (hasAsk === hasAssume) {
    refuse(
      toolName,
      where,
      hasAsk
        ? 'declares both `ask` and `assume` — a rule is one or the other.'
        : 'declares neither `ask` nor `assume`.',
    );
  }
  const allowed = hasAsk ? ['ask', 'choices'] : ['assume'];
  for (const key of Object.keys(rule)) {
    if (!allowed.includes(key)) {
      refuse(
        toolName,
        where,
        `unknown key '${key}' — ${
          hasAsk ? 'an ask rule reads `ask` and `choices`' : 'an assume rule reads `assume`'
        }.`,
      );
    }
  }
  if (hasAsk) {
    assertAskRule(toolName, argument, rule, property);
    return 'ask';
  }
  assertFitsProperty(toolName, `${where}.assume`, rule.assume, property);
  return 'assume';
}

/** The values a spelling must parse: the assume value, or every choice's value. */
function declaredValues(rule: PlainObject): unknown[] {
  if (Object.prototype.hasOwnProperty.call(rule, 'assume')) return [rule.assume];
  const choices = Array.isArray(rule.choices) ? rule.choices : [];
  return choices.map((entry: unknown) => (isPlainObject(entry) ? entry.value : entry));
}

const SUGAR_KEYS = ['argument', 'spelling', 'accepts', 'zoneArgument'];
const FACT_KEYS = ['direction', 'retention', 'maxRange', 'granularity', 'filtersToAsked'];
const PERIOD_KEYS = [...SUGAR_KEYS, 'forms', 'wallZone', ...FACT_KEYS];
/** Forms per period — a tool spells its period in a handful of shapes, never dozens. */
export const MAX_PERIOD_FORMS = 8;

const has = (o: PlainObject, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(o, key) && o[key] !== undefined;

/** The rule an argument carries, or a refusal naming the period field that needs it. */
function periodRule(
  toolName: string,
  where: string,
  argument: string,
  rules: PlainObject | undefined,
): PlainObject {
  const rule =
    rules !== undefined && Object.prototype.hasOwnProperty.call(rules, argument)
      ? rules[argument]
      : undefined;
  if (!isPlainObject(rule)) {
    refuse(
      toolName,
      where,
      `'${argument}' carries no askOrAssume rule. A period argument is exactly what a rule ` +
        `is for — declare askOrAssume.${argument} (assume a default, or ask), or drop the period.`,
    );
  }
  return rule;
}

/** The property schema a form's argument names, or a refusal. */
function formProperty(
  toolName: string,
  where: string,
  argument: string,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): PlainObject {
  const properties = isPlainObject(inputSchema?.properties)
    ? (inputSchema?.properties as PlainObject)
    : undefined;
  const property =
    properties !== undefined && Object.prototype.hasOwnProperty.call(properties, argument)
      ? properties[argument]
      : undefined;
  if (!isPlainObject(property)) {
    refuse(toolName, where, `the tool's inputSchema declares no property '${argument}'.`);
  }
  return property;
}

/** The single-argument half, judged: the argument, its spellings, the zone argument. */
function assertSugar(toolName: string, period: PlainObject, rules: PlainObject | undefined): void {
  const argument = period.argument;
  if (typeof argument !== 'string' || argument.trim() === '') {
    refuse(toolName, 'period.argument', 'must name the argument that sets the period.');
  }
  const rule = periodRule(toolName, 'period.argument', argument, rules);
  if (has(period, 'spelling') && has(period, 'accepts')) {
    refuse(
      toolName,
      'period',
      'declares both `spelling` and `accepts` — `accepts` lists every spelling.',
    );
  }
  const spellings: unknown[] = has(period, 'accepts')
    ? Array.isArray(period.accepts)
      ? period.accepts
      : [period.accepts]
    : has(period, 'spelling')
    ? [period.spelling]
    : [];
  const where = has(period, 'accepts') ? 'period.accepts' : 'period.spelling';
  if (has(period, 'accepts') && (!Array.isArray(period.accepts) || period.accepts.length === 0)) {
    refuse(toolName, 'period.accepts', 'must be a non-empty array of spellings.');
  }
  const seen = new Set<string>();
  for (const spelling of spellings) {
    if (
      typeof spelling !== 'string' ||
      !(PERIOD_SPELLINGS as readonly string[]).includes(spelling)
    ) {
      refuse(
        toolName,
        where,
        `${describeValue(spelling)} is not one of ${PERIOD_SPELLINGS.join(', ')}.`,
      );
    }
    if (seen.has(spelling)) refuse(toolName, where, `repeats the spelling '${spelling}'.`);
    seen.add(spelling);
  }
  const wall = seen.has('wall-range');
  if (has(period, 'zoneArgument')) {
    const zone = period.zoneArgument;
    if (!wall) {
      refuse(
        toolName,
        'period.zoneArgument',
        "goes with 'wall-range' only — no other spelling reads a zone.",
      );
    }
    if (typeof zone !== 'string' || zone.trim() === '' || zone === argument) {
      refuse(
        toolName,
        'period.zoneArgument',
        'must name another argument, the one that carries the zone.',
      );
    }
    periodRule(toolName, 'period.zoneArgument', zone, rules);
  } else if (wall && period.wallZone !== 'app') {
    refuse(
      toolName,
      'period.accepts',
      "'wall-range' reads wall times, which need a zone — name the argument that carries it " +
        "(`zoneArgument`), or declare `wallZone: 'app'` to read them in the app's .time() zone.",
    );
  }
  // Every declared value (the default, each choice) must be spelled one of the declared ways.
  if (spellings.length === 0) return;
  for (const value of declaredValues(rule)) {
    const fits = (spellings as PeriodSpelling[]).some((s) => parsesUnderSpelling(value, s));
    if (!fits) {
      refuse(
        toolName,
        where,
        `the declared value ${describeValue(value)} is not spelled '${spellings.join("' or '")}'.`,
      );
    }
  }
}

/** The general half, judged: each form's shape, its arguments against the schema and the rules. */
function assertForms(
  toolName: string,
  period: PlainObject,
  rules: PlainObject | undefined,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): void {
  const forms = period.forms;
  if (!Array.isArray(forms) || forms.length === 0 || forms.length > MAX_PERIOD_FORMS) {
    refuse(
      toolName,
      'period.forms',
      `must be a non-empty array of at most ${MAX_PERIOD_FORMS} forms.`,
    );
  }
  forms.forEach((form: unknown, i: number) => {
    const where = `period.forms[${i}]`;
    const issue = formIssue(form);
    if (issue !== undefined) refuse(toolName, where, issue);
    const f = form as PeriodForm;
    if (needsZone(f) && !('zone' in f && f.zone !== undefined) && period.wallZone !== 'app') {
      refuse(
        toolName,
        where,
        "reads wall-clock values (a 'wall' or 'date' bound, or a 'day'), which need a zone — " +
          "name the argument that carries it (`zone: { argument }`), or declare `wallZone: 'app'` " +
          "to read them in the app's .time() zone.",
      );
    }
    for (const named of formArguments(f)) {
      const property = formProperty(toolName, where, named.argument, inputSchema);
      if (named.role === 'object') {
        assertObjectProperty(toolName, where, f, property);
        continue;
      }
      const type = property.type;
      const fits =
        named.type === 'number' ? type === 'number' || type === 'integer' : type === 'string';
      if (!fits) {
        refuse(
          toolName,
          where,
          `'${named.argument}' is ${describeValue(type)} in the schema; ${
            named.type === 'number'
              ? "an epoch bound ('epoch-ms', 'epoch-s') is a number or an integer"
              : 'this bound is a string'
          }.`,
        );
      }
      const rule = periodRule(toolName, where, named.argument, rules);
      for (const value of declaredValues(rule)) {
        if (!parsesUnderForm(value, f, named.argument)) {
          refuse(
            toolName,
            where,
            `the declared value ${describeValue(value)} of '${
              named.argument
            }' is not spelled the way this form reads it.`,
          );
        }
      }
    }
  });
}

/**
 * An `object` form's argument: an object property holding both keys, each the
 * type its `as` needs. It carries no rule — a ruled argument is a flat value in
 * this version — so a value the model leaves out is filled only from the
 * person's window, never assumed or asked.
 */
function assertObjectProperty(
  toolName: string,
  where: string,
  form: PeriodForm,
  property: PlainObject,
): void {
  if (form.kind !== 'object') return;
  const inner = isPlainObject(property.properties) ? (property.properties as PlainObject) : {};
  const want = form.as === 'epoch-ms' || form.as === 'epoch-s' ? ['number', 'integer'] : ['string'];
  for (const key of [form.keys.from, form.keys.to]) {
    const p = inner[key];
    if (property.type !== 'object' || !isPlainObject(p) || !want.includes(p.type as string)) {
      refuse(
        toolName,
        where,
        `'${form.argument}' must be an object property whose '${key}' is a ${want.join(' or ')}.`,
      );
    }
  }
}

/** The facts about the source, judged: every duration in `smhdw`, `direction` one of three. */
function assertFacts(toolName: string, period: PlainObject): void {
  if (has(period, 'direction') && !['past', 'future', 'any'].includes(period.direction as string)) {
    refuse(toolName, 'period.direction', "must be 'past', 'future' or 'any'.");
  }
  for (const key of ['retention', 'maxRange', 'granularity']) {
    if (has(period, key) && !isDuration(period[key], FACT_UNITS)) {
      refuse(
        toolName,
        `period.${key}`,
        `${describeValue(
          period[key],
        )} is not a duration — a positive whole number and one of s, m, h, d, w (\`30d\`).`,
      );
    }
  }
  if (has(period, 'filtersToAsked') && typeof period.filtersToAsked !== 'boolean') {
    refuse(toolName, 'period.filtersToAsked', 'must be true or false.');
  }
  if (has(period, 'wallZone') && period.wallZone !== 'app') {
    refuse(
      toolName,
      'period.wallZone',
      "must be 'app' — the one zone a tool may name without an argument.",
    );
  }
}

function assertPeriod(
  toolName: string,
  period: unknown,
  rules: PlainObject | undefined,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): void {
  if (!isPlainObject(period)) {
    refuse(toolName, 'period', 'must be { argument, spelling? } or { forms }.');
  }
  for (const key of Object.keys(period)) {
    if (!PERIOD_KEYS.includes(key)) {
      refuse(
        toolName,
        'period',
        `unknown key '${key}' — a period reads ${PERIOD_KEYS.map((k) => `\`${k}\``).join(', ')}.`,
      );
    }
  }
  const sugar = SUGAR_KEYS.some((k) => has(period, k));
  if (sugar && has(period, 'forms')) {
    refuse(
      toolName,
      'period',
      'declares both the single-argument form (`argument`, `spelling`, `accepts`, `zoneArgument`) ' +
        'and `forms` — the first is shorthand for the second; declare one.',
    );
  }
  if (has(period, 'forms')) assertForms(toolName, period, rules, inputSchema);
  else assertSugar(toolName, period, rules);
  assertFacts(toolName, period);
}

/**
 * Judge a tool's `askOrAssume` and `period`, at definition — and again at
 * dispatch (`rulesOf`) and at MCP ingest, by this same function. Throws an
 * `Error` naming the tool and the argument; returns nothing on a declaration
 * this version can apply. Both absent → a no-op.
 *
 * Refused: a rule on an argument the schema does not offer, whose type is not
 * exactly one of `string`, `number`, `integer`, `boolean`, or that is a `wants`
 * argument; a rule with both forms, neither, or an unknown key; a blank or
 * over-long question; empty, over-long or repeating choices; a choice or an
 * `assume` value the property's OWN schema rejects (never the root `required`);
 * a malformed `said` phrase; more than 32 `ask` arguments; a period on an
 * argument with no rule, an unknown spelling, or a declared value not spelled
 * that way.
 *
 * @example
 * ```ts
 * assertAskOrAssume('search_logs', { window: { assume: '2h' } }, undefined, schema);  // ok
 * assertAskOrAssume('search_logs', { window: { ask: 'Which period?', choices: ['1h', '24h'] } },
 *   undefined, schema);                                                           // ok
 * assertAskOrAssume('search_logs', { window: { assume: '9h' } }, undefined, schema);  // throws
 * ```
 */
export function assertAskOrAssume(
  toolName: string,
  askOrAssume: unknown,
  period: unknown,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
  wants?: Readonly<Record<string, string>>,
): void {
  if (askOrAssume === undefined && period === undefined) return;
  let rules: PlainObject | undefined;
  const forms = new Map<string, 'ask' | 'assume'>();
  if (askOrAssume !== undefined) {
    if (!isPlainObject(askOrAssume) || Object.keys(askOrAssume).length === 0) {
      refuse(
        toolName,
        'askOrAssume',
        'must be an object naming at least one argument — an empty declaration rules nothing ' +
          'and reads as one that does.',
      );
    }
    rules = askOrAssume;
    for (const [argument, rule] of Object.entries(askOrAssume)) {
      const property = ruledProperty(toolName, argument, inputSchema, wants);
      forms.set(argument, assertRule(toolName, argument, rule, property));
    }
    const asks = [...forms.values()].filter((f) => f === 'ask').length;
    if (asks > MAX_ASK_ARGUMENTS) {
      refuse(
        toolName,
        'askOrAssume',
        `${asks} arguments carry \`ask\`; at most ${MAX_ASK_ARGUMENTS} (the typed ask's field limit).`,
      );
    }
  }
  if (period !== undefined) assertPeriod(toolName, period, rules, inputSchema);
  warnDefaultProse(toolName, forms, inputSchema);
}

// ─── The warning ────────────────────────────────────────────────────────

const warned = new Set<string>();
const MAX_WARNED = 500;

/**
 * A ruled property whose own description still says "default" — the rule's
 * served sentence now says it, and two copies of one default drift. A style
 * note, so dev mode only, once per (tool, argument).
 */
function warnDefaultProse(
  toolName: string,
  forms: ReadonlyMap<string, 'ask' | 'assume'>,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): void {
  if (forms.size === 0 || !isDevMode()) return;
  const properties = isPlainObject(inputSchema?.properties)
    ? (inputSchema?.properties as PlainObject)
    : {};
  for (const argument of forms.keys()) {
    const property = properties[argument];
    const description = isPlainObject(property) ? property.description : undefined;
    if (typeof description !== 'string' || !/\bdefaults?\b/i.test(description)) continue;
    const key = `${toolName} ${argument}`;
    if (warned.has(key)) continue;
    if (warned.size < MAX_WARNED) warned.add(key);
    // eslint-disable-next-line no-console
    console.warn(
      `[agentfootprint] defineTool('${toolName}'): the description of the ruled argument ` +
        `'${argument}' mentions a default. The rule's own sentence is served with the schema, ` +
        `so two copies of one default can drift — delete the default from the description.`,
    );
  }
}

// ─── Reading the rules at dispatch ──────────────────────────────────────

/** One declared choice's phrases — words the author vouches for as meaning that value. */
export interface ChoicePhrases {
  readonly value: InputValue;
  readonly said: readonly string[];
}

/** What an `ask` rule declares, as the layer reads it. */
export interface RuledAsk {
  /** The author's question — the ask field's `description`. */
  readonly question: string;
  /** The author's choices' values, in declared order — the field's `enum`. Absent: a free field. */
  readonly choices?: readonly InputValue[];
  /**
   * The choices that declare `said` phrases, in declared order — matched as
   * whole tokens only inside a quote the model declared (`checks.ts` ·
   * `checkSource`, `matched: 'phrase'`), never scanned for in the person's
   * words. Absent when no choice declares any.
   */
  readonly phrases?: readonly ChoicePhrases[];
}

/** One ruled argument of a tool, as the layer reads it. */
export interface RuledArgument {
  readonly argument: string;
  readonly rule: 'ask' | 'assume';
  /** The declared default — present on an `assume` rule. */
  readonly assume?: InputValue;
  /** The question and the choices — present on an `ask` rule. */
  readonly ask?: RuledAsk;
  /** The property's JSON Schema type — one of `RULED_TYPES`, judged at definition. */
  readonly type: 'string' | 'number' | 'integer' | 'boolean';
  /** Set on the argument `Tool.period` names. */
  readonly period?: true;
}

/** A tool's rules, read and judged. */
export interface ToolRules {
  readonly ruled: readonly RuledArgument[];
  readonly period?: ToolPeriod;
}

/**
 * Every form a tool's period takes, the sugar read (`core/time/convert.ts` ·
 * `sugarForms`) — empty when it declares none, or names an argument and no
 * spelling.
 */
export function periodFormsOf(period: ToolPeriod | undefined): readonly PeriodForm[] {
  return period === undefined ? [] : sugarForms(period);
}

/** A form's window arguments: every argument it names but the zone. */
const windowArgumentsOf = (form: PeriodForm) =>
  formArguments(form).filter((a) => a.role !== 'zone');

/**
 * The form a call's window is in, read off what the call GIVES — the first form given whole
 * (every argument but the zone), else the first form given in part; `undefined` when every
 * form is left out. A period's forms are alternatives, so this is the one reading of "which
 * form did the call take", asked by the inputs layer (`resolve.ts` · `windowUntakenOf`) and
 * inner dispatch (`toolDispatch.ts` · `refuseUnaccountedRuledArguments`).
 */
export function sentFormOf(
  forms: readonly PeriodForm[],
  args: Readonly<Record<string, unknown>>,
): number | undefined {
  const given = (form: PeriodForm) =>
    windowArgumentsOf(form).map((a) => !isMissing(args, a.argument));
  const whole = forms.findIndex((form) => given(form).every(Boolean));
  if (whole >= 0) return whole;
  const part = forms.findIndex((form) => given(form).some(Boolean));
  return part >= 0 ? part : undefined;
}

/**
 * The arguments of every form but `forms[taken]` that it does not also name — an
 * alternative the call did not take. Empty for a single form: one form is one window.
 */
export function untakenBesides(forms: readonly PeriodForm[], taken: number): ReadonlySet<string> {
  const chosen = forms[taken];
  if (chosen === undefined) return new Set();
  const mine = new Set(formArguments(chosen).map((a) => a.argument));
  return new Set(
    forms.flatMap((form) => formArguments(form).map((a) => a.argument)).filter((a) => !mine.has(a)),
  );
}

/**
 * The form a call that leaves EVERY form out owes, by the rules: a form this turn's kept
 * answers fill whole (`answered`), else the first form the rules ASSUME whole — its default IS
 * the window — else the first form, asked by its own asks. Never every form at once: that
 * would ask the person for two windows, which the tool refuses.
 */
export function owedFormOf(
  forms: readonly PeriodForm[],
  rules: ToolRules,
  answered: (argument: string) => boolean,
): number {
  const ruleOf = (argument: string) => rules.ruled.find((r) => r.argument === argument)?.rule;
  const all = (form: PeriodForm, test: (argument: string) => boolean) => {
    const named = windowArgumentsOf(form);
    return named.length > 0 && named.every((a) => test(a.argument));
  };
  const kept = forms.findIndex((form) => all(form, answered));
  if (kept >= 0) return kept;
  const assumed = forms.findIndex((form) => all(form, (a) => ruleOf(a) === 'assume'));
  return assumed >= 0 ? assumed : 0;
}

/**
 * Every argument a period names — the single argument, or each form's bound,
 * object and zone arguments. What a row's `period: true` marks.
 */
export function periodArgumentsOf(period: ToolPeriod | undefined): ReadonlySet<string> {
  if (period === undefined) return new Set();
  const names = new Set<string>();
  if (period.argument !== undefined) names.add(period.argument);
  if (period.zoneArgument !== undefined) names.add(period.zoneArgument);
  for (const form of period.forms ?? []) {
    for (const a of formArguments(form)) names.add(a.argument);
  }
  return names;
}

/**
 * The ONE argument a period is known by — the single `argument`, else the
 * first form's first bound. The results layer's join key (a `period` row names
 * it, and joins the call's `argument` row by it).
 */
export function periodArgumentOf(period: ToolPeriod | undefined): string | undefined {
  if (period === undefined) return undefined;
  if (period.argument !== undefined) return period.argument;
  const first = period.forms?.[0];
  return first === undefined ? undefined : primaryArgument(first);
}

/** The facts a period declares about its source, only those it declares. */
export function periodFactsOf(period: ToolPeriod | undefined): PeriodFacts {
  if (period === undefined) return {};
  return {
    ...(period.direction !== undefined && { direction: period.direction }),
    ...(period.retention !== undefined && { retention: period.retention }),
    ...(period.maxRange !== undefined && { maxRange: period.maxRange }),
    ...(period.granularity !== undefined && { granularity: period.granularity }),
    ...(period.filtersToAsked !== undefined && { filtersToAsked: period.filtersToAsked }),
  };
}

/** Why a tool's rules could not be read — the assert's own sentence. */
export interface RulesRefused {
  readonly refused: string;
}

/** The shape `rulesOf` reads — any object carrying the three declarations. */
export interface RuledToolLike {
  readonly schema: {
    readonly name: string;
    readonly inputSchema?: Readonly<Record<string, unknown>>;
  };
  readonly askOrAssume?: unknown;
  readonly period?: unknown;
  readonly wants?: Readonly<Record<string, string>>;
}

/** Per tool object, its verdict — a tool is judged once per process, not per call. */
const verdicts = new WeakMap<object, ToolRules | RulesRefused>();

/**
 * A tool's rules as the inputs layer applies them, or why they cannot be read,
 * or `undefined` for a tool that declares none. Runs the SAME assert
 * `defineTool` runs, because a Tool built by hand or delivered by a
 * ToolProvider never passed through `defineTool` — and a rule that fails here
 * refuses the call; it is never repaired. Cached per tool object.
 */
export function rulesOf(tool: RuledToolLike | undefined): ToolRules | RulesRefused | undefined {
  if (tool === undefined || (tool.askOrAssume === undefined && tool.period === undefined)) {
    return undefined;
  }
  const cached = verdicts.get(tool);
  if (cached !== undefined) return cached;
  let verdict: ToolRules | RulesRefused;
  try {
    assertAskOrAssume(
      tool.schema.name,
      tool.askOrAssume,
      tool.period,
      tool.schema.inputSchema,
      tool.wants,
    );
    verdict = readRules(
      tool.askOrAssume as AskOrAssume | undefined,
      tool.period as ToolPeriod | undefined,
      tool.schema.inputSchema,
    );
  } catch (error) {
    verdict = { refused: error instanceof Error ? error.message : String(error) };
  }
  verdicts.set(tool, verdict);
  return verdict;
}

/** True when `rulesOf` could not read the rules. */
export function isRefused(value: ToolRules | RulesRefused | undefined): value is RulesRefused {
  return value !== undefined && 'refused' in value;
}

/**
 * Whether a tool's argument rules can be read and rule at least one argument
 * — the one predicate for "this tool is RULED" wherever the declared sources'
 * `_findings.from` is planted (`core/slots/buildToolsSlot.ts`, `stages/seed.ts`):
 * only such a tool's calls are checked and filed.
 */
export function carriesRules(tool: RuledToolLike | undefined): boolean {
  const rules = rulesOf(tool);
  return rules !== undefined && !isRefused(rules) && rules.ruled.length > 0;
}

/** The value of one declared choice — a bare value, or `{ value, said? }`. */
const choiceValueOf = (choice: AskChoice): InputValue =>
  typeof choice === 'object' ? choice.value : choice;

/** The choices that declare `said` phrases, as the layer reads them. */
function phrasesOf(choices: readonly AskChoice[]): ChoicePhrases[] {
  const out: ChoicePhrases[] = [];
  for (const choice of choices) {
    if (typeof choice !== 'object' || choice.said === undefined || choice.said.length === 0) {
      continue;
    }
    out.push({ value: choice.value, said: [...choice.said] });
  }
  return out;
}

/** An `ask` rule as the layer reads it: the question, the choices' values, their phrases. */
function readAsk(rule: {
  readonly ask: string;
  readonly choices?: readonly AskChoice[];
}): RuledAsk {
  if (rule.choices === undefined) return { question: rule.ask };
  const phrases = phrasesOf(rule.choices);
  return {
    question: rule.ask,
    choices: rule.choices.map(choiceValueOf),
    ...(phrases.length > 0 && { phrases }),
  };
}

/** The property's type, read after the assert judged it one of `RULED_TYPES`. */
function propertyTypeOf(
  inputSchema: Readonly<Record<string, unknown>> | undefined,
  argument: string,
): RuledArgument['type'] {
  const properties = isPlainObject(inputSchema?.properties)
    ? (inputSchema?.properties as PlainObject)
    : {};
  const property = properties[argument];
  const type = isPlainObject(property) ? property.type : undefined;
  return type === 'number' || type === 'integer' || type === 'boolean' ? type : 'string';
}

function readRules(
  askOrAssume: AskOrAssume | undefined,
  period: ToolPeriod | undefined,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): ToolRules {
  const named = periodArgumentsOf(period);
  const ruled: RuledArgument[] = Object.entries(askOrAssume ?? {}).map(([argument, rule]) => ({
    argument,
    rule: 'ask' in rule ? ('ask' as const) : ('assume' as const),
    ...('assume' in rule && { assume: rule.assume }),
    ...('ask' in rule && { ask: readAsk(rule) }),
    type: propertyTypeOf(inputSchema, argument),
    ...(named.has(argument) && { period: true as const }),
  }));
  return { ruled, ...(period !== undefined && { period }) };
}

/**
 * Forget every definition-time warning issued so far.
 * @internal test seam — the ledger is process-wide and warn-once.
 */
export function _resetDeclareWarnings(): void {
  warned.clear();
}

/** @internal — `DeclarationRefused` is the assert's own error class, for tests. */
export { DeclarationRefused };
