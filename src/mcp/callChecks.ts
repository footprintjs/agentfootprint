/**
 * callChecks — a listing never makes a callable tool lose its checks.
 *
 * Pattern: the SDK's three per-tool call checks, carried by every tool the
 *          library hands out, plus one typed refusal.
 * Role:    The MCP SDK's `Client` runs three checks inside `callTool`, and it
 *          keeps them only for the tools of its most recent `tools/list`
 *          answer (1.32: `cacheToolMetadata` replaces them on every answer):
 *
 *   1. a tool with `execution.taskSupport: 'required'` is refused before a
 *      plain `tools/call` is sent;
 *   2. a tool with an `outputSchema` must answer with `structuredContent`,
 *      unless the answer is an error;
 *   3. that `structuredContent` must match the schema.
 *
 * So a tool that declares any of them carries them itself, as the listing it
 * came from declared them. The library leaves them to the SDK only for a tool
 * of a ONE-page list whose answer is still the latest, with no list request
 * out (`listingGenerations.ts`), both when the call starts and when its answer
 * comes in: the one-page normal case, which runs exactly as it always did.
 * Every other call runs the tool's own checks, at the SDK's moments — the first
 * before sending, the other two once the answer is in, before anything reads it
 * — and raises the SDK's error: its own `McpError` where this arm loaded the
 * SDK, otherwise an error with the same name, code and message. Those calls
 * are to a tool of a paged list, a tool whose list a later answer replaced (a
 * refresh that failed or succeeded; a reference held across it), and any call
 * made while a list is being read.
 *
 * The output checks need a JSON Schema validator equal to the client's: the
 * SDK's default (`AjvJsonSchemaValidator`, loaded with the SDK on the Node
 * loader arm), or the caller's `jsonSchemaValidator`. Where neither exists — an
 * `sdk` or `connection` arm given none — an answer is never returned unchecked
 * (`McpOutputUncheckedError`):
 *
 *   - a call under the tool's own checks from the start, to a tool that
 *     declares an `outputSchema`, is refused before it is sent (`sent: false`);
 *   - a call that started under the SDK's checks is refused once its answer is
 *     in, unread, when the library sent a `tools/list` request while the call
 *     was out (`sent: true`): the SDK may have checked it against another list.
 *
 * A schema is compiled when a tool's own checks first need it, never before:
 * the one-page normal case compiles nothing twice.
 */

import type { McpCallToolResult, McpJsonSchemaValidator, McpListedTool } from './types.js';
import { ListingGenerations } from './listingGenerations.js';

/** The SDK's `McpError` constructor, as `@modelcontextprotocol/sdk/types.js` exports it. */
export type McpErrorClass = new (code: number, message: string, data?: unknown) => Error;

/** JSON-RPC's codes for the two errors the SDK raises here. */
const INVALID_REQUEST = -32600;
const INVALID_PARAMS = -32602;

/** A compiled output check, as the SDK's validator returns one. */
type Validate = (input: unknown) => { readonly valid: boolean; readonly errorMessage?: string };

/**
 * What one connection checks its tools' calls with: a validator equal to its
 * client's, the SDK's own error class where the library loaded the SDK, and
 * which `tools/list` answer the SDK holds its checks for.
 */
export interface CallCheckKit {
  /** The client's name, as its refusals name it. */
  readonly server: string;
  /** The validator; created on first use. `undefined` when none is reachable. */
  validator(): McpJsonSchemaValidator | undefined;
  /** The SDK's own `McpError`, when this arm loaded the SDK. */
  readonly McpError?: McpErrorClass;
  /** The list requests this connection sent, counted (`listingGenerations.ts`). */
  readonly listings: ListingGenerations;
}

/**
 * The kit for one connection, named `server`. `given` is the caller's
 * `jsonSchemaValidator`; `loaded` holds what the library loaded with the SDK on
 * the Node loader arm — the SDK's default validator class and its `McpError` —
 * each `undefined` where it is not a constructor (another arm, or an SDK
 * without it).
 */
export function callCheckKit(
  server: string,
  given: McpJsonSchemaValidator | undefined,
  loaded: { readonly Validator?: unknown; readonly McpError?: unknown } = {},
): CallCheckKit {
  const Default = typeof loaded.Validator === 'function' ? loaded.Validator : undefined;
  let created: McpJsonSchemaValidator | undefined;
  return {
    server,
    validator: () => {
      if (given !== undefined) return given;
      if (Default === undefined) return undefined;
      created ??= new (Default as new () => McpJsonSchemaValidator)();
      return created;
    },
    ...(typeof loaded.McpError === 'function' && { McpError: loaded.McpError as McpErrorClass }),
    listings: new ListingGenerations(),
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

/** The checks one listed tool carries, as the listing it came from declared them. */
export interface CallChecks {
  readonly server: string;
  readonly tool: string;
  /** `execution.taskSupport: 'required'`: only ever run as a task. */
  readonly taskRequired: boolean;
  /** The tool declares an `outputSchema`. */
  readonly outputDeclared: boolean;
  /**
   * True while the SDK's `Client` holds this tool's checks: the tool came from
   * a one-page list whose answer is still the latest, and no list request is
   * out. Then the SDK checks the call, and nothing here runs.
   */
  heldBySdk(): boolean;
  /**
   * The compiled output check, compiled from the declared schema on first use.
   * `undefined` when no output is declared or no validator is reachable.
   */
  validate(): Validate | undefined;
  /** Raise an SDK error, as this arm can: the SDK's class, or its exact shape. */
  fail(code: number, message: string): Error;
}

/**
 * The checks `listed` carries — `undefined` when it declares none. `generation`
 * is the one answer its list was read in, when it was read in one
 * (`toolList.ts` · `ToolListing`); a paged list's tools have none, so the SDK
 * never holds all of them.
 */
export function checksFor(
  listed: McpListedTool,
  kit: CallCheckKit,
  generation: number | undefined,
): CallChecks | undefined {
  const schema = ownObject(listed, 'outputSchema');
  const taskRequired = ownValue(ownObject(listed, 'execution'), 'taskSupport') === 'required';
  if (schema === undefined && !taskRequired) return undefined;
  let compiled: Validate | undefined;
  return {
    server: kit.server,
    tool: listed.name,
    taskRequired,
    outputDeclared: schema !== undefined,
    heldBySdk: () => generation !== undefined && kit.listings.isLatest(generation),
    validate: () => {
      if (schema !== undefined) compiled ??= kit.validator()?.getValidator(schema);
      return compiled;
    },
    fail: (code, message) =>
      kit.McpError !== undefined
        ? new kit.McpError(code, message)
        : new McpErrorShape(code, message),
  };
}

/**
 * True when this call's output cannot be checked here: it runs under the
 * tool's own checks, the tool declares an `outputSchema`, no validator is
 * reachable, and it is not refused as a required task anyway (that refusal is
 * the SDK's, and comes first). The call is then refused before it is sent.
 */
export function outputUnchecked(checks: CallChecks): boolean {
  return checks.outputDeclared && !checks.taskRequired && checks.validate() === undefined;
}

/** The SDK's task refusal, word for word, before anything is sent. */
export function refuseRequiredTask(checks: CallChecks): void {
  if (!checks.taskRequired) return;
  throw checks.fail(
    INVALID_REQUEST,
    `Tool "${checks.tool}" requires task-based execution. ` +
      'Use client.experimental.tasks.callToolStream() instead.',
  );
}

/**
 * The SDK's two output checks, in its order and with its sentences, once the
 * answer is in and before anything reads it. An answer no validator here can
 * check is never returned: it is refused, unread, as sent.
 */
export function checkOutput(checks: CallChecks, result: McpCallToolResult): void {
  if (!checks.outputDeclared) return;
  const validate = checks.validate();
  if (validate === undefined) throw new McpOutputUncheckedError(checks.server, checks.tool, true);
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

/** What the refusal says happened, refused before sending. */
const NOT_SENT =
  'was not sent. The tool declares an outputSchema, the MCP SDK no longer holds the checks of ' +
  'the tool list it came from (that list was paged, a later list replaced it, or a list is ' +
  'being read)';

/** What the refusal says happened, refused once the answer was in. */
const SENT_UNREAD =
  'was sent, and its answer is not returned. The tool declares an outputSchema, a tool list ' +
  'was read while the call was out (so the MCP SDK may not have checked the answer against ' +
  "this tool's schema)";

/**
 * A tool call whose output this connection cannot check, refused. The tool
 * declares an `outputSchema`, the MCP SDK no longer holds the checks of the
 * tool list it came from, and this connection has no JSON Schema validator to
 * check it with — so its answer is never returned:
 *
 *   - `sent: false` — refused before it was sent: nothing reached the server.
 *     The tool came from a paged list, from a list a later answer replaced, or
 *     the call was made while a list was being read.
 *   - `sent: true` — the call was sent, and a `tools/list` request went out
 *     before its answer came in: the SDK may have checked that answer against
 *     the other list, so it is refused unread. The tool may have run.
 *
 * Pass `jsonSchemaValidator` — the validator your client uses — to `mcpClient`.
 * Names the server and the tool, never an argument or an answer.
 */
export class McpOutputUncheckedError extends Error {
  readonly code = 'ERR_MCP_OUTPUT_UNCHECKED' as const;
  readonly reason = 'output-unchecked' as const;

  constructor(
    readonly server: string,
    readonly tool: string,
    /** Whether the request left the client: `false` when the refusal came before it. */
    readonly sent: boolean,
  ) {
    super(
      `mcpClient[${server}]: the call to '${tool}' ${sent ? SENT_UNREAD : NOT_SENT}, and this ` +
        'connection has no JSON Schema validator to check its output with. Pass ' +
        '`jsonSchemaValidator` to mcpClient: the validator your client uses.',
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
