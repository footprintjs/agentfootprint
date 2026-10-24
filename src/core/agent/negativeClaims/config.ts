/** Negative-claim arms: app configuration and the typed model citation schema.
 * This module never calls a parser or decides whether a search establishes a claim.
 * Delivery adds its own statement after parsing; that enriched field is not model input. */
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { MAX_NEGATIVE_CLAIMS } from '../../../integrity/negative-claim/limits.js';
import { MAX_CITED_READS } from '../../../integrity/negative-claim/citation.js';
import type { Tool } from '../../../tools/tools.js';
import {
  resolveNegativeClaimPhrases,
  type NegativeClaimPhraseExtensions,
  type ResolvedNegativeClaimPhrases,
} from '../../../integrity/negative-claim/phrases.js';

/** Configure typed library-written statements or observe ordinary answer prose.
 * `{ prose: true }` needs no schema or tool list and never rewrites or blocks an answer.
 * Both modes can add bounded literal phrase data; prose findings remain unverified.
 *
 * In the typed arm, the named field must be a required, top-level array in the output JSON Schema.
 * Every cited tool must be registered locally. A search declaration or an admitted
 * `absent({ among })` result supplies its coverage at runtime.
 *
 * Typed enforcement is available, but not recommended until its benchmark gates pass.
 * Model prose is observed with a bounded grammar; it remains unchecked.
 * Prose enforcement is unavailable.
 */
export type NegativeClaimsOptions = (
  | {
      readonly field: string;
      readonly tools: readonly string[];
      /** Default `withhold`. `state-searched` reports what was read without upgrading its verdict. */
      readonly unestablished?: 'withhold' | 'state-searched';
      readonly prose?: never;
    }
  | {
      /** Observe ordinary answers without a schema, citations, correction or withholding. */
      readonly prose: true;
      readonly field?: never;
      readonly tools?: never;
      readonly unestablished?: never;
    }
) & {
  /** Optional bounded literal phrases. They only add observations, never verification or enforcement. */
  readonly phrases?: NegativeClaimPhraseExtensions;
};

/** A model pointer to recorded evidence. The runtime derives the claim kind and
 * searched subject from the cited reads, then writes the delivered statement.
 * New app schemas need only restsOn. Legacy kind/about fields may remain in an
 * app's schema/parser, but never select the evidence interpretation. */
export interface NegativeClaimCitation {
  /** Legacy format hint only; ignored when interpreting evidence. */
  readonly kind?: 'none' | 'not-found' | 'complete';
  /** Optional model-written display text, never an evidence identity or checked subject. */
  readonly about?: string | number;
  readonly restsOn: readonly string[];
}

/** @internal Detached configuration carried by the chart, never by the model. */
export interface ResolvedTypedNegativeClaims {
  readonly mode: 'typed';
  readonly field: string;
  readonly tools: readonly string[];
  readonly unestablished: 'withhold' | 'state-searched';
  readonly phrases?: ResolvedNegativeClaimPhrases;
}

/** @internal Observation has no citation contract or delivery authority. */
export interface ResolvedProseNegativeClaims {
  readonly mode: 'prose';
  readonly phrases?: ResolvedNegativeClaimPhrases;
}

/** @internal The two arms share native capture, not enforcement. */
export type ResolvedNegativeClaims = ResolvedTypedNegativeClaims | ResolvedProseNegativeClaims;

export const NEGATIVE_HANDLE_PATTERN = '^r[1-9][0-9]{0,3}$';
const KINDS = ['none', 'not-found', 'complete'];
const FIELDS = ['kind', 'about', 'restsOn'];
const fail = (message: string): never => {
  throw new Error(`Agent.negativeClaims: ${message}`);
};
const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

/** Validate once, without keeping any mutable caller-owned arrays. */
export function resolveNegativeClaims(options: NegativeClaimsOptions): ResolvedNegativeClaims {
  let source: Record<string, unknown>;
  try {
    source = ownData(options);
  } catch {
    return fail('options must be a plain data object.');
  }
  if (['strictProse', 'enforceProse'].some((key) => Object.hasOwn(source, key))) {
    return fail(
      'strictProse and enforceProse options are not available; prose is observed, never enforced.',
    );
  }
  if (
    Object.keys(source).some(
      (key) => !['field', 'tools', 'unestablished', 'prose', 'phrases'].includes(key),
    )
  ) {
    return fail('options accept only field, tools, unestablished, prose and phrases.');
  }
  const phrases =
    source.phrases === undefined
      ? undefined
      : resolveNegativeClaimPhrases(source.phrases as NegativeClaimPhraseExtensions);
  if (Object.hasOwn(source, 'prose')) {
    if (
      source.prose !== true ||
      ['field', 'tools', 'unestablished'].some((key) => Object.hasOwn(source, key))
    )
      return fail('prose must be true and cannot be combined with field, tools or unestablished.');
    return Object.freeze({ mode: 'prose', ...(phrases !== undefined && { phrases }) });
  }
  const field = source.field;
  if (
    typeof field !== 'string' ||
    !/^[A-Za-z_][A-Za-z0-9_-]{0,127}$/.test(field) ||
    field === '_findings'
  ) {
    return fail(
      'field must name one top-level answer property (letters, digits, underscore or hyphen), not _findings.',
    );
  }
  const tools = source.tools;
  if (
    !Array.isArray(tools) ||
    tools.length === 0 ||
    tools.length > 256 ||
    tools.some((name) => typeof name !== 'string' || name.trim().length === 0 || name.length > 256)
  ) {
    return fail('tools must be a non-empty list of at most 256 registered tool names.');
  }
  if (new Set(tools).size !== tools.length) return fail('tools must not repeat a name.');
  const unestablished = source.unestablished ?? 'withhold';
  if (unestablished !== 'withhold' && unestablished !== 'state-searched') {
    return fail("unestablished must be 'withhold' or 'state-searched'.");
  }
  return Object.freeze({
    mode: 'typed',
    field,
    tools: Object.freeze([...tools] as string[]),
    unestablished,
    ...(phrases !== undefined && { phrases }),
  });
}

/** Provider-only and MCP tools cannot become trusted by being named in this list. */
export function assertNegativeClaimsTools(
  config: ResolvedTypedNegativeClaims,
  tools: readonly Tool[],
): void {
  for (const name of config.tools) {
    const tool = tools.find((candidate) => candidate.schema.name === name);
    if (tool === undefined)
      return fail(`tool '${name}' is not registered locally; register it with .tool() or a skill.`);
    if (tool.source !== undefined)
      return fail(`tool '${name}' is remote; only local tools may supply typed negative evidence.`);
    // `among` is returned by execute, not declared on Tool. A local tool with
    // no search therefore stays eligible, but establishes nothing unless an
    // admitted among result supplies its coverage at the runtime boundary.
  }
}

function schemaObject(value: unknown, at: string): Record<string, unknown> {
  return record(value) ? value : fail(`${at} must be declared directly in the output JSON Schema.`);
}

/** Build the model-facing copy. A parse function is never executed to infer a schema.
 * Root/field/item references and unions are deliberately not guessed: expose this
 * one citation field directly while the rest of the app's schema is preserved. */
export function negativeClaimsSchema(
  config: ResolvedTypedNegativeClaims,
  schema: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> {
  if (schema === undefined)
    return fail(
      'requires outputSchema(..., { jsonSchema }) or a parser with toJsonSchema(); the library cannot inspect a parse function.',
    );
  let root: Record<string, unknown>;
  try {
    root = copyJson(schema, 1024 * 1024, false) as Record<string, unknown>;
  } catch {
    return fail('the output JSON Schema must be bounded plain JSON data.');
  }
  if (root.type !== 'object') return fail('the output JSON Schema must declare an object.');
  const properties = schemaObject(root.properties, 'output properties');
  if (!Object.hasOwn(properties, config.field))
    return fail(`field '${config.field}' is not declared by the output JSON Schema.`);
  if (!Array.isArray(root.required) || !root.required.includes(config.field)) {
    return fail(
      `field '${config.field}' must be required; use an empty array when there is no typed claim.`,
    );
  }
  const field = schemaObject(properties[config.field], `field '${config.field}'`);
  if (field.type !== 'array') return fail(`field '${config.field}' must be an array of citations.`);
  const item = schemaObject(field.items, `items of '${config.field}'`);
  if (item.type !== 'object') return fail(`items of '${config.field}' must be citation objects.`);
  const fields = schemaObject(item.properties, `properties of '${config.field}' items`);
  if (Object.keys(fields).some((key) => !FIELDS.includes(key))) {
    return fail(
      `'${config.field}' entries declare only kind, about and restsOn; statement, delivery and version are library-owned output fields.`,
    );
  }
  const required = item.required;
  if (
    !Array.isArray(required) ||
    !required.includes('restsOn') ||
    required.some((key) => typeof key !== 'string' || !Object.hasOwn(fields, key))
  ) {
    return fail(
      `'${config.field}' entries must require restsOn and declare each required property.`,
    );
  }
  const kind = fields.kind === undefined ? undefined : schemaObject(fields.kind, 'kind');
  if (
    kind !== undefined &&
    (kind.type !== 'string' ||
      (kind.enum !== undefined &&
        (!Array.isArray(kind.enum) ||
          kind.enum.length === 0 ||
          kind.enum.some((value) => !KINDS.includes(value)))))
  ) {
    return fail("kind must be a string restricted to 'none', 'not-found' or 'complete'.");
  }
  const about = fields.about === undefined ? undefined : schemaObject(fields.about, 'about');
  const aboutTypes =
    about === undefined ? [] : Array.isArray(about.type) ? about.type : [about.type];
  if (
    about !== undefined &&
    (aboutTypes.length === 0 ||
      aboutTypes.some((type) => !['string', 'number', 'integer'].includes(type)))
  ) {
    return fail('about must declare a string or number, never null.');
  }
  const restsOn = schemaObject(fields.restsOn, 'restsOn');
  const handle = schemaObject(restsOn.items, 'restsOn.items');
  if (restsOn.type !== 'array' || handle.type !== 'string')
    return fail('restsOn must be an array of string handles.');
  if (handle.pattern !== undefined && handle.pattern !== NEGATIVE_HANDLE_PATTERN) {
    return fail(`restsOn handles must use pattern '${NEGATIVE_HANDLE_PATTERN}'.`);
  }
  const cap = (node: Record<string, unknown>, maximum: number, at: string): void => {
    for (const key of ['minItems', 'maxItems']) {
      if (
        node[key] !== undefined &&
        (typeof node[key] !== 'number' ||
          !Number.isSafeInteger(node[key]) ||
          (node[key] as number) < 0)
      ) {
        return fail(`${at}.${key} must be a non-negative integer.`);
      }
    }
    if (typeof node.minItems === 'number' && node.minItems > maximum)
      return fail(`${at}.minItems exceeds the checker limit ${maximum}.`);
    node.maxItems = typeof node.maxItems === 'number' ? Math.min(node.maxItems, maximum) : maximum;
    if (typeof node.minItems === 'number' && node.minItems > (node.maxItems as number))
      return fail(`${at} has incompatible item bounds.`);
  };
  cap(field, MAX_NEGATIVE_CLAIMS, config.field);
  cap(restsOn, MAX_CITED_READS, 'restsOn');
  restsOn.minItems = Math.max(typeof restsOn.minItems === 'number' ? restsOn.minItems : 0, 1);
  if ((restsOn.maxItems as number) < (restsOn.minItems as number))
    return fail('restsOn must permit at least one handle.');
  handle.pattern = NEGATIVE_HANDLE_PATTERN;
  if (kind !== undefined) kind.enum ??= [...KINDS];
  if (about !== undefined && aboutTypes.includes('string')) {
    about.minLength = Math.max(typeof about.minLength === 'number' ? about.minLength : 0, 1);
    about.maxLength = Math.min(typeof about.maxLength === 'number' ? about.maxLength : 256, 256);
  }
  item.additionalProperties = false;
  return copyJson(root, 1024 * 1024, true) as Readonly<Record<string, unknown>>;
}

/** One always-on instruction; handles themselves are served beside admitted results. */
export function negativeClaimsInstruction(
  config: ResolvedTypedNegativeClaims,
  schema: Readonly<Record<string, unknown>>,
): string {
  const fieldSchema = (schema.properties as Record<string, unknown>)[config.field];
  return (
    `The required ${JSON.stringify(config.field)} field contains typed negative citations. ` +
    `Use only result handles served by these tools: ${JSON.stringify(config.tools)}. ` +
    'Each entry points to restsOn handles; do not write scope or statement text. ' +
    'The library derives the claim type and searched subject from those recorded reads. ' +
    'If the app schema includes kind or about, those are compatibility/display fields only, not evidence. ' +
    'State negative claims only through this citation field; do not repeat them in summaries or other prose. ' +
    'The library writes the delivered statement. Use [] when making no typed negative claim. ' +
    `Field JSON Schema: ${JSON.stringify(fieldSchema)}`
  );
}
