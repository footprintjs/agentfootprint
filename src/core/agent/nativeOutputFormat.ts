/**
 * nativeOutputFormat — the ONE builder of the JSON Schema that
 * `.outputSchema(parser, { strategy: 'native' })` sends as the provider's
 * structured-output format (Anthropic's `output_config.format`).
 *
 * Pattern: pure transform over plain JSON, run once at build
 *          (`AgentBuilder · resolveOutputEnforcement`); no scope, no I/O.
 * Role:    core/ agent leaf. Its input is the SAME schema the `'tool-forced'`
 *          strategy puts on its synthetic tool (`outputEnforcement.ts ·
 *          resolveJsonSchema`: the `jsonSchema` option, else the parser's own
 *          `toJsonSchema()`), and the SAME parser judges every answer after —
 *          so the wire copy may be looser than the contract, never different
 *          from it.
 *
 * THE RULES, from Anthropic's structured-outputs page ("JSON Schema
 * limitations", fetched 2026-10-14 —
 * https://platform.claude.com/docs/en/build-with-claude/structured-outputs),
 * and the shape of the SDK's own transform (`@anthropic-ai/sdk` ·
 * `transformJSONSchema`, which moves what the API does not take into the
 * description):
 *   - KEPT: `type`, `properties`, `required`, `items`, `anyOf`, `allOf`,
 *     local `$ref` with `$defs` / `definitions`, `enum` and `const` of
 *     scalars, `default`, `description`, `title`, the ten supported string
 *     `format`s, `minItems` of 0 or 1, and a `pattern` with no backreference,
 *     lookaround or word boundary. `oneOf` is sent as `anyOf`.
 *   - CLOSED: every object gets `additionalProperties: false` — the only value
 *     the API takes.
 *   - MOVED INTO THE DESCRIPTION, on the wire copy only: every constraint the
 *     API does not take (`minimum`, `maximum`, `multipleOf`, `minLength`,
 *     `maxLength`, `minItems` above 1 — sent as 1 —, `maxItems`, an
 *     unsupported `format` or `pattern`, …). The model still reads them; the
 *     parser still enforces them.
 *   - REFUSED BY NAME (`NativeOutputSchemaError`): what the API cannot express
 *     — a recursive schema, an external `$ref`, an `enum` holding an object
 *     or array, `allOf` beside a `$ref`, a node with no type (an open
 *     `unknown` value), and an object with open keys (`additionalProperties`
 *     given a schema, or `patternProperties`: closing it would make every map
 *     empty while the parser accepted it).
 *   - DROPPED: the meta keys `$schema`, `$id`, `$comment`, `$anchor`.
 *
 * THE RESERVED `_findings` KEY. With `.findings()` armed, the instruction tells
 * the model it may carry its standings on a JSON answer as a top-level
 * `_findings.previous`. Under `additionalProperties: false` a key the schema
 * does not name cannot be written at all, so the answer standings would stop
 * without a sound. Armed, the root gains the optional `_findings` property
 * the served contract allows (`findings/reserved.ts · findingsAnswerSchema`) —
 * unless the author's schema names its own `_findings`, which wins; a root
 * that is not an object cannot carry it and is refused. Unarmed, the schema
 * is the author's alone.
 *
 * @example
 *   nativeOutputFormat(
 *     { type: 'object', properties: { n: { type: 'integer', minimum: 1 } }, required: ['n'] },
 *     { findings: false },
 *   );
 *   // { type: 'json_schema', schema: { type: 'object',
 *   //   properties: { n: { type: 'integer', description: '{minimum: 1}' } },
 *   //   required: ['n'], additionalProperties: false } }
 */

import { findingsAnswerSchema } from './findings/reserved.js';
import { RESERVED_ANSWER_KEY } from './findings/types.js';

type Json = Readonly<Record<string, unknown>>;

/** What `LLMRequest.outputFormat` carries. */
export interface NativeOutputFormat {
  readonly type: 'json_schema';
  readonly schema: Json;
}

/** A schema the provider's structured output cannot express, named. */
export class NativeOutputSchemaError extends Error {
  /** JSON-pointer-like path of the node refused (`'#'` is the root). */
  readonly path: string;

  constructor(path: string, reason: string) {
    super(
      `AgentBuilder.outputSchema: strategy 'native' sends the schema as Anthropic's ` +
        `output_config.format, and the node at ${path} cannot be expressed there: ${reason} ` +
        `Change the schema, or use { strategy: 'instruct', retries: N }, which takes any ` +
        `parser and judges the same contract.`,
    );
    this.name = 'NativeOutputSchemaError';
    this.path = path;
  }
}

const SUPPORTED_FORMATS: ReadonlySet<unknown> = new Set([
  'date-time',
  'time',
  'date',
  'duration',
  'email',
  'hostname',
  'uri',
  'ipv4',
  'ipv6',
  'uuid',
]);
const META_KEYS: ReadonlySet<string> = new Set(['$schema', '$id', '$comment', '$anchor']);
/** Annotations kept as they are (the docs list `default`; the rest are words). */
const KEPT_AS_IS: ReadonlySet<string> = new Set(['description', 'title', 'default', 'required']);

function isObject(value: unknown): value is Json {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isObjectNode(node: Json): boolean {
  const type = node.type;
  return (
    type === 'object' ||
    (Array.isArray(type) && type.includes('object')) ||
    isObject(node.properties)
  );
}

/** A pattern the API's regex subset refuses: a backreference, lookaround or word boundary. */
function unsupportedPattern(pattern: string): boolean {
  for (let i = 0; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === '\\') {
      const next = pattern[i + 1];
      if (next !== undefined && /[1-9kbB]/.test(next)) return true;
      i++;
      continue;
    }
    if (ch === '(' && pattern[i + 1] === '?') {
      const rest = pattern.slice(i + 2, i + 4);
      if (rest.startsWith('=') || rest.startsWith('!') || rest === '<=' || rest === '<!')
        return true;
    }
  }
  return false;
}

function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as object)) deepFreeze(child);
  }
  return value;
}

// ─── Refusals that need the whole schema: $ref resolution ─────────────

function resolvePointer(root: Json, ref: string): unknown {
  if (ref === '#') return root;
  if (!ref.startsWith('#/')) return undefined;
  let node: unknown = root;
  for (const raw of ref.slice(2).split('/')) {
    const key = decodeURIComponent(raw).replace(/~1/g, '/').replace(/~0/g, '~');
    if (typeof node !== 'object' || node === null) return undefined;
    node = (node as Record<string, unknown>)[key];
  }
  return node;
}

/**
 * Refuse an external, dangling or recursive `$ref`. A depth-first walk that
 * expands each local reference with the chain of references being expanded
 * (`open`); meeting one of them again is recursion. A reference fully
 * expanded once without meeting itself is `settled` and not walked again.
 */
function assertReferencesExpressible(root: Json): void {
  const settled = new Set<string>();
  const open = new Set<string>();
  const walk = (node: unknown, path: string): void => {
    if (Array.isArray(node)) {
      node.forEach((child, i) => walk(child, `${path}/${i}`));
      return;
    }
    if (!isObject(node)) return;
    const ref = node.$ref;
    if (typeof ref === 'string') {
      if (!ref.startsWith('#')) {
        throw new NativeOutputSchemaError(
          path,
          `'$ref': '${ref}' is an external reference, and only references inside the ` +
            `schema ('#/$defs/…') are supported.`,
        );
      }
      if (open.has(ref)) {
        throw new NativeOutputSchemaError(
          path,
          `'$ref': '${ref}' refers back into a definition it is part of — a recursive ` +
            `schema, which is not supported.`,
        );
      }
      if (!settled.has(ref)) {
        const target = resolvePointer(root, ref);
        if (!isObject(target)) {
          throw new NativeOutputSchemaError(
            path,
            `'$ref': '${ref}' points at nothing in this schema.`,
          );
        }
        open.add(ref);
        walk(target, ref);
        open.delete(ref);
        settled.add(ref);
      }
    }
    // Definitions are walked too, referenced or not: a definition that
    // reaches itself is recursive either way, and an unreferenced one is
    // still sent.
    for (const [key, child] of Object.entries(node)) {
      if (key !== '$ref') walk(child, `${path}/${key}`);
    }
  };
  open.add('#');
  walk(root, '#');
}

// ─── The node transform ───────────────────────────────────────────────

function describe(node: Record<string, unknown>, moved: Record<string, unknown>): void {
  const entries = Object.entries(moved);
  if (entries.length === 0) return;
  const words = `{${entries.map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join(', ')}}`;
  const existing = typeof node.description === 'string' ? node.description : undefined;
  node.description = existing ? `${existing}\n\n${words}` : words;
}

function transformNode(node: unknown, path: string): Json {
  if (!isObject(node)) {
    throw new NativeOutputSchemaError(path, 'a schema must be an object, and this one is not.');
  }
  const has = (key: string): boolean => Object.prototype.hasOwnProperty.call(node, key);
  if (
    !has('type') &&
    !has('anyOf') &&
    !has('oneOf') &&
    !has('allOf') &&
    !has('$ref') &&
    !has('enum') &&
    !has('const')
  ) {
    throw new NativeOutputSchemaError(
      path,
      'it has no type — an open value (z.unknown(), z.any(), {}) is any JSON at all, which ' +
        'the structured output cannot decode without recursion. Give it a type.',
    );
  }
  if (Array.isArray(node.enum) && node.enum.some((v) => typeof v === 'object' && v !== null)) {
    throw new NativeOutputSchemaError(
      path,
      'its enum holds an object or an array; enum values must be strings, numbers, ' +
        'booleans or null.',
    );
  }
  if (
    has('allOf') &&
    Array.isArray(node.allOf) &&
    node.allOf.some((s) => isObject(s) && has$ref(s))
  ) {
    throw new NativeOutputSchemaError(path, 'allOf with a $ref inside it is not supported.');
  }
  if (
    has('patternProperties') ||
    (isObject(node.additionalProperties) && Object.keys(node.additionalProperties).length > 0)
  ) {
    throw new NativeOutputSchemaError(
      path,
      'it is an object with open keys (a record or map: additionalProperties given a schema, ' +
        'or patternProperties). The API takes only additionalProperties: false, which would ' +
        'make every such map empty while the parser accepted it. Name the keys as properties.',
    );
  }

  // A reference stands alone, as the SDK's transform sends it: its target
  // carries the shape, and siblings beside a `$ref` are not part of the subset.
  if (has('$ref')) return { $ref: node.$ref };

  const out: Record<string, unknown> = {};
  const moved: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (META_KEYS.has(key)) continue;
    switch (key) {
      case 'type':
      case 'enum':
      case 'const':
        out[key] = value;
        break;
      case 'properties':
        if (isObject(value)) {
          out.properties = Object.fromEntries(
            Object.entries(value).map(([name, child]) => [
              name,
              transformNode(child, `${path}/properties/${name}`),
            ]),
          );
        } else moved[key] = value;
        break;
      case 'items':
        if (isObject(value)) out.items = transformNode(value, `${path}/items`);
        else moved[key] = value;
        break;
      case 'anyOf':
      case 'oneOf':
      case 'allOf':
        if (Array.isArray(value)) {
          const target = key === 'allOf' ? 'allOf' : 'anyOf';
          out[target] = value.map((child, i) => transformNode(child, `${path}/${key}/${i}`));
        } else moved[key] = value;
        break;
      case '$defs':
      case 'definitions':
        if (isObject(value)) {
          out[key] = Object.fromEntries(
            Object.entries(value).map(([name, child]) => [
              name,
              transformNode(child, `${path}/${key}/${name}`),
            ]),
          );
        } else moved[key] = value;
        break;
      case 'format':
        if (SUPPORTED_FORMATS.has(value)) out.format = value;
        else moved[key] = value;
        break;
      case 'pattern':
        if (typeof value === 'string' && !unsupportedPattern(value)) out.pattern = value;
        else moved[key] = value;
        break;
      case 'minItems':
        if (value === 0 || value === 1) out.minItems = value;
        else {
          moved[key] = value;
          if (typeof value === 'number' && value > 1) out.minItems = 1;
        }
        break;
      case 'additionalProperties':
        // `true`, `{}` or `false`: closed below. A schema was refused above.
        break;
      default:
        if (KEPT_AS_IS.has(key)) out[key] = value;
        else moved[key] = value;
    }
  }
  if (isObjectNode(node)) {
    if (out.properties === undefined) out.properties = {};
    out.additionalProperties = false;
  }
  describe(out, moved);
  return out;
}

function has$ref(node: Json): boolean {
  return Object.prototype.hasOwnProperty.call(node, '$ref');
}

// ─── The one entry point ──────────────────────────────────────────────

/**
 * The structured-output format for `jsonSchema`, made API-compatible as the
 * file header lists, with the reserved `_findings` property when the findings
 * ledger is armed. Deep-frozen; the input is never edited.
 *
 * @throws NativeOutputSchemaError naming the node the API cannot express.
 */
export function nativeOutputFormat(
  jsonSchema: Json,
  arms: { readonly findings: boolean },
): NativeOutputFormat {
  let source: Json = jsonSchema;
  if (arms.findings) {
    if (!isObjectNode(jsonSchema)) {
      throw new NativeOutputSchemaError(
        '#',
        `.findings() lets a JSON answer carry its standings as a top-level ` +
          `'${RESERVED_ANSWER_KEY}' property, and this root is not an object schema with ` +
          `properties, so the structured output would refuse the key and the standings would ` +
          `stop. Give the answer an object root.`,
      );
    }
    const properties = isObject(jsonSchema.properties) ? jsonSchema.properties : {};
    if (!Object.prototype.hasOwnProperty.call(properties, RESERVED_ANSWER_KEY)) {
      source = {
        ...jsonSchema,
        properties: { ...properties, [RESERVED_ANSWER_KEY]: findingsAnswerSchema() },
      };
    }
  }
  assertReferencesExpressible(source);
  return deepFreeze({ type: 'json_schema' as const, schema: transformNode(source, '#') });
}
