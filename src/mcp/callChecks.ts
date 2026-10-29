/**
 * callChecks — a paged catalogue behaves exactly as the same tools would in a
 * one-page catalogue.
 *
 * Pattern: the SDK's three per-tool call checks, applied again by the library
 *          for the tools the SDK no longer holds, plus one typed refusal.
 * Role:    The MCP SDK's `Client` keeps three checks for the tools of its most
 *          recent `tools/list` answer only (1.32: `cacheToolMetadata` replaces
 *          them on every call) and runs them inside `callTool`:
 *
 *   1. a tool with `execution.taskSupport: 'required'` is refused before a
 *      plain `tools/call` is sent;
 *   2. a tool with an `outputSchema` must answer with `structuredContent`,
 *      unless the answer is an error;
 *   3. that `structuredContent` must match the schema.
 *
 * Reading every page of a paged list leaves the SDK holding the last page's
 * tools only. So for every tool listed before the last page, the library runs
 * the same three checks at the same moments — the first before sending, the
 * other two once the answer is in, before anything reads it — and raises the
 * same error: the SDK's own `McpError` where this arm loaded the SDK, otherwise
 * an error with the same name, code and message. A caller handles each one the
 * same way, whatever page the tool was on.
 *
 * The output checks need a JSON Schema validator equal to the client's: the
 * SDK's default (`AjvJsonSchemaValidator`, loaded with the SDK on the Node
 * loader arm), or the caller's `jsonSchemaValidator`. Where neither exists — an
 * `sdk` or `connection` arm given none — a call to an earlier-page tool that
 * declares an `outputSchema` is refused before it is sent
 * (`McpOutputUncheckedError`): the one case with no SDK equivalent. An answer
 * is never returned unchecked.
 *
 * A one-page catalogue gets none of this: the SDK holds every tool.
 */

import type { McpCallToolResult, McpJsonSchemaValidator, McpListedTool } from './types.js';

/** The SDK's `McpError` constructor, as `@modelcontextprotocol/sdk/types.js` exports it. */
export type McpErrorClass = new (code: number, message: string, data?: unknown) => Error;

/** JSON-RPC's codes for the two errors the SDK raises here. */
const INVALID_REQUEST = -32600;
const INVALID_PARAMS = -32602;

/**
 * What one connection applies the checks with: a validator equal to its
 * client's, and the SDK's own error class where the library loaded the SDK.
 */
export interface CallCheckKit {
  /** The validator; created on first use. `undefined` when none is reachable. */
  validator(): McpJsonSchemaValidator | undefined;
  /** The SDK's own `McpError`, when this arm loaded the SDK. */
  readonly McpError?: McpErrorClass;
}

/**
 * The kit for one connection. `given` is the caller's `jsonSchemaValidator`;
 * `loaded` holds what the library loaded with the SDK on the Node loader arm —
 * the SDK's default validator class and its `McpError` — each `undefined`
 * where it is not a constructor (another arm, or an SDK without it).
 */
export function callCheckKit(
  given: McpJsonSchemaValidator | undefined,
  loaded: { readonly Validator?: unknown; readonly McpError?: unknown } = {},
): CallCheckKit {
  const Default = typeof loaded.Validator === 'function' ? loaded.Validator : undefined;
  let created: McpJsonSchemaValidator | undefined;
  return {
    validator: () => {
      if (given !== undefined) return given;
      if (Default === undefined) return undefined;
      created ??= new (Default as new () => McpJsonSchemaValidator)();
      return created;
    },
    ...(typeof loaded.McpError === 'function' && { McpError: loaded.McpError as McpErrorClass }),
  };
}

/**
 * `value` as a validator, or `undefined` when it was not given. Refused by name
 * when it is something else, before anything connects.
 */
export function validatorOption(value: unknown, at: string): McpJsonSchemaValidator | undefined {
  if (value === undefined) return undefined;
  const getValidator =
    value !== null && (typeof value === 'object' || typeof value === 'function')
      ? (value as { readonly getValidator?: unknown }).getValidator
      : undefined;
  if (typeof getValidator === 'function') return value as McpJsonSchemaValidator;
  throw new TypeError(
    `${at}: \`jsonSchemaValidator\` has no \`getValidator\` method. Pass a JSON Schema ` +
      "validator as the MCP SDK's `Client` takes one: `new AjvJsonSchemaValidator()` from " +
      "'@modelcontextprotocol/sdk/validation/ajv', or the one your client uses.",
  );
}

/** The checks one tool listed before the last page carries. */
export interface CallChecks {
  readonly tool: string;
  /** `execution.taskSupport: 'required'`: only ever run as a task. */
  readonly taskRequired: boolean;
  /** The tool declares an `outputSchema`. */
  readonly outputDeclared: boolean;
  /** The compiled output check, when a validator is reachable. */
  readonly validate?: (input: unknown) => {
    readonly valid: boolean;
    readonly errorMessage?: string;
  };
  /** Raise an SDK error, as this arm can: the SDK's class, or its exact shape. */
  readonly fail: (code: number, message: string) => Error;
}

/**
 * The checks for `listed`, a tool listed before the last page — `undefined`
 * when it needs none. A schema is compiled here, when the list is read, as the
 * SDK compiles it.
 */
export function checksFor(listed: McpListedTool, kit: CallCheckKit): CallChecks | undefined {
  const schema = ownObject(listed, 'outputSchema');
  const taskRequired = ownValue(ownObject(listed, 'execution'), 'taskSupport') === 'required';
  if (schema === undefined && !taskRequired) return undefined;
  const validator = schema === undefined ? undefined : kit.validator();
  return {
    tool: listed.name,
    taskRequired,
    outputDeclared: schema !== undefined,
    ...(validator !== undefined &&
      schema !== undefined && {
        validate: validator.getValidator(schema),
      }),
    fail: (code, message) =>
      kit.McpError !== undefined
        ? new kit.McpError(code, message)
        : new McpErrorShape(code, message),
  };
}

/**
 * True when this tool's output cannot be checked here: it declares an
 * `outputSchema`, no validator is reachable, and it is not refused as a
 * required task anyway (that refusal is the SDK's, and comes first).
 */
export function outputUnchecked(checks: CallChecks): boolean {
  return checks.outputDeclared && checks.validate === undefined && !checks.taskRequired;
}

/**
 * `send` the call with the SDK's checks around it, exactly where the SDK's
 * `callTool` runs them: the task refusal before anything is sent, the output
 * checks once the answer is in, before anything reads it.
 */
export async function callChecked(
  checks: CallChecks,
  send: () => Promise<McpCallToolResult>,
): Promise<McpCallToolResult> {
  if (checks.taskRequired) {
    throw checks.fail(
      INVALID_REQUEST,
      `Tool "${checks.tool}" requires task-based execution. ` +
        'Use client.experimental.tasks.callToolStream() instead.',
    );
  }
  const result = await send();
  if (checks.validate !== undefined) checkOutput(checks, checks.validate, result);
  return result;
}

/** The SDK's two output checks, in its order and with its sentences. */
function checkOutput(
  checks: CallChecks,
  validate: NonNullable<CallChecks['validate']>,
  result: McpCallToolResult,
): void {
  const structured = ownValue(result, 'structuredContent');
  if (!structured && !ownValue(result, 'isError')) {
    throw checks.fail(
      INVALID_REQUEST,
      `Tool ${checks.tool} has an output schema but did not return structured content`,
    );
  }
  if (!structured) return;
  let mismatch: string | undefined;
  try {
    const verdict = validate(structured);
    if (!verdict.valid) {
      mismatch = `Structured content does not match the tool's output schema: ${verdict.errorMessage}`;
    }
  } catch (error) {
    throw checks.fail(
      INVALID_PARAMS,
      `Failed to validate structured content: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  if (mismatch !== undefined) throw checks.fail(INVALID_PARAMS, mismatch);
}

/**
 * The SDK's `McpError`, for an arm that cannot reach the class itself (`sdk`,
 * `connection`): the same name, `code`, `data` and message, so a caller that
 * branches on those handles it as it handles the SDK's.
 */
class McpErrorShape extends Error {
  readonly code: number;
  readonly data: unknown;

  constructor(code: number, message: string) {
    super(`MCP error ${code}: ${message}`);
    this.code = code;
    this.data = undefined;
    this.name = 'McpError';
  }
}

/**
 * A tool call refused before it was sent: the tool declares an `outputSchema`
 * and was listed before the last page of a paged tool list, where the MCP SDK
 * no longer checks its output, and this connection has no JSON Schema
 * validator to check it with. Nothing reached the server. Pass
 * `jsonSchemaValidator` — the validator your client uses — to `mcpClient`.
 * Names the server and the tool, never an argument.
 */
export class McpOutputUncheckedError extends Error {
  readonly code = 'ERR_MCP_OUTPUT_UNCHECKED' as const;
  readonly reason = 'output-unchecked' as const;
  /** Nothing was sent: the refusal came before the request left the client. */
  readonly sent = false as const;

  constructor(readonly server: string, readonly tool: string) {
    super(
      `mcpClient[${server}]: the call to '${tool}' was not sent. The tool declares an ` +
        'outputSchema and was listed before the last page of a paged tool list, where the MCP ' +
        'SDK no longer checks its output, and this connection has no JSON Schema validator to ' +
        'check it with. Pass `jsonSchemaValidator` to mcpClient: the validator your client uses.',
    );
    this.name = 'McpOutputUncheckedError';
  }
}

/** An own data property, never an accessor's result; `undefined` otherwise. */
function ownValue(value: unknown, key: string): unknown {
  if (value === null || typeof value !== 'object') return undefined;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor !== undefined && 'value' in descriptor ? descriptor.value : undefined;
}

/** An own data property that is a plain object (not an array); `undefined` otherwise. */
function ownObject(value: unknown, key: string): Readonly<Record<string, unknown>> | undefined {
  const found = ownValue(value, key);
  return found !== null && typeof found === 'object' && !Array.isArray(found)
    ? (found as Readonly<Record<string, unknown>>)
    : undefined;
}
