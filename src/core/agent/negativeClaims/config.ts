/** The typed negative-claims arm: app configuration and the model's citation schema.
 * This module never calls a parser or decides whether a search establishes a claim.
 * Delivery adds its own statement after parsing; that enriched field is not model input. */
import { copyJson, ownData } from '../../../lib/boundedJson.js';
import { MAX_NEGATIVE_CLAIMS } from '../../../integrity/negative-claim/limits.js';
import { MAX_CITED_READS } from '../../../integrity/negative-claim/citation.js';
import type { Tool } from '../../../tools/tools.js';

/** Configure library-written statements for a typed answer's negative citations.
 * The named field must be a required, top-level array in the output JSON Schema.
 * Every cited tool must be registered locally. A search declaration or an admitted
 * `absent({ among })` result supplies its coverage at runtime.
 *
 * Available, but not recommended until the typed benchmark gates pass. Prose
 * detection and enforcement are not enabled by this option.
 */
export interface NegativeClaimsOptions {
  readonly field: string;
  readonly tools: readonly string[];
  /** Default `withhold`. `state-searched` reports what was read without upgrading its verdict. */
  readonly unestablished?: 'withhold' | 'state-searched';
}

/** What the model may put in one entry. The runtime owns every delivered statement. */
export interface NegativeClaimCitation {
  readonly kind: 'none' | 'not-found' | 'complete';
  readonly about: string | number;
  readonly restsOn: readonly string[];
}

/** @internal Detached configuration carried by the chart, never by the model. */
export interface ResolvedNegativeClaims {
  readonly field: string;
  readonly tools: readonly string[];
  readonly unestablished: 'withhold' | 'state-searched';
}

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
  if (['strictProse', 'prose', 'enforceProse'].some((key) => Object.hasOwn(source, key))) {
    return fail(
      'prose and strictProse are not available; this release checks typed citations only.',
    );
  }
  if (Object.keys(source).some((key) => !['field', 'tools', 'unestablished'].includes(key))) {
    return fail('options accept only field, tools and unestablished.');
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
  return Object.freeze({ field, tools: Object.freeze([...tools] as string[]), unestablished });
}

/** Provider-only and MCP tools cannot become trusted by being named in this list. */
export function assertNegativeClaimsTools(
  config: ResolvedNegativeClaims,
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
  config: ResolvedNegativeClaims,
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
  if (!Array.isArray(required) || FIELDS.some((key) => !required.includes(key))) {
    return fail(`'${config.field}' entries must require kind, about and restsOn.`);
  }
  const kind = schemaObject(fields.kind, 'kind');
  if (
    kind.type !== 'string' ||
    (kind.enum !== undefined &&
      (!Array.isArray(kind.enum) ||
        kind.enum.length === 0 ||
        kind.enum.some((value) => !KINDS.includes(value))))
  ) {
    return fail("kind must be a string restricted to 'none', 'not-found' or 'complete'.");
  }
  const about = schemaObject(fields.about, 'about');
  const aboutTypes = Array.isArray(about.type) ? about.type : [about.type];
  if (
    aboutTypes.length === 0 ||
    aboutTypes.some((type) => !['string', 'number', 'integer'].includes(type))
  ) {
    return fail('about must declare a string or number, never null or an optional value.');
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
  kind.enum ??= [...KINDS];
  if (aboutTypes.includes('string')) {
    about.minLength = Math.max(typeof about.minLength === 'number' ? about.minLength : 0, 1);
    about.maxLength = Math.min(typeof about.maxLength === 'number' ? about.maxLength : 256, 256);
  }
  item.additionalProperties = false;
  return copyJson(root, 1024 * 1024, true) as Readonly<Record<string, unknown>>;
}

/** One always-on instruction; handles themselves are served beside admitted results. */
export function negativeClaimsInstruction(
  config: ResolvedNegativeClaims,
  schema: Readonly<Record<string, unknown>>,
): string {
  const fieldSchema = (schema.properties as Record<string, unknown>)[config.field];
  return (
    `The required ${JSON.stringify(config.field)} field contains typed negative citations. ` +
    `Use only result handles served by these tools: ${JSON.stringify(config.tools)}. ` +
    'Each entry names kind, the entity about, and restsOn handles; do not write scope or statement text. ' +
    'The library writes the delivered statement. Use [] when making no typed negative claim. ' +
    `Field JSON Schema: ${JSON.stringify(fieldSchema)}`
  );
}
