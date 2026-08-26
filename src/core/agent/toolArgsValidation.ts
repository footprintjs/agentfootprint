/**
 * toolArgsValidation — validate LLM-produced tool args against the tool's
 * declared `inputSchema` BEFORE dispatch (backlog #9).
 *
 * Pattern: pure function module — no events, and no state beyond one compiled-
 *          regex cache (which doubles as the warn-once ledger for `pattern`s
 *          that do not compile); the toolCalls stage owns when to call it and
 *          what to do with the verdict.
 * Role:    The model writes tool args as free-form JSON; nothing guaranteed
 *          they match the schema the tool advertised. Dispatching garbage
 *          surfaced as deep tool stack traces (or worse, silent misbehavior).
 *          Validating at the boundary turns a malformed call into a
 *          MODEL-VISIBLE structured tool result, so the LLM corrects its
 *          args and retries on the next ReAct iteration.
 *
 * ── Honest-subset contract ────────────────────────────────────────────────
 * This is NOT a full JSON Schema implementation. It enforces the core that
 * tool schemas in the wild actually use, and IGNORES everything else
 * (permissive on unknown keywords — a schema using `oneOf`/`$ref` still
 * validates the supported core, never false-rejects on the rest):
 *
 *   ENFORCED: `type` (object/array/string/number/integer/boolean/null,
 *             union arrays), `required`, `properties` (recursive),
 *             `items` (single-schema, recursive), `enum` (primitives),
 *             `additionalProperties: false` ONLY when explicitly set,
 *             and the STRING SHAPE keywords `pattern` / `minLength` /
 *             `maxLength`.
 *   IGNORED:  format, numeric min/max, oneOf/anyOf/allOf/not, $ref,
 *             const, dependencies, …
 *
 * ── Why string SHAPE joined the subset ────────────────────────────────────
 * A tool result ended with an offer ("I can also map these ids to volume
 * names"); the person answered "yes please"; the model bound that sentence as
 * the IDENTIFIER argument and dispatched. The tool's schema declared the
 * identifier's shape and this boundary did not read it, so a call that could
 * never succeed cost a round trip — and the consumer hand-rolled an
 * affirmative blocklist to do what the declaration already said. A declared
 * shape a boundary ignores is worse than no declaration: the author believes
 * it is enforced.
 *
 * `pattern` is JSON Schema's own semantics — UNANCHORED, ECMA-262, applied to
 * strings only. A regex the schema author got wrong must never take dispatch
 * with it: it is compiled once, and a compile failure degrades to no-pattern
 * plus one developer warning.
 *
 * ── Security: what an issue may echo ──────────────────────────────────────
 * `type` / `enum` / `required` / `additionalProperties` issues name the PATH,
 * the EXPECTED shape, and the TYPE of what arrived — never the supplied value.
 * Enum expectations echo SCHEMA values only (already LLM-visible in the tools
 * block).
 *
 * String-SHAPE issues are the one exception, and it is a narrow one: the
 * complaint IS the value's shape, so `expected string, got string` teaches
 * nothing and the correction cannot converge. They carry `value` — a capped
 * excerpt ({@link MAX_VALUE_CHARS}) of the offending string — plus `hint`, the
 * parameter's own `description`, which is where an author writes what the
 * identifier looks like. Neither adds exposure: the value is the model's own
 * tool-call argument, already verbatim in the history this message is appended
 * to. The OTel adapter renders `path`/`expected`/`got` only, so third-party
 * telemetry stays value-free either way.
 */

/** When to enforce: 'enforce' rejects before dispatch (default), 'warn'
 *  emits the event but executes anyway, 'off' skips validation entirely. */
export type ToolArgValidationMode = 'enforce' | 'warn' | 'off';

/** One schema violation. `got` is a TYPE NAME (optionally with a measured
 *  length), never a value. */
export interface ToolArgIssue {
  /** Dot/bracket path from the args root, '' for the root itself. */
  readonly path: string;
  readonly expected: string;
  readonly got: string;
  /**
   * A capped excerpt of the offending STRING. Present on string-shape issues
   * (`pattern` / `minLength` / `maxLength`) and on nothing else — see the
   * security note in this file's header for why those alone may echo.
   */
  readonly value?: string;
  /**
   * The parameter's own `description` from the schema, when it declares one.
   * Carried on string-shape issues: the description is where an author writes
   * what the identifier looks like, and that sentence is the correction.
   */
  readonly hint?: string;
}

export interface ToolArgValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ToolArgIssue[];
}

/** Cap so a pathological schema/args pair can't flood history or events. */
const MAX_ISSUES = 10;

/** Ceiling on the echoed excerpt of an offending string. Enough to recognize
 *  a sentence bound where an identifier belonged; short enough that a 5 MB
 *  argument cannot ride the message into history. */
const MAX_VALUE_CHARS = 80;

/**
 * Ceiling on compiled `pattern`s held. Schemas are finite in a process, so
 * this is a fence against dynamically-minted ones rather than a tuning knob:
 * past it, patterns compile per call (and a broken one warns again) instead of
 * the map growing without bound.
 */
const MAX_CACHED_PATTERNS = 256;

type JsonSchemaLike = Readonly<Record<string, unknown>>;

/**
 * Compiled `pattern`s, and the warn-once ledger for the broken ones. A `null`
 * entry means "this pattern does not compile" — recorded so a schema bug is
 * reported once to the developer rather than once per dispatch.
 */
const patternCache = new Map<string, RegExp | null>();

function compilePattern(pattern: string): RegExp | null {
  const cached = patternCache.get(pattern);
  if (cached !== undefined) return cached;
  let compiled: RegExp | null = null;
  try {
    // No flags: JSON Schema `pattern` is an unanchored ECMA-262 match, and a
    // `g` flag would make the RegExp stateful across calls.
    compiled = new RegExp(pattern);
  } catch {
    console.warn(
      `[agentfootprint] a tool inputSchema declares a \`pattern\` that is not a valid regular ` +
        `expression (${pattern}) — it is IGNORED, so this argument's shape is NOT enforced. ` +
        `Fix the expression or drop the keyword.`,
    );
  }
  if (patternCache.size < MAX_CACHED_PATTERNS) patternCache.set(pattern, compiled);
  return compiled;
}

/** A length bound this validator will act on: a non-negative integer. Anything
 *  else is outside the honest subset and ignored rather than guessed at. */
function lengthBound(raw: unknown): number | undefined {
  return typeof raw === 'number' && Number.isInteger(raw) && raw >= 0 ? raw : undefined;
}

function excerptOf(value: string): string {
  return value.length <= MAX_VALUE_CHARS ? value : `${value.slice(0, MAX_VALUE_CHARS)}…`;
}

function descriptionOf(schema: JsonSchemaLike): string | undefined {
  const raw = schema.description;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed === '' ? undefined : trimmed;
}

/**
 * The string SHAPE keywords. At most ONE issue per argument: `pattern`
 * describes the value completely, so adding "and it is too short" is a second
 * sentence about one mistake.
 */
function checkStringShape(
  value: string,
  schema: JsonSchemaLike,
  path: string,
  issues: ToolArgIssue[],
): void {
  const hint = descriptionOf(schema);
  const teach = (expected: string, got: string): void => {
    issues.push({
      path,
      expected,
      got,
      value: excerptOf(value),
      ...(hint !== undefined && { hint }),
    });
  };

  const pattern = schema.pattern;
  if (typeof pattern === 'string') {
    const regex = compilePattern(pattern);
    if (regex !== null && !regex.test(value)) {
      teach(`a string matching ${pattern}`, 'string');
      return;
    }
  }

  const min = lengthBound(schema.minLength);
  if (min !== undefined && value.length < min) {
    teach(`a string of at least ${min} characters`, `string of length ${value.length}`);
    return;
  }

  const max = lengthBound(schema.maxLength);
  if (max !== undefined && value.length > max) {
    teach(`a string of at most ${max} characters`, `string of length ${value.length}`);
  }
}

function typeNameOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

/** Does `value` satisfy one JSON-Schema `type` keyword entry? */
function matchesType(value: unknown, schemaType: string): boolean {
  switch (schemaType) {
    case 'object':
      return typeof value === 'object' && value !== null && !Array.isArray(value);
    case 'array':
      return Array.isArray(value);
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value);
    case 'number':
      return typeof value === 'number';
    case 'string':
      return typeof value === 'string';
    case 'boolean':
      return typeof value === 'boolean';
    case 'null':
      return value === null;
    default:
      // Unknown type keyword → permissive (honest-subset contract).
      return true;
  }
}

function isPrimitive(value: unknown): value is string | number | boolean | null {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function validateNode(
  value: unknown,
  schema: JsonSchemaLike,
  path: string,
  issues: ToolArgIssue[],
): void {
  if (issues.length >= MAX_ISSUES) return;

  // `type` — string or union array. Unknown keywords pass.
  const schemaType = schema.type;
  if (typeof schemaType === 'string' || Array.isArray(schemaType)) {
    const candidates = Array.isArray(schemaType)
      ? schemaType.filter((t): t is string => typeof t === 'string')
      : [schemaType];
    if (candidates.length > 0 && !candidates.some((t) => matchesType(value, t))) {
      issues.push({ path, expected: candidates.join(' | '), got: typeNameOf(value) });
      return; // type is wrong — deeper checks would only cascade noise
    }
  }

  // `enum` — primitives only (object members are out of subset → ignored).
  const enumValues = schema.enum;
  if (Array.isArray(enumValues) && enumValues.length > 0 && enumValues.every(isPrimitive)) {
    if (!enumValues.some((candidate) => candidate === value)) {
      issues.push({
        path,
        expected: `one of ${enumValues.map((candidate) => JSON.stringify(candidate)).join(', ')}`,
        got: typeNameOf(value),
      });
      return;
    }
  }

  // String SHAPE — same place, same dial, same result shape as `type`/`enum`
  // above. Applies to strings only, which is JSON Schema's own rule.
  if (typeof value === 'string') {
    checkStringShape(value, schema, path, issues);
    return;
  }

  // Object keywords.
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    const record = value as Readonly<Record<string, unknown>>;
    const properties =
      typeof schema.properties === 'object' && schema.properties !== null
        ? (schema.properties as Readonly<Record<string, unknown>>)
        : undefined;

    const required = schema.required;
    if (Array.isArray(required)) {
      for (const key of required) {
        if (typeof key !== 'string') continue;
        if (!(key in record)) {
          issues.push({
            path: path === '' ? key : `${path}.${key}`,
            expected: 'required',
            got: 'missing',
          });
          if (issues.length >= MAX_ISSUES) return;
        }
      }
    }

    if (properties) {
      for (const [key, childSchema] of Object.entries(properties)) {
        if (!(key in record)) continue; // absent optional → fine
        if (typeof childSchema !== 'object' || childSchema === null) continue;
        validateNode(
          record[key],
          childSchema as JsonSchemaLike,
          path === '' ? key : `${path}.${key}`,
          issues,
        );
        if (issues.length >= MAX_ISSUES) return;
      }
    }

    // Strict-extra-keys ONLY when the schema explicitly says so.
    if (schema.additionalProperties === false && properties) {
      for (const key of Object.keys(record)) {
        if (!(key in properties)) {
          issues.push({
            path: path === '' ? key : `${path}.${key}`,
            expected: 'no additional properties',
            got: typeNameOf(record[key]),
          });
          if (issues.length >= MAX_ISSUES) return;
        }
      }
    }
  }

  // Array `items` — single-schema form only (tuple form is out of subset).
  if (Array.isArray(value)) {
    const items = schema.items;
    if (typeof items === 'object' && items !== null && !Array.isArray(items)) {
      for (let i = 0; i < value.length; i++) {
        validateNode(value[i], items as JsonSchemaLike, `${path}[${i}]`, issues);
        if (issues.length >= MAX_ISSUES) return;
      }
    }
  }
}

/**
 * Validate tool-call args against the tool's `inputSchema`.
 *
 * Total function: a malformed/exotic SCHEMA never throws — anything outside
 * the honest subset is ignored, so the worst a bad schema can do is
 * under-validate (never block a legitimate call).
 */
export function validateToolArgs(
  args: unknown,
  inputSchema: Readonly<Record<string, unknown>> | undefined,
): ToolArgValidationResult {
  if (!inputSchema || typeof inputSchema !== 'object') return { ok: true, issues: [] };
  const issues: ToolArgIssue[] = [];
  validateNode(args ?? {}, inputSchema, '', issues);
  return { ok: issues.length === 0, issues };
}

/**
 * Render the MODEL-VISIBLE tool result for a rejected call. Names paths and
 * expectations; reports received TYPES for structural issues and the capped
 * offending VALUE for string-shape ones, because a shape complaint that will
 * not say which string it is about cannot be acted on. `JSON.stringify` quotes
 * and escapes the excerpt, so a multi-line argument stays one line.
 *
 * The parameter's own `description` follows on its own line when the schema
 * declares one: that sentence is usually the whole correction.
 */
export function formatToolArgIssues(toolName: string, issues: readonly ToolArgIssue[]): string {
  const lines = issues.map((issue) => {
    const where = issue.path === '' ? 'arguments' : `'${issue.path}'`;
    const head =
      issue.expected === 'required'
        ? `- ${where} is required but missing`
        : `- ${where}: expected ${issue.expected}, got ${
            issue.value === undefined ? issue.got : JSON.stringify(issue.value)
          }`;
    return issue.hint === undefined ? head : `${head}\n  ${where} is described as: ${issue.hint}`;
  });
  return (
    `Invalid arguments for tool '${toolName}' — the call was not executed.\n` +
    `${lines.join('\n')}\n` +
    `Fix the arguments to match the tool's input schema and call it again.`
  );
}
