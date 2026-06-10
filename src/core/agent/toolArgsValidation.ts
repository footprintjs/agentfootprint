/**
 * toolArgsValidation — validate LLM-produced tool args against the tool's
 * declared `inputSchema` BEFORE dispatch (backlog #9).
 *
 * Pattern: pure function module — no state, no events; the toolCalls stage
 *          owns when to call it and what to do with the verdict.
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
 * (permissive on unknown keywords — a schema using `pattern`/`oneOf`/`$ref`
 * still validates the supported core, never false-rejects on the rest):
 *
 *   ENFORCED: `type` (object/array/string/number/integer/boolean/null,
 *             union arrays), `required`, `properties` (recursive),
 *             `items` (single-schema, recursive), `enum` (primitives),
 *             `additionalProperties: false` ONLY when explicitly set.
 *   IGNORED:  format, pattern, min/max*, oneOf/anyOf/allOf/not, $ref,
 *             const, dependencies, …
 *
 * ── Security: never echo VALUES ───────────────────────────────────────────
 * Issues name the PATH, the EXPECTED shape, and the TYPE of what arrived —
 * never the supplied value itself. The message flows into history (LLM),
 * the emit channel, and traces; arg values can carry PII or injection
 * payloads. Enum expectations echo SCHEMA values only (already LLM-visible
 * in the tools block).
 */

/** When to enforce: 'enforce' rejects before dispatch (default), 'warn'
 *  emits the event but executes anyway, 'off' skips validation entirely. */
export type ToolArgValidationMode = 'enforce' | 'warn' | 'off';

/** One schema violation. `got` is a TYPE NAME, never a value. */
export interface ToolArgIssue {
  /** Dot/bracket path from the args root, '' for the root itself. */
  readonly path: string;
  readonly expected: string;
  readonly got: string;
}

export interface ToolArgValidationResult {
  readonly ok: boolean;
  readonly issues: readonly ToolArgIssue[];
}

/** Cap so a pathological schema/args pair can't flood history or events. */
const MAX_ISSUES = 10;

type JsonSchemaLike = Readonly<Record<string, unknown>>;

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
 * Render the MODEL-VISIBLE tool result for a rejected call. Names paths,
 * expectations, and received TYPES — never received values. The model
 * already has the full schema in its tools block; pointing at the issues
 * is what makes the retry converge.
 */
export function formatToolArgIssues(toolName: string, issues: readonly ToolArgIssue[]): string {
  const lines = issues.map((issue) => {
    const where = issue.path === '' ? 'arguments' : `'${issue.path}'`;
    return issue.expected === 'required'
      ? `- ${where} is required but missing`
      : `- ${where}: expected ${issue.expected}, got ${issue.got}`;
  });
  return (
    `Invalid arguments for tool '${toolName}' — the call was not executed.\n` +
    `${lines.join('\n')}\n` +
    `Fix the arguments to match the tool's input schema and call it again.`
  );
}
