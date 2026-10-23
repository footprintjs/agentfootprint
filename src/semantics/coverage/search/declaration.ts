/**
 * search/declaration — the ONE rule a `Tool.search` declaration is held to.
 *
 * Pattern: one validator, two doors (the `assertResultCeiling` precedent):
 *          `defineTool` refuses at definition, and the MCP ingest door
 *          (`mcp/toolExtras.ts` · `readToolExtras`) asks the same function
 *          and drops a declaration it refuses. A declaration nobody vetted —
 *          a remote `_meta` bag — must land on a message, never a TypeError.
 * Role:    semantics/ layer, pure. Throws `Error` naming the tool, the field
 *          and the code (`unclassified-argument`, `unknown-argument`,
 *          `gaps-without-bears`, `fixed-without-said`, `when-omitted-shape`,
 *          `statement-text-refused`).
 * Emits:   N/A.
 *
 * Why so strict: a declaration is untrusted text from the tool author, and the
 * composer builds every coverage row from it. An argument nobody classified
 * would be ground nobody accounts for; a default that is neither a value nor
 * `{ any: true }` would be read as one of them by a guess. Every such shape is
 * refused here, at the line the author wrote, not at the first "not found" of
 * the first incident.
 */

import { plainLineProblem } from '../../../lib/plainLine.js';
import type { GapFacet } from '../composedCoverage.js';
import { formArguments, sugarForms, type PeriodShapes } from '../../../time/periodForm.js';
import { statementTextProblem } from './statementText.js';
import type {
  SearchArgument,
  SearchFixed,
  SearchGap,
  SearchRole,
  SearchScalar,
  SearchWords,
  ToolSearch,
} from './types.js';

/** The closed role set, tied to {@link SearchRole} in both directions. */
export const SEARCH_ROLES: readonly SearchRole[] = Object.keys({
  population: true,
  filter: true,
  period: true,
  source: true,
  cap: true,
  page: true,
  inert: true,
} satisfies Record<SearchRole, true>) as SearchRole[];

/** The declaration's keys, tied to {@link ToolSearch}. */
const SEARCH_KEYS: readonly string[] = Object.keys({
  source: true,
  subject: true,
  fixed: true,
  arguments: true,
  complete: true,
  gaps: true,
  limits: true,
} satisfies Record<keyof ToolSearch, true>);

const ARGUMENT_KEYS: readonly string[] = Object.keys({
  name: true,
  role: true,
  whenOmitted: true,
  said: true,
} satisfies Record<keyof SearchArgument, true>);

const FIXED_KEYS: readonly string[] = Object.keys({
  name: true,
  value: true,
  said: true,
} satisfies Record<keyof SearchFixed, true>);

const GAP_KEYS: readonly string[] = Object.keys({
  what: true,
  why: true,
  bears: true,
} satisfies Record<keyof SearchGap, true>);

const WORDS_KEYS: readonly string[] = Object.keys({
  what: true,
  said: true,
} satisfies Record<keyof SearchWords, true>);

/** The plain facets a gap may bear on; a filter facet is `{ filter, values? }`. */
const PLAIN_FACETS: readonly string[] = ['source', 'population', 'period', 'completeness'];

/** Roles a claim may name a VALUE of in words. */
const WORDED_ROLES: readonly SearchRole[] = ['filter', 'source'];

/** What the declaration is judged against, besides itself. */
export interface SearchDeclarationContext {
  /** The tool's `inputSchema` — every one of its properties needs a role. */
  readonly inputSchema: Readonly<Record<string, unknown>>;
  /**
   * The arguments the tool's `period` names, when it declares one — a
   * `period`-role argument must be one of them. Absent: no `period` declared.
   */
  readonly periodArguments?: readonly string[];
}

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isName = (v: unknown): v is string => typeof v === 'string' && v.trim() !== '';

/** A finite number, a string or a boolean — what a default or a qualifier may be. */
export function isSearchScalar(v: unknown): v is SearchScalar {
  return (
    typeof v === 'string' || typeof v === 'boolean' || (typeof v === 'number' && Number.isFinite(v))
  );
}

/** `{ any: true }` exactly — no other key, no other value. */
export function isAnyValue(v: unknown): v is { readonly any: true } {
  return isPlain(v) && Object.keys(v).length === 1 && v.any === true;
}

/**
 * The declaration as it is STORED — a deep copy, frozen, each argument's
 * `said` a null-prototype map — so nothing downstream can mutate it and no
 * value a call sends can reach an inherited property through it
 * (`valueWords.ts`). `defineTool` and the MCP ingest door store this, after
 * `assertToolSearch` accepted the declaration.
 */
export function freezeSearch(search: ToolSearch): ToolSearch {
  const words = (list: readonly string[]): readonly string[] => Object.freeze([...list]);
  const said = (map: Readonly<Record<string, readonly string[]>>) => {
    const out = Object.create(null) as Record<string, readonly string[]>;
    for (const [value, list] of Object.entries(map)) out[value] = words(list);
    return Object.freeze(out);
  };
  const bears = (b: GapFacet): GapFacet =>
    typeof b === 'string'
      ? b
      : Object.freeze({
          filter: b.filter,
          ...(b.values !== undefined && { values: Object.freeze([...b.values]) }),
        });
  return Object.freeze({
    source: Object.freeze({ what: search.source.what, said: words(search.source.said) }),
    subject: Object.freeze({ what: search.subject.what, said: words(search.subject.said) }),
    ...(search.fixed !== undefined && {
      fixed: Object.freeze(
        search.fixed.map((q) =>
          Object.freeze({ name: q.name, value: q.value, said: words(q.said) }),
        ),
      ),
    }),
    arguments: Object.freeze(
      search.arguments.map((a) =>
        Object.freeze({
          name: a.name,
          role: a.role,
          ...(a.whenOmitted !== undefined && {
            whenOmitted: Array.isArray(a.whenOmitted)
              ? Object.freeze([...a.whenOmitted])
              : isAnyValue(a.whenOmitted)
              ? Object.freeze({ any: true as const })
              : a.whenOmitted,
          }),
          ...(a.said !== undefined && { said: said(a.said) }),
        }),
      ),
    ),
    ...(search.complete !== undefined && { complete: search.complete }),
    ...(search.gaps !== undefined && {
      gaps: Object.freeze(
        search.gaps.map((g) => Object.freeze({ what: g.what, why: g.why, bears: bears(g.bears) })),
      ),
    }),
    ...(search.limits !== undefined && { limits: Object.freeze({ cap: search.limits.cap }) }),
  }) as ToolSearch;
}

/**
 * The arguments a tool's `period` names — its single argument, its zone
 * argument and every argument of its forms — or `undefined` when it declares
 * no period. What a `period`-role search argument must be one of.
 */
export function periodArgumentsOf(period: PeriodShapes | undefined): readonly string[] | undefined {
  if (period === undefined) return undefined;
  const named = new Set<string>();
  if (period.argument !== undefined) named.add(period.argument);
  if (period.zoneArgument !== undefined) named.add(period.zoneArgument);
  for (const form of sugarForms(period)) {
    for (const a of formArguments(form)) named.add(a.argument);
  }
  return [...named];
}

/**
 * Refuse a `search` this library cannot honour, at definition time — naming
 * the tool, the field and the code. `undefined` declares nothing and passes.
 *
 * @example
 * ```ts
 * assertToolSearch('list_incidents', search, { inputSchema });
 * ```
 */
export function assertToolSearch(
  toolName: string,
  search: ToolSearch | undefined,
  context: SearchDeclarationContext,
): void {
  if (search === undefined) return;
  const refuse = (field: string, message: string, code?: string): never => {
    throw new Error(
      `defineTool('${toolName}'): \`${field}\` ${message}` +
        (code === undefined ? '' : ` (${code})`),
    );
  };
  if (!isPlain(search)) {
    refuse(
      'search',
      'must be { source, subject, arguments, fixed?, complete?, gaps?, limits? } — what one ' +
        'call of this tool searches. To declare nothing, omit the field.',
    );
  }
  refuseUnknown(search as unknown as Plain, SEARCH_KEYS, 'search', refuse);
  checkWords(search.source, 'search.source', refuse);
  checkWords(search.subject, 'search.subject', refuse);
  const properties = propertiesOf(context.inputSchema);
  const fixedNames = checkFixed(search.fixed, properties, refuse);
  const roles = checkArguments(search.arguments, properties, context, refuse);
  if (search.complete !== undefined && search.complete !== 'within-arguments') {
    refuse(
      'search.complete',
      `is ${JSON.stringify(search.complete)} — the one statement is 'within-arguments' ` +
        '(complete for the population, filters and period in effect). Omit it and no call is ' +
        'ever complete.',
    );
  }
  checkGaps(search.gaps, roles, fixedNames, refuse);
  checkLimits(search.limits, refuse);
  // Every text that can reach a statement, judged by ONE rule, as the text
  // that lands there (a fixed qualifier as `name: value`) — no per-field drift.
  for (const [field, text] of statementTextsOf(search)) checkStatementText(text, field, refuse);
}

/**
 * EVERY declaration text that can reach a statement the library writes, as it
 * lands there: the source's and the subject's `what`; each fixed qualifier and
 * each declared default as `name: value` (one per value of a list); each
 * classified argument's name (a sent value is the call's, quoted by the
 * writer, never declaration text); each gap's `what` and `why`. A new field
 * that reaches a statement joins THIS list, so it meets the one rule.
 * Assumes a declaration whose shape `assertToolSearch` already accepted.
 */
export function statementTextsOf(search: ToolSearch): ReadonlyArray<readonly [string, string]> {
  const out: [string, string][] = [
    ['search.source.what', search.source.what],
    ['search.subject.what', search.subject.what],
  ];
  (search.fixed ?? []).forEach((q, i) => {
    out.push([`search.fixed[${i}]`, `${q.name}: ${String(q.value)}`]);
  });
  search.arguments.forEach((a, i) => {
    if (a.role === 'inert') return;
    const at = `search.arguments[${i}]`;
    const omitted = a.whenOmitted;
    if (omitted === undefined || isAnyValue(omitted)) {
      out.push([at, isAnyValue(omitted) ? `${a.name}: any` : a.name]);
      return;
    }
    const values: readonly SearchScalar[] = Array.isArray(omitted)
      ? omitted
      : [omitted as SearchScalar];
    for (const v of values) out.push([`${at}.whenOmitted`, `${a.name}: ${String(v)}`]);
  });
  (search.gaps ?? []).forEach((g, i) => {
    out.push([`search.gaps[${i}].what`, g.what]);
    out.push([`search.gaps[${i}].why`, g.why]);
  });
  return out;
}

type Refuse = (field: string, message: string, code?: string) => never;

function refuseUnknown(value: Plain, known: readonly string[], field: string, refuse: Refuse) {
  const unknown = Object.keys(value).find((key) => !known.includes(key));
  if (unknown !== undefined) {
    refuse(field, `has an unknown key '${unknown}' — the keys are ${known.join(', ')}.`);
  }
}

/** A non-empty string — its shape is the statement rule's (`statementTextsOf`). */
function checkPresent(value: unknown, field: string, refuse: Refuse): string {
  if (!isName(value)) return refuse(field, 'must be a non-empty string.');
  return value;
}

/** One plain line, non-empty. */
function checkLine(value: unknown, field: string, refuse: Refuse): string {
  if (!isName(value)) return refuse(field, 'must be a non-empty string.');
  const problem = plainLineProblem(`\`${field}\``, value);
  if (problem !== undefined) refuse(field, `is not one plain line: ${problem}`);
  return value;
}

/**
 * Text that can reach a statement the library writes — one plain line, at
 * most 120 characters, no instruction (`statementText.ts`).
 */
function checkStatementText(value: unknown, field: string, refuse: Refuse): string {
  if (!isName(value)) return refuse(field, 'must be a non-empty string.');
  const problem = statementTextProblem(field, value);
  if (problem !== undefined) refuse(field, `is refused: ${problem}`, 'statement-text-refused');
  return value;
}

/** A non-empty list of plain one-line words. */
function checkSaid(value: unknown, field: string, refuse: Refuse, code?: string): void {
  if (!Array.isArray(value) || value.length === 0) {
    refuse(
      field,
      'must list at least one word a claim may use — the said words are the ONLY vocabulary ' +
        'a claim is matched to, so an empty list matches nothing.',
      code,
    );
  }
  (value as unknown[]).forEach((word, i) => checkLine(word, `${field}[${i}]`, refuse));
}

function checkWords(value: unknown, field: string, refuse: Refuse): void {
  if (!isPlain(value))
    refuse(
      field,
      "must be { what, said } — e.g. { what: 'the incident store', said: ['the incident store'] }.",
    );
  refuseUnknown(value as Plain, WORDS_KEYS, field, refuse);
  checkPresent((value as Plain).what, `${field}.what`, refuse);
  checkSaid((value as Plain).said, `${field}.said`, refuse);
}

function propertiesOf(schema: Readonly<Record<string, unknown>>): readonly string[] {
  const properties = (schema as Plain).properties;
  return isPlain(properties) ? Object.keys(properties) : [];
}

function checkFixed(fixed: unknown, properties: readonly string[], refuse: Refuse): Set<string> {
  const names = new Set<string>();
  if (fixed === undefined) return names;
  if (!Array.isArray(fixed)) {
    return refuse('search.fixed', 'must be a list of { name, value, said } qualifiers.');
  }
  fixed.forEach((raw, i) => {
    const at = `search.fixed[${i}]`;
    if (!isPlain(raw)) refuse(at, 'must be { name, value, said }.');
    const q = raw as Plain;
    refuseUnknown(q, FIXED_KEYS, at, refuse);
    const name = checkLine(q.name, `${at}.name`, refuse);
    if (properties.includes(name)) {
      refuse(
        `${at}.name`,
        `'${name}' is an input property — a fixed qualifier is one the tool ALWAYS applies, ` +
          'so it is never sent. Classify the property in `arguments` instead.',
      );
    }
    if (names.has(name)) refuse(`${at}.name`, `'${name}' is declared twice.`);
    names.add(name);
    if (!isSearchScalar(q.value)) {
      refuse(`${at}.value`, 'must be a string, a finite number or a boolean.');
    }
    checkSaid(q.said, `${at}.said`, refuse, 'fixed-without-said');
  });
  return names;
}

function checkWhenOmitted(arg: Plain, at: string, refuse: Refuse): void {
  if (!('whenOmitted' in arg) || arg.whenOmitted === undefined) return;
  if (arg.role === 'inert') {
    refuse(
      `${at}.whenOmitted`,
      'is declared on an inert argument — an inert argument changes the bytes, not the ' +
        'ground, so a default means nothing there. Drop it.',
    );
  }
  const v = arg.whenOmitted;
  const ok =
    isSearchScalar(v) ||
    isAnyValue(v) ||
    (Array.isArray(v) && v.length > 0 && v.every(isSearchScalar));
  if (!ok) {
    refuse(
      `${at}.whenOmitted`,
      `is ${JSON.stringify(v)} — it has two forms and no third: the default VALUE execute ` +
        'applies (a string, a finite number, a boolean or a list of them), composed as if ' +
        'sent; or { any: true }, omission narrows nothing. Omit it and an unsent argument ' +
        'is a gap.',
      'when-omitted-shape',
    );
  }
}

function checkArgumentSaid(arg: Plain, at: string, refuse: Refuse): void {
  if (arg.said === undefined) return;
  if (!WORDED_ROLES.includes(arg.role as SearchRole)) {
    refuse(
      `${at}.said`,
      `is declared on a '${String(arg.role)}' argument — value words belong to 'filter' and ` +
        "'source' arguments only (a population value's words come from the result's `resolved`).",
    );
  }
  if (!isPlain(arg.said) || Object.keys(arg.said).length === 0) {
    refuse(`${at}.said`, "must map each value to its words — { critical: ['critical', 'sev1'] }.");
  }
  for (const [value, words] of Object.entries(arg.said as Plain)) {
    checkSaid(words, `${at}.said.${value}`, refuse);
  }
}

function checkArguments(
  args: unknown,
  properties: readonly string[],
  context: SearchDeclarationContext,
  refuse: Refuse,
): Map<string, SearchRole> {
  if (!Array.isArray(args)) {
    return refuse(
      'search.arguments',
      'must classify EVERY input property — a list of { name, role } ([] for a tool with none).',
      'unclassified-argument',
    );
  }
  const roles = new Map<string, SearchRole>();
  args.forEach((raw, i) => {
    const at = `search.arguments[${i}]`;
    if (!isPlain(raw)) refuse(at, 'must be { name, role, whenOmitted?, said? }.');
    const arg = raw as Plain;
    refuseUnknown(arg, ARGUMENT_KEYS, at, refuse);
    const name = checkLine(arg.name, `${at}.name`, refuse);
    if (!properties.includes(name)) {
      refuse(
        `${at}.name`,
        `'${name}' is not a property of inputSchema — a search declares only arguments a call ` +
          'can send.',
        'unknown-argument',
      );
    }
    if (roles.has(name)) refuse(`${at}.name`, `'${name}' is classified twice.`);
    if (!SEARCH_ROLES.includes(arg.role as SearchRole)) {
      refuse(`${at}.role`, `must be one of ${SEARCH_ROLES.join(', ')}.`);
    }
    roles.set(name, arg.role as SearchRole);
    checkWhenOmitted(arg, at, refuse);
    checkArgumentSaid(arg, at, refuse);
    if (arg.role === 'period' && context.periodArguments !== undefined) {
      if (!context.periodArguments.includes(name)) {
        refuse(
          `${at}.role`,
          `is 'period' for '${name}', which the tool's \`period\` does not name ` +
            `(${context.periodArguments.join(', ') || 'none'}). The period argument is the one ` +
            '`period` declares.',
        );
      }
    }
  });
  const unclassified = properties.find((p) => !roles.has(p));
  if (unclassified !== undefined) {
    refuse(
      'search.arguments',
      `does not classify the input property '${unclassified}' — every property needs a role ` +
        `(${SEARCH_ROLES.join(', ')}). Ground nobody classified is ground nobody accounts for; ` +
        "a property that changes no ground is 'inert'.",
      'unclassified-argument',
    );
  }
  if ([...roles.values()].filter((r) => r === 'source').length > 1) {
    refuse(
      'search.arguments',
      'classifies more than one `source` argument — a call picks one store.',
    );
  }
  return roles;
}

function checkBears(
  bears: unknown,
  at: string,
  roles: ReadonlyMap<string, SearchRole>,
  fixedNames: ReadonlySet<string>,
  refuse: Refuse,
): GapFacet {
  if (typeof bears === 'string' && PLAIN_FACETS.includes(bears)) return bears as GapFacet;
  if (isPlain(bears)) {
    refuseUnknown(bears, ['filter', 'values'], at, refuse);
    const filter = checkLine(bears.filter, `${at}.filter`, refuse);
    if (roles.get(filter) !== 'filter' && !fixedNames.has(filter)) {
      refuse(
        `${at}.filter`,
        `'${filter}' is neither a 'filter' argument nor a fixed qualifier of this search.`,
      );
    }
    const values = bears.values;
    if (
      values !== undefined &&
      (!Array.isArray(values) || values.length === 0 || !values.every(isSearchScalar))
    ) {
      refuse(`${at}.values`, 'must list the values the gap concerns — omit it for every value.');
    }
    return bears as unknown as GapFacet;
  }
  return refuse(
    at,
    `is ${JSON.stringify(bears)} — a gap bears on 'source', 'population', 'period', ` +
      "'completeness' or { filter: '<name>', values?: [...] }.",
    'gaps-without-bears',
  );
}

function checkGaps(
  gaps: unknown,
  roles: ReadonlyMap<string, SearchRole>,
  fixedNames: ReadonlySet<string>,
  refuse: Refuse,
): void {
  if (gaps === undefined) return;
  if (!Array.isArray(gaps)) {
    refuse('search.gaps', 'must be a list of { what, why, bears } — or omit it.');
  }
  (gaps as unknown[]).forEach((raw, i) => {
    const at = `search.gaps[${i}]`;
    if (!isPlain(raw)) refuse(at, 'must be { what, why, bears }.');
    const gap = raw as Plain;
    refuseUnknown(gap, GAP_KEYS, at, refuse);
    checkPresent(gap.what, `${at}.what`, refuse);
    if (!isName(gap.why) || gap.bears === undefined) {
      refuse(
        at,
        'needs both `why` and `bears` — a blind spot with no reason cannot be acted on, and one ' +
          'with no facet cannot be weighed against a claim.',
        'gaps-without-bears',
      );
    }
    checkBears(gap.bears, `${at}.bears`, roles, fixedNames, refuse);
  });
}

function checkLimits(limits: unknown, refuse: Refuse): void {
  if (limits === undefined) return;
  if (!isPlain(limits)) refuse('search.limits', "must be { cap: <n> | 'unknown' }.");
  refuseUnknown(limits as Plain, ['cap'], 'search.limits', refuse);
  const cap = (limits as Plain).cap;
  const ok = cap === 'unknown' || (typeof cap === 'number' && Number.isInteger(cap) && cap > 0);
  if (!ok) {
    refuse(
      'search.limits.cap',
      `is ${JSON.stringify(cap)} — a server cap is a positive whole number of rows, or ` +
        "'unknown' when the tool cannot say (an unknown cap bears on completeness every call).",
    );
  }
}
